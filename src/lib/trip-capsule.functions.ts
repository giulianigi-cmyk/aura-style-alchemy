import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { suggestOutfitCore, type SuggestOutfitItem } from "./ai-suggest-outfit.functions";
import { dressPreferencesToPrompt, type DressPreferences } from "./dress-preferences";
import { resolvePlanSlot } from "./outfit-plan-slot";

const InputSchema = z.object({
  tripId: z.string().uuid(),
  /** When present, only these activities are (re)generated, and an
   *  existing plan for them is replaced instead of skipped. */
  activityIds: z.array(z.string().uuid()).optional(),
});

// ============================================================================
// Static, deterministic constants — never AI-derived. See
// docs/roadmap/trip-capsule-packing.md for the reasoning behind these
// specific numbers; they live here as a single source, not scattered
// through the algorithm below.
// ============================================================================

/** How realistically a piece can be worn more than once on the same trip
 *  before it needs a wash. Not a hard cap on uses — an optimization
 *  weight the greedy selection below uses to prefer high-rewearability
 *  pieces when it has to choose what to add to the capsule. */
const REWEARABILITY: Record<string, number> = {
  Outerwear: 5, Bags: 5, Accessories: 5, Shoes: 5,
  Bottoms: 4,
  Dresses: 3, Jumpsuits: 3,
  Tops: 2, Activewear: 2, Swimwear: 2,
  Underwear: 1,
};

const NEUTRAL_COLORS = ["black", "white", "grey", "gray", "navy", "beige", "brown", "cream", "ivory", "tan"];

/** Formality range [min, max] each dress code maps to — same labels as
 *  OCCASIONS in Planner.tsx (kept in sync deliberately, not re-derived).
 *  A day with no logged activity falls back to a wide "everyday" range
 *  rather than guessing a specific occasion. */
const FORMALITY_RANGE: Record<string, [number, number]> = {
  Sport: [1, 1],
  Everyday: [1, 2],
  Weekend: [1, 2],
  Travel: [1, 3],
  Work: [2, 4],
  Formal: [4, 5],
  Evening: [4, 5],
};
const DEFAULT_FORMALITY_RANGE: [number, number] = [1, 3];

const TOP_ROLE = new Set(["Tops"]);
const BOTTOM_ROLE = new Set(["Bottoms", "Dresses", "Jumpsuits"]);
const SHOE_ROLE = new Set(["Shoes"]);
const SWIM_ROLE = new Set(["Swimwear"]);
const ACTIVE_ROLE = new Set(["Activewear"]);

/** Categories whose classification (formality / day_evening) is almost
 *  never filled in, because they're bought for a single obvious purpose.
 *  Rather than silently dropping them from the pool, they get the only
 *  sensible reading: casual (1) and daytime. */
const IMPLICIT_CLASSIFICATION: Record<string, { formality: number; dayEvening: string }> = {
  Swimwear: { formality: 1, dayEvening: "day" },
  Activewear: { formality: 1, dayEvening: "day" },
};

/** Free-text activity names are the only signal for pool/beach or sport
 *  days, since the dress_code vocabulary has no entry for either. */
const SWIM_KEYWORDS = ["pool", "piscina", "swim", "nuot", "beach", "spiagg", "mare", "sea", "snorkel", "lido", "water park", "acquapark"];
const SPORT_KEYWORDS = ["yoga", "gym", "palestra", "run", "corsa", "hike", "trek", "workout", "fitness", "pilates", "bike", "cycl", "tennis", "padel", "climb"];

type ActivityKind = "swim" | "sport" | null;

/** Swim wins over sport when both read (a "pool workout" still needs a
 *  swimsuit); dress_code "Sport" only ever implies sport. */
function activityKind(req: Requirement): ActivityKind {
  const text = `${req.label ?? ""}`.toLowerCase();
  if (SWIM_KEYWORDS.some((k) => text.includes(k))) return "swim";
  if (SPORT_KEYWORDS.some((k) => text.includes(k)) || req.dressCode === "Sport") return "sport";
  return null;
}

/** The activity name must survive into the AI prompt even when a dress
 *  code exists — "Sport" alone loses "Yoga at sunset", and the prompt
 *  rules below key off those words. */
function occasionText(req: Requirement): string {
  const parts = [req.label, req.dressCode].filter(Boolean) as string[];
  if (!parts.length) return "Trip";
  return parts.length === 2 && parts[0] !== parts[1] ? `${parts[0]} (${parts[1]})` : parts[0];
}


/** Northern-hemisphere month→season, same convention as currentSeason()
 *  in wardrobe-image.ts — duplicated locally rather than imported, since
 *  that module pulls in the client-side Supabase singleton and this file
 *  runs server-side only. */
function seasonForDate(date: string): "Spring" | "Summer" | "Autumn" | "Winter" {
  const m = new Date(`${date}T00:00:00`).getMonth();
  if (m <= 1 || m === 11) return "Winter";
  if (m <= 4) return "Spring";
  if (m <= 7) return "Summer";
  return "Autumn";
}

/** Missing season data never hard-excludes an item — unlike formality and
 *  day/evening below, season is treated as a soft signal, not one of the
 *  two axes the requirement structure is built on. */
function matchesSeasonLoose(itemSeason: string | null | undefined, season: string): boolean {
  const s = (itemSeason ?? "").toLowerCase();
  if (!s) return true;
  if (s.includes("all")) return true;
  return s.includes(season.toLowerCase());
}

type PoolItem = {
  id: string;
  category: string | null;
  subcategory: string | null;
  colors: string[] | null;
  style: string[] | null;
  season: string | null;
  brand: string | null;
  material: string[] | null;
  locationId: string | null;
  formality: number;
  dayEvening: string;
};

type Requirement = {
  activityId: string;
  date: string;
  daySegment: "day" | "evening";
  dressCode: string | null;
  label: string | null;
};

function versatility(it: PoolItem): number {
  let score = 0;
  const colors = (it.colors ?? []).map((c) => c.toLowerCase());
  if (colors.some((c) => NEUTRAL_COLORS.some((n) => c.includes(n)))) score += 2;
  if (it.formality === 2 || it.formality === 3) score += 2;
  else if (it.formality === 1 || it.formality === 4) score += 1;
  if (it.dayEvening === "both") score += 2;
  return score;
}

function eligibleFor(pool: PoolItem[], req: Requirement, season: string): PoolItem[] {
  const [min, max] = req.dressCode ? (FORMALITY_RANGE[req.dressCode] ?? DEFAULT_FORMALITY_RANGE) : DEFAULT_FORMALITY_RANGE;
  const kind = activityKind(req);
  const purposeRole = kind === "swim" ? SWIM_ROLE : kind === "sport" ? ACTIVE_ROLE : null;
  return pool.filter((it) => {
    // A pool or gym day's defining garment is exempt from the formality
    // window: it's the right piece by purpose, not by score.
    const isPurpose = purposeRole?.has(it.category ?? "") ?? false;
    if (!isPurpose && (it.formality < min || it.formality > max)) return false;
    if (it.dayEvening !== "both" && it.dayEvening !== req.daySegment) return false;
    // Season is also skipped for the purpose garment: a swimsuit tagged
    // Summer is still the right piece for a February pool day abroad.
    if (!isPurpose && !matchesSeasonLoose(it.season, season)) return false;
    return true;
  });
}


function hasRole(items: PoolItem[], role: Set<string>): boolean {
  return items.some((it) => role.has(it.category ?? ""));
}

/**
 * Builds the capsule: the deterministic (non-AI) step of
 * Trip constraints → Capsule selection → suggestOutfitCore → validation → packing list.
 * Greedy, hardest-requirement-first: reuse what's already in the capsule
 * whenever it already covers top+bottom-or-dress+shoes for a requirement;
 * only pull in new items, ranked by versatility, when a role is missing.
 * This is Level 4 of the hierarchy (efficiency) — it never runs before
 * Levels 1-3 (coverage, validity) are what every eligibility check above
 * is already enforcing.
 */
function buildCapsule(pool: PoolItem[], requirements: Requirement[], seasonByDate: Map<string, string>): Set<string> {
  const capsule = new Set<string>();

  const withEligibility = requirements.map((req) => ({
    req,
    eligible: eligibleFor(pool, req, seasonByDate.get(req.date)!),
  }));
  // Hardest first = fewest eligible candidates in the whole wardrobe —
  // solving these while the capsule is still empty leaves the most
  // freedom; solving them last could find nothing left to work with.
  withEligibility.sort((a, b) => a.eligible.length - b.eligible.length);

  for (const { req, eligible } of withEligibility) {
    const inCapsule = eligible.filter((it) => capsule.has(it.id));
    const kind = activityKind(req);
    const missingRoles: Set<string>[] = [];
    // A swim or sport day needs its purpose garment in the capsule
    // first — otherwise the greedy pass only ever packs city tops and
    // the AI never sees a swimsuit to pick from.
    if (kind === "swim" && !hasRole(inCapsule, SWIM_ROLE)) missingRoles.push(SWIM_ROLE);
    if (kind === "sport" && !hasRole(inCapsule, ACTIVE_ROLE)) missingRoles.push(ACTIVE_ROLE);
    if (kind !== "swim") {
      if (!hasRole(inCapsule, TOP_ROLE) && !hasRole(inCapsule, BOTTOM_ROLE)) missingRoles.push(TOP_ROLE, BOTTOM_ROLE);
      else {
        if (!hasRole(inCapsule, TOP_ROLE)) missingRoles.push(TOP_ROLE);
        if (!hasRole(inCapsule, BOTTOM_ROLE)) missingRoles.push(BOTTOM_ROLE);
      }
    }
    if (!hasRole(inCapsule, SHOE_ROLE)) missingRoles.push(SHOE_ROLE);


    for (const role of missingRoles) {
      const candidates = eligible
        .filter((it) => role.has(it.category ?? "") && !capsule.has(it.id))
        .sort((a, b) => versatility(b) - versatility(a) || REWEARABILITY[b.category ?? ""] - REWEARABILITY[a.category ?? ""]);
      // Add up to 2 per missing role, not just 1 — a single top or single
      // pair of shoes for the whole trip is technically minimal but
      // leaves zero room for Level 6 (variety) later.
      candidates.slice(0, 2).forEach((it) => capsule.add(it.id));
    }
  }

  return capsule;
}

export const generateTripCapsule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: tripRow } = await (supabase.from("trips" as never) as any)
      .select("id, laundry_available").eq("id", data.tripId).eq("user_id", userId).maybeSingle();
    if (!tripRow) throw new Error("Trip not found");
    const trip = tripRow as { id: string; laundry_available: boolean };

    const [{ data: profileRow }, { data: sourceLocRows }, { data: activityRows }, { data: existingPlans }, { data: itemsRaw }] =
      await Promise.all([
        (supabase.from("profiles" as never) as any).select("dress_preferences, gender, style_boldness").eq("id", userId).maybeSingle(),
        (supabase.from("trip_source_locations" as never) as any).select("location_id").eq("trip_id", data.tripId),
        (supabase.from("trip_day_activities" as never) as any).select("*").eq("trip_id", data.tripId).order("activity_date"),
        (supabase.from("outfit_plans" as never) as any).select("trip_activity_id").eq("trip_id", data.tripId),
        supabase.from("wardrobe_items").select("*").eq("user_id", userId).eq("archived", false),
      ]);

    const profile = profileRow as { dress_preferences?: DressPreferences; gender?: string | null; style_boldness?: string | null } | null;
    const dressRules = dressPreferencesToPrompt(profile?.dress_preferences ?? null);
    const sourceLocationIds = ((sourceLocRows ?? []) as { location_id: string }[]).map((r) => r.location_id);

    // --- One requirement per logged activity: since outfit_plans is now
    // keyed on trip_activity_id (partial UNIQUE), two activities in the
    // same afternoon each get their own look instead of being merged
    // into a single "A + B" plan. A date with zero logged activities
    // still gets no requirement at all. ---
    const activities = (activityRows ?? []) as {
      id: string; activity_date: string; activity_type: string; day_segment: string | null; dress_code: string | null;
    }[];
    const targeted = data.activityIds?.length ? new Set(data.activityIds) : null;
    const allRequirements: Requirement[] = activities
      .filter((a) => !targeted || targeted.has(a.id))
      .map((a) => ({
        activityId: a.id,
        date: a.activity_date,
        daySegment: a.day_segment === "evening" ? "evening" : "day",
        dressCode: a.dress_code,
        label: a.activity_type,
      }));

    // Targeted runs mean "regenerate this one" — the existing plan is
    // overwritten by the upsert rather than skipped.
    const plannedActivityIds = new Set(
      ((existingPlans ?? []) as { trip_activity_id: string | null }[])
        .map((p) => p.trip_activity_id)
        .filter((id): id is string => !!id),
    );
    const requirements = targeted
      ? allRequirements
      : allRequirements.filter((r) => !plannedActivityIds.has(r.activityId));
    const skippedExisting = allRequirements.length - requirements.length;

    // Credit- and cost-conscious cap — a trip logging more than 30
    // activities in one go is not the common case, and this keeps a
    // single run from firing an unbounded number of AI calls.
    const capped = requirements.slice(0, 30);

    if (capped.length === 0) {
      return {
        generated: 0, skippedExisting, failed: [] as { date: string; daySegment: string; reason: string }[],
        unclassifiedExcluded: 0, packingItemsAdded: 0,
      };
    }

    // --- Wardrobe pool, filtered deterministically before anything else
    // runs — Level 0/1 of the hierarchy. Items missing formality or
    // day_evening are excluded rather than defaulted: per the roadmap
    // doc, "dato mancante → non si assume mai un valore arbitrario". ---
    const allItems = (itemsRaw ?? []) as any[];
    const locationFiltered = sourceLocationIds.length
      ? allItems.filter((it) => it.location_id == null || sourceLocationIds.includes(it.location_id))
      : allItems;
    const pool: PoolItem[] = [];
    let unclassifiedExcluded = 0;
    for (const it of locationFiltered) {
      // Swimwear/Activewear are single-purpose categories that almost
      // nobody classifies, so an implicit casual/daytime reading is used
      // instead of dropping them — for every other category a missing
      // value is still never guessed.
      const implicit = IMPLICIT_CLASSIFICATION[it.category ?? ""];
      const formality = it.formality ?? implicit?.formality ?? null;
      const dayEvening = it.day_evening || implicit?.dayEvening || null;
      if (formality == null || !dayEvening) { unclassifiedExcluded++; continue; }
      pool.push({
        id: it.id, category: it.category, subcategory: it.subcategory,
        colors: it.colors ?? (it.color ? [it.color] : []),
        style: it.style ? (Array.isArray(it.style) ? it.style : [it.style]) : [],
        season: it.season, brand: it.brand, material: Array.isArray(it.material) ? it.material : [],
        locationId: it.location_id ?? null, formality, dayEvening,

      });
    }

    const seasonByDate = new Map<string, string>();
    capped.forEach((r) => { if (!seasonByDate.has(r.date)) seasonByDate.set(r.date, seasonForDate(r.date)); });

    const capsule = buildCapsule(pool, capped, seasonByDate);

    const created: { date: string; daySegment: string }[] = [];
    const failed: { date: string; daySegment: string; reason: string }[] = [];
    const usedRecently: string[] = [];
    const allChosenItemIds = new Set<string>();

    for (const req of capped) {
      const season = seasonByDate.get(req.date)!;
      const eligible = eligibleFor(pool, req, season);
      let candidatePool = eligible.filter((it) => capsule.has(it.id));
      // Falls back to the full eligible set only if the capsule subset is
      // too thin to plausibly compose a real outfit — never silently
      // fails a requirement the wardrobe could actually cover.
      if (candidatePool.length < 3) candidatePool = eligible;

      if (candidatePool.length === 0) {
        failed.push({ date: req.date, daySegment: req.daySegment, reason: "No wardrobe piece matches this activity's dress code, weather window, or day/evening slot." });
        continue;
      }

      const items: SuggestOutfitItem[] = candidatePool.map((it) => ({
        id: it.id, category: it.category, subcategory: it.subcategory, colors: it.colors,
        style: it.style, season: it.season, brand: it.brand, material: it.material, locationId: it.locationId,
      }));

      // Estimated, not measured: no live forecast is wired in for dates
      // that may be months out — see docs/roadmap/trip-capsule-packing.md.
      // suggestOutfitCore gets no temperature at all rather than a
      // fabricated one; season already filtered the pool above.
      // Variety (Level 6) is sought only within what reuse (Level 4)
      // already allows — never the other way round. Without laundry the
      // capsule IS the point, so avoidance stays light (don't fight
      // reuse); with laundry there's more room to actively vary looks.
      const avoidWindow = trip.laundry_available ? 8 : 2;
      const result = await suggestOutfitCore({
        supabase, userId,
        temperature: null,
        condition: null,
        occasion: occasionText(req),
        dressRules,
        gender: profile?.gender ?? null,
        styleBoldness: profile?.style_boldness ?? null,
        items,
        avoidItemIds: usedRecently.slice(-avoidWindow),
        locationIdOverride: null,
      });

      if (!result.ok || !result.item_ids.length) {
        failed.push({ date: req.date, daySegment: req.daySegment, reason: !result.ok ? result.error : "Couldn't compose a valid look from the eligible pieces." });
        continue;
      }

      usedRecently.push(...result.item_ids);
      result.item_ids.forEach((id) => allChosenItemIds.add(id));

      const { error: insErr } = await supabase.from("outfit_plans").upsert({
        user_id: userId,
        trip_id: data.tripId,
        trip_activity_id: req.activityId,
        date: req.date,
        day_segment: req.daySegment,
        item_ids: result.item_ids,
        occasion: req.label ?? req.dressCode ?? null,
        notes: result.explanation || null,
        status: "planned",
      } as never, { onConflict: resolvePlanSlot({ tripActivityId: req.activityId }).onConflict });

      if (insErr) {
        failed.push({ date: req.date, daySegment: req.daySegment, reason: insErr.message });
        continue;
      }
      created.push({ date: req.date, daySegment: req.daySegment });
    }

    // --- Packing list: only now, per the sequence in the roadmap doc.
    // Never overwrites a piece the person already marked packed by hand
    // — only fills in what's missing. ---
    let packingItemsAdded = 0;
    if (allChosenItemIds.size) {
      const { data: existingPacking } = await (supabase.from("trip_packing_items" as never) as any)
        .select("item_id").eq("trip_id", data.tripId);
      const already = new Set(((existingPacking ?? []) as { item_id: string }[]).map((r) => r.item_id));
      const toInsert = Array.from(allChosenItemIds).filter((id) => !already.has(id));
      if (toInsert.length) {
        const { error: packErr } = await (supabase.from("trip_packing_items" as never) as any)
          .insert(toInsert.map((item_id) => ({ trip_id: data.tripId, item_id, status: "to_pack" })));
        if (!packErr) packingItemsAdded = toInsert.length;
      }
    }

    return {
      generated: created.length,
      skippedExisting,
      failed,
      unclassifiedExcluded,
      packingItemsAdded,
    };
  });
