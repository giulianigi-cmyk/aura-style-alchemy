import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { suggestOutfitCore, type SuggestOutfitItem } from "./ai-suggest-outfit.functions";
import { dressPreferencesToPrompt, type DressPreferences } from "./dress-preferences";
import { resolvePlanSlot } from "./outfit-plan-slot";
import { getTripWeatherMap, weatherKey } from "./trip-weather.server";
import { describeWeather } from "./weather";

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

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

/** A material tagged "Winter" on the piece doesn't mean much once real
 *  weather is known for the day — a cashmere sweater is wrong for 30°C
 *  regardless of what season it was classified under. Real temperature
 *  wins over the season tag when the two conflict. Applied where the
 *  day's actual weather is available (see the main generation loop);
 *  capsule building itself still uses season, since it has no per-day
 *  temperature to work with. */
const HEAVY_MATERIALS = ["cashmere", "wool", "mohair", "alpaca", "shearling", "down"];
const HEAVY_MATERIAL_TEMP_THRESHOLD = 23;

/** Free-text signal for "this trip has a real reason to need an elegant
 *  shoe" — a resort dinner or a wedding guest activity, not just any
 *  logged activity. Deliberately narrow: owning a heel doesn't mean one
 *  has to be packed, only that there's a genuine occasion for it. */
const ELEGANT_KEYWORDS = ["dinner", "cena", "restaurant", "ristorante", "gala", "wedding", "matrimonio", "cocktail", "resort", "exclusive", "esclusiv", "fine dining", "black tie"];

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
const BAG_ROLE = new Set(["Bags"]);

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

/** True only when this specific requirement gives a genuine reason to
 *  need an elegant piece — an explicit high-formality dress code, or the
 *  activity's own wording (a resort dinner, a wedding). Owning a heel
 *  doesn't create the need; a requirement like this does. */
function hasEleganceSignal(req: Requirement): boolean {
  if (req.dressCode) {
    const [, max] = FORMALITY_RANGE[req.dressCode] ?? DEFAULT_FORMALITY_RANGE;
    if (max >= 4) return true;
  }
  const text = `${req.label ?? ""} ${req.dressCode ?? ""}`.toLowerCase();
  return ELEGANT_KEYWORDS.some((k) => text.includes(k));
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

function versatility(it: PoolItem, req?: Requirement): number {
  let score = 0;
  const colors = (it.colors ?? []).map((c) => c.toLowerCase());
  if (colors.some((c) => NEUTRAL_COLORS.some((n) => c.includes(n)))) score += 2;
  if (it.formality === 2 || it.formality === 3) score += 2;
  else if (it.formality === 1 || it.formality === 4) score += 1;
  if (it.dayEvening === "both") score += 2;
  // Formality/day-evening are no longer hard filters in eligibleFor (see
  // there for why) — this is what keeps a genuinely well-matched piece
  // ranked above a merely-available one, without excluding the latter
  // outright when it's all there is.
  if (req) {
    const [min, max] = req.dressCode ? (FORMALITY_RANGE[req.dressCode] ?? DEFAULT_FORMALITY_RANGE) : DEFAULT_FORMALITY_RANGE;
    if (it.formality >= min && it.formality <= max) score += 3;
    if (it.dayEvening === req.daySegment) score += 2;
  }
  return score;
}

function eligibleFor(pool: PoolItem[], req: Requirement, season: string): PoolItem[] {
  const kind = activityKind(req);
  const purposeRole = kind === "swim" ? SWIM_ROLE : kind === "sport" ? ACTIVE_ROLE : null;
  return pool.filter((it) => {
    const isPurpose = purposeRole?.has(it.category ?? "") ?? false;
    // A bag belonging to another day's capsule was still passing this
    // filter on a swim/sport day (season is the only real check now) and
    // showing up in the AI's catalog with nothing telling it not to pick
    // one. Hard-excluded here regardless of season or capsule membership
    // — a gym bag or beach tote isn't the same category and isn't
    // classified as "Bags", so this doesn't touch those.
    if ((kind === "swim" || kind === "sport") && BAG_ROLE.has(it.category ?? "")) return false;
    // Formality range and exact day/evening match used to be hard
    // exclusions here, combined with season in one AND — three narrow
    // filters stacked together could crush the eligible pool down to a
    // handful of pieces even on a wardrobe with plenty of genuinely
    // wearable options. Season stays the real filter (already lenient:
    // untagged or "All Seasons" always passes); formality and day/evening
    // now only influence ranking (versatility() below, and the AI's own
    // occasion-aware judgment in suggestOutfitCore) instead of excluding.
    // The swim/sport purpose exemption is unaffected — that's a genuine
    // "wrong item for this specific activity" case, not an over-filter.
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

  // 2 per role was a flat floor regardless of trip length — fine for a
  // weekend, thin for anything longer (a 10-day trip with only 2 tops
  // rotates 5x each). Scales gently with the number of requirements
  // (~2 per day), capped so it never balloons into "pack everything".
  const perRoleTarget = Math.min(2 + Math.floor(requirements.length / 4), 5);
  // Shoes don't need the same rotation depth as tops/bottoms — they're
  // bulky to pack and get reworn far more before anyone notices. Scaling
  // them the same way as tops turned "add one more top" into "also add a
  // third pair of sneakers", which is the opposite of what a capsule is for.
  const shoeTarget = Math.min(perRoleTarget, 2);
  // Bags were never guaranteed a slot in the capsule at all before — the
  // AI's gender-aware prompt could suggest one, but only if an eligible
  // bag happened to already be in the pool by chance. A short trip only
  // needs one bag total; a week or longer earns a second (day + evening).
  const approxTripDays = Math.max(1, Math.ceil(requirements.length / 2));
  const bagTarget = approxTripDays >= 7 ? 2 : 1;
  // Tops in hot weather want closer to one fresh piece per day (sweat,
  // not just looking different) — cooler seasons tolerate a top worn
  // twice comfortably, which perRoleTarget already reflects.
  const isSummerTrip = requirements.some((r) => seasonByDate.get(r.date) === "Summer");
  const topTarget = isSummerTrip ? Math.min(approxTripDays, 6) : perRoleTarget;

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
    // A pool day doesn't want a handbag, but everyday/evening looks do —
    // added last so it never displaces a top/bottom/shoe pick above.
    if (kind !== "swim" && kind !== "sport" && !hasRole(inCapsule, BAG_ROLE)) missingRoles.push(BAG_ROLE);


    for (const role of missingRoles) {
      // Was a pure deterministic sort (versatility, then rewearability) —
      // with the same wardrobe and the same day, that always picked the
      // exact same top-N pieces, every single regenerate. Deleting a plan
      // and regenerating looked like it "remembered" the old pieces, but
      // it was actually just recomputing the identical answer from
      // scratch. A small random jitter on top of the real score means a
      // strong match still wins most of the time, but not always —
      // regenerating now has a real chance of surfacing something else.
      const candidates = eligible
        .filter((it) => role.has(it.category ?? "") && !capsule.has(it.id))
        .map((it) => ({ it, score: versatility(it, req) + REWEARABILITY[it.category ?? ""] * 0.3 + Math.random() * 2.5 }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.it);
      // Add up to perRoleTarget per missing role, not a flat 2 — a single
      // top or single pair of shoes for the whole trip is technically
      // minimal but leaves zero room for Level 6 (variety) later. Shoes
      // and bags use their own lower targets (see above).
      const target = role === SHOE_ROLE ? shoeTarget : role === BAG_ROLE ? bagTarget : role === TOP_ROLE ? topTarget : perRoleTarget;
      candidates.slice(0, target).forEach((it) => capsule.add(it.id));
    }
  }

  // A formal-enough shoe protected against being crowded out by the
  // shoe cap above — only when this trip actually has a reason to need
  // one (see hasEleganceSignal). Owning a heel never forces it in;
  // an activity like a resort dinner does. Deliberately outside the
  // normal target/cap logic: this is a reserved slot, not a ranked pick.
  if (requirements.some(hasEleganceSignal)) {
    const alreadyHasElegantShoe = Array.from(capsule).some((id) => {
      const it = pool.find((p) => p.id === id);
      return it?.category === "Shoes" && it.formality >= 4;
    });
    if (!alreadyHasElegantShoe) {
      const bestElegantShoe = pool
        .filter((it) => it.category === "Shoes" && it.formality >= 4 && !capsule.has(it.id))
        .sort((a, b) => versatility(b) - versatility(a))[0];
      if (bestElegantShoe) capsule.add(bestElegantShoe.id);
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

    // A trip's date range is the union of its destinations' ranges — trips
    // itself carries no dates (a trip can have several destinations, each
    // with its own start/end).
    const { data: destRows } = await (supabase.from("trip_destinations" as never) as any)
      .select("start_date, end_date, latitude, longitude").eq("trip_id", data.tripId);
    const destinations = (destRows ?? []) as { start_date: string; end_date: string; latitude: number | null; longitude: number | null }[];
    const tripStartDate = destinations.length ? destinations.map((d) => d.start_date).sort()[0] : null;
    const tripEndDate = destinations.length ? destinations.map((d) => d.end_date).sort().slice(-1)[0] : null;

    /** Which destination a given trip date falls under — a multi-stop trip
     *  needs the right city's weather, not just the first one. Falls back
     *  to the nearest destination by date when nothing matches exactly
     *  (e.g. a scaffolded day sitting right on a gap between two legs). */
    function destinationForDate(date: string): { latitude: number | null; longitude: number | null } | null {
      const withCoords = destinations.filter((d) => d.latitude != null && d.longitude != null);
      if (!withCoords.length) return null;
      const exact = withCoords.find((d) => date >= d.start_date && date <= d.end_date);
      if (exact) return exact;
      return withCoords.reduce((closest, d) => {
        const dist = Math.min(Math.abs(daysBetween(date, d.start_date)), Math.abs(daysBetween(date, d.end_date)));
        const closestDist = Math.min(Math.abs(daysBetween(date, closest.start_date)), Math.abs(daysBetween(date, closest.end_date)));
        return dist < closestDist ? d : closest;
      }, withCoords[0]);
    }

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
    let activities = (activityRows ?? []) as {
      id: string; activity_date: string; activity_type: string; day_segment: string | null; dress_code: string | null;
    }[];

    // A trip with no itinerary at all shouldn't produce nothing — per the
    // roadmap doc, packing should work even for a "figure it out when I
    // get there" trip. Scaffold a generic day + evening slot for every
    // date in the trip that has no logged activity in that segment yet;
    // any date that already has a real activity is left exactly as the
    // person entered it. Only runs on a full-trip generate — a targeted
    // regenerate of specific activities has no business inventing new ones.
    if (!data.activityIds?.length && tripStartDate && tripEndDate) {
      const covered = new Set(
        activities.map((a) => `${a.activity_date}|${a.day_segment === "evening" ? "evening" : "day"}`),
      );
      const tripDates: string[] = [];
      for (let d = new Date(`${tripStartDate}T00:00:00`); d <= new Date(`${tripEndDate}T00:00:00`); d.setDate(d.getDate() + 1)) {
        tripDates.push(d.toISOString().slice(0, 10));
      }
      const toInsert = tripDates.flatMap((date) =>
        (["day", "evening"] as const)
          .filter((segment) => !covered.has(`${date}|${segment}`))
          .map((segment) => ({
            trip_id: data.tripId,
            activity_date: date,
            activity_type: segment === "day" ? "Day" : "Evening",
            day_segment: segment,
            destination_id: null,
            dress_code: null,
            notes: null,
          })),
      );
      if (toInsert.length) {
        const { data: inserted, error: scaffoldErr } = await (supabase.from("trip_day_activities" as never) as any)
          .insert(toInsert)
          .select("id, activity_date, activity_type, day_segment, dress_code");
        if (!scaffoldErr && inserted) activities = [...activities, ...(inserted as typeof activities)];
      }
    }

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

    // No early-return when capped is empty (e.g. everything's already
    // generated): the for-loop below is a no-op on an empty array, and
    // exiting early here used to skip the underwear/packing-list step
    // further down entirely — a second "Generate" press with nothing new
    // to plan would silently never add underwear at all.

    // One batched lookup for every unique (destination, date) the capped
    // requirements actually touch — not one call per requirement, since a
    // day and evening requirement on the same date share the same weather.
    const weatherRequests = capped
      .map((r) => {
        const dest = destinationForDate(r.date);
        return dest?.latitude != null && dest?.longitude != null
          ? { lat: dest.latitude, lon: dest.longitude, date: r.date }
          : null;
      })
      .filter((r): r is { lat: number; lon: number; date: string } => r !== null);
    const weatherMap = weatherRequests.length ? await getTripWeatherMap(weatherRequests) : new Map();

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
    const usedOutfits: string[][] = [];
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

      // Real forecast within ~15 days, a 5-year historical average beyond
      // that — see trip-weather.server.ts. Missing coordinates (no
      // destination lat/lon saved) falls back to null exactly as before,
      // rather than guessing a temperature.
      const dest = destinationForDate(req.date);
      const wKey = dest?.latitude != null && dest?.longitude != null ? weatherKey(dest.latitude, dest.longitude, req.date) : null;
      const dayWeather = wKey ? weatherMap.get(wKey) ?? null : null;
      const temperature = dayWeather ? (req.daySegment === "evening" ? dayWeather.tempMin : dayWeather.tempMax) : null;
      const condition = dayWeather ? describeWeather(dayWeather.weatherCode).label : null;

      // The season tag is a soft signal (matchesSeasonLoose above); real
      // temperature for the day, when known, overrides it outright for
      // heavy materials — a cashmere sweater tagged "Winter" is still
      // wrong for a 30°C day in a warm-climate destination in February.
      // Only excludes when temperature is actually known; unknown stays
      // exactly as season-filtered as before.
      const isHot = temperature != null && temperature >= HEAVY_MATERIAL_TEMP_THRESHOLD;
      const weatherFiltered = isHot
        ? candidatePool.filter((it) => !(it.material ?? []).some((m) => HEAVY_MATERIALS.includes(m.toLowerCase())))
        : candidatePool;
      // Never let the weather filter empty the pool outright — falls
      // back to the unfiltered candidates rather than failing the day.
      const finalPool = weatherFiltered.length > 0 ? weatherFiltered : candidatePool;

      const items: SuggestOutfitItem[] = finalPool.map((it) => ({
        id: it.id, category: it.category, subcategory: it.subcategory, colors: it.colors,
        style: it.style, season: it.season, brand: it.brand, material: it.material, locationId: it.locationId,
      }));

      // Variety (Level 6) is sought only within what reuse (Level 4)
      // already allows — never the other way round. The window is
      // measured in whole outfits, not a flat item count: an outfit is
      // ~3 items, so a count-based window smaller than that let the very
      // next outfit reuse a piece from the one just generated — visible
      // as the same top three times in six outfits. Without laundry the
      // capsule still reuses pieces across the trip on purpose, but not
      // the literal same piece two outfits in a row; with laundry there's
      // more room to actively vary looks. suggestOutfitCore already
      // relaxes this itself if excluding recent items leaves too little
      // to compose a real outfit from, so widening this is safe.
      const avoidOutfitWindow = trip.laundry_available ? 3 : 2;
      const result = await suggestOutfitCore({
        supabase, userId,
        temperature,
        condition,
        occasion: occasionText(req),
        dressRules,
        gender: profile?.gender ?? null,
        styleBoldness: profile?.style_boldness ?? null,
        items,
        avoidItemIds: usedOutfits.slice(-avoidOutfitWindow).flat(),
        locationIdOverride: null,
      });

      if (!result.ok || !result.item_ids.length) {
        failed.push({ date: req.date, daySegment: req.daySegment, reason: !result.ok ? result.error : "Couldn't compose a valid look from the eligible pieces." });
        continue;
      }

      usedOutfits.push(result.item_ids);
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
        weather_temp: temperature != null ? Math.round(temperature) : null,
        weather_condition: condition,
        weather_estimated: dayWeather?.estimated ?? null,
      } as never, { onConflict: resolvePlanSlot({ tripActivityId: req.activityId }).onConflict });

      if (insErr) {
        failed.push({ date: req.date, daySegment: req.daySegment, reason: insErr.message });
        continue;
      }
      created.push({ date: req.date, daySegment: req.daySegment });
    }

    // --- Underwear / sleepwear: excluded from `pool` above along with
    // every other unclassified item (formality and day/evening genuinely
    // don't apply to a bra or a pair of socks, so nobody ever fills them
    // in) — meaning this whole category never reached the capsule or the
    // packing list at all, regardless of trip length. Handled here as a
    // flat quantity scaled to the trip's day count instead, straight from
    // what's actually owned — never invents a count beyond that, per the
    // "never invent pieces" rule the outfit engine already follows.
    // Which subcategories apply is gender-aware: a men's packing list has
    // no reason to include bras, a women's list wants briefs/panties
    // rather than boxers. An unset gender keeps the broader previous
    // behavior rather than guessing.
    const totalTripDays = tripStartDate && tripEndDate
      ? Math.max(1, Math.round(daysBetween(tripEndDate, tripStartDate)) + 1)
      : new Set(capped.map((r) => r.date)).size;
    const underwearPool = locationFiltered.filter((it) => it.category === "Underwear");
    const takeUpTo = (items: any[], n: number) => items.slice(0, Math.max(0, n)).map((it) => it.id as string);
    const bottomsSubcats = profile?.gender === "Man" ? ["Boxers", "Briefs"] : profile?.gender === "Woman" ? ["Briefs", "Panties"] : ["Briefs", "Panties", "Boxers"];
    const includeBras = profile?.gender !== "Man";
    // A pajama set is worn for days, not once — one every 5-7 days of
    // trip is enough rotation, not a flat 2 regardless of length.
    const sleepwearTarget = Math.max(1, Math.ceil(totalTripDays / 6));
    takeUpTo(underwearPool.filter((it) => bottomsSubcats.includes(it.subcategory)), totalTripDays)
      .forEach((id) => allChosenItemIds.add(id));
    if (includeBras) {
      takeUpTo(underwearPool.filter((it) => ["Bra", "Sports Bra"].includes(it.subcategory)), Math.ceil(totalTripDays / 3))
        .forEach((id) => allChosenItemIds.add(id));
    }
    takeUpTo(underwearPool.filter((it) => it.subcategory === "Socks"), totalTripDays)
      .forEach((id) => allChosenItemIds.add(id));
    takeUpTo(underwearPool.filter((it) => it.subcategory === "Sleepwear"), sleepwearTarget)
      .forEach((id) => allChosenItemIds.add(id));

    // Real owned pieces above cover people who've photographed their
    // underwear; most people haven't. This adds the same quantities as a
    // plain Essentials checklist entry (no photo needed) so the suggestion
    // still shows up either way — "you need 3 pairs, 1 bra" rather than
    // nothing at all. Only inserted if not already there, same
    // never-overwrite rule as the photographed packing list above.
    const { data: existingEssentials } = await (supabase.from("trip_essentials" as never) as any)
      .select("name").eq("trip_id", data.tripId).eq("category", "Underwear");
    const existingEssentialNames = new Set(((existingEssentials ?? []) as { name: string }[]).map((e) => e.name));
    const essentialTargets: { name: string; quantity: number }[] = [
      { name: "Underwear", quantity: totalTripDays },
      ...(includeBras ? [{ name: "Bras", quantity: Math.ceil(totalTripDays / 3) }] : []),
      { name: "Socks", quantity: totalTripDays },
      { name: "Sleepwear", quantity: sleepwearTarget },
    ];
    const essentialsToInsert = essentialTargets.filter((t) => t.quantity > 0 && !existingEssentialNames.has(t.name));
    if (essentialsToInsert.length) {
      await (supabase.from("trip_essentials" as never) as any).insert(
        essentialsToInsert.map((t) => ({ trip_id: data.tripId, category: "Underwear", name: t.name, quantity: t.quantity, status: "to_pack" })),
      );
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
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "./ai-json";
import { isItemAtLocation } from "./wardrobe-location";

const ItemSchema = z.object({
  id: z.string(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  colors: z.array(z.string()).nullable().optional(),
  style: z.array(z.string()).nullable().optional(),
  season: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  material: z.array(z.string()).nullable().optional(),
  locationId: z.string().nullable().optional(),
});

const InputSchema = z.object({
  temperature: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  occasion: z.string().nullable().optional(),
  dressRules: z.string().nullable().optional(),
  items: z.array(ItemSchema).min(1),
  avoidItemIds: z.array(z.string()).optional(),
});

const OutputSchema = z.object({
  item_ids: z.array(z.string()),
  explanation: z.string(),
});

export type SuggestOutfitItem = z.infer<typeof ItemSchema>;

export async function suggestOutfitCore(params: {
  supabase: any;
  userId: string;
  temperature: number | null;
  condition: string | null;
  occasion: string | null;
  dressRules: string | null;
  gender?: string | null;
  styleBoldness?: string | null;
  items: SuggestOutfitItem[];
  avoidItemIds?: string[];
  locationIdOverride?: string | null;
}): Promise<{ ok: true; item_ids: string[]; explanation: string } | { ok: false; error: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-2.5-flash");

  // A caller (like the weekly generator) can explicitly choose which
  // location to build from for this run, rather than always defaulting
  // to whatever's currently active — useful when generating outfits for
  // a period spent somewhere other than the active location.
  let locationId = params.locationIdOverride;
  if (locationId === undefined) {
    const { data: profileRow } = await (params.supabase.from("profiles" as never) as any)
      .select("active_location_id").eq("id", params.userId).maybeSingle();
    locationId = (profileRow as { active_location_id: string | null } | null)?.active_location_id ?? null;
  }
  let activeLocation: { id: string; is_primary: boolean } | null = null;
  if (locationId) {
    const { data: locRow } = await (params.supabase.from("wardrobe_locations" as never) as any)
      .select("id, is_primary").eq("id", locationId).eq("user_id", params.userId).maybeSingle();
    if (locRow) activeLocation = locRow as { id: string; is_primary: boolean };
  }
  let eligibleItems = params.items.filter((it) =>
    isItemAtLocation({ location_id: it.locationId ?? null }, activeLocation));

  // Excluding items already used earlier in a multi-day batch is how
  // repeats get avoided across a generated week — done per category so a
  // shortage in one (e.g. only one or two bags owned) doesn't force
  // avoidance to relax for every other category too. A top only comes
  // back into rotation when tops specifically run out, not because bags
  // ran out first.
  if (params.avoidItemIds?.length) {
    const avoidSet = new Set(params.avoidItemIds);
    const byCategory = new Map<string, SuggestOutfitItem[]>();
    for (const it of eligibleItems) {
      const cat = it.category ?? "";
      const arr = byCategory.get(cat) ?? [];
      arr.push(it);
      byCategory.set(cat, arr);
    }
    const filtered: SuggestOutfitItem[] = [];
    for (const catItems of byCategory.values()) {
      const withoutRecent = catItems.filter((it) => !avoidSet.has(it.id));
      filtered.push(...(withoutRecent.length > 0 ? withoutRecent : catItems));
    }
    eligibleItems = filtered;
  }

  const wx = params.temperature != null
    ? `Weather: ${Math.round(params.temperature)}°C, ${params.condition ?? "unknown"}.`
    : "Weather: unknown.";
  const occ = params.occasion ? `Occasion: ${params.occasion}.` : "Occasion: everyday.";

  const catalog = eligibleItems.slice(0, 200).map((it) => ({
    id: it.id,
    category: it.category ?? "",
    subcategory: it.subcategory ?? "",
    colors: it.colors ?? [],
    style: it.style ?? [],
    season: it.season ?? "",
    brand: it.brand ?? "",
    material: it.material ?? [],
  }));

  const genderLine = params.gender === "Man"
    ? "This wardrobe belongs to a man: compose top + bottom (or a single one-piece garment) + shoes, and only add a bag if it genuinely fits the look — a bag is not a standard component for a men's outfit the way it is for women's. An accessory (belt, watch, scarf) is welcome when it adds something."
    : params.gender === "Woman"
    ? "This wardrobe belongs to a woman: a bag is a standard component of a complete outfit alongside top + bottom (or a dress) + shoes — include one whenever a suitable bag is available, plus an accessory when it adds something. Exception: never include a bag for a Sport occasion or a pool/beach/swim occasion — a handbag has no place at the gym or in the water."
    : null;

  const boldnessLine = params.styleBoldness === "Bold" || params.styleBoldness === "Creative"
    ? "This person likes to experiment: within every constraint above, lean into color and pattern — mixed prints, a strong color pairing, or a statement piece are welcome rather than defaulting to the safest neutral combination."
    : params.styleBoldness === "Classic"
    ? "This person prefers a classic wardrobe: favor neutral, coordinated colors and minimal pattern-mixing over bold color or print combinations, even when a bolder pairing would technically also work."
    : null;

  const system = [
    ...(params.dressRules ? [params.dressRules, ""] : []),
    "You are a personal stylist. Compose ONE coherent outfit from the user's wardrobe.",
    "Pick 3-5 items that work together (typically 1 top + 1 bottom OR 1 dress, + 1 shoes, optionally 1 outerwear and 1 accessory/bag).",
    ...(genderLine ? [genderLine] : []),
    "Match the weather and occasion. Prefer colors that harmonize and consistent style.",
    "Never combine black and navy/dark blue in the same outfit — two near-identical dark neutrals read as a styling mistake, not a deliberate choice, even though each looks fine on its own. Pick one dark neutral for the outfit, not both.",
    "Above ~25°C, prefer a top that hasn't already been worn earlier in this batch over one that has, even if it scores slightly lower on style — a fresh piece matters more in hot weather (sweat, hygiene) than in cooler seasons, where repeating a top once or twice is completely normal.",
    ...(boldnessLine ? [boldnessLine] : []),
    "NEVER pick more than one outerwear/layering piece in the same outfit — a blazer and a cardigan (or any two of blazer/cardigan/jacket/coat) are never worn together. Pick at most one.",
    "Weather overrides everything else for outerwear: above ~26°C, do not include a blazer, jacket, cardigan, or coat at all, regardless of occasion — a lightweight top alone is correct. Only add outerwear when the temperature genuinely calls for it.",
    // The occasion string carries the real activity name (e.g. "Yoga at
    // sunset (Sport)"), not just a dress-code label, so these rules can
    // key off what the day actually is.
    "If the occasion mentions a pool, swimming, the beach or the sea (pool, piscina, swim, beach, spiaggia, mare, snorkeling): the outfit MUST be built around a Swimwear item — a one-piece swimsuit, or a bikini top AND bikini bottom together — instead of the usual top + bottom. Add a cover-up, a light top/shorts or a dress only as a layer over it, plus sandals/flats and sunglasses if available — never a bag. Never return a city outfit for a swim occasion, and never pair a bikini top with trousers or a skirt.",
    "If the occasion is Sport or mentions yoga, gym, running, hiking, training, pilates, tennis or cycling: the outfit MUST be built from Activewear pieces (sports bra / training top + leggings, bike shorts or running shorts) with sneakers or the appropriate sport shoe. Exclude denim, tailoring, dresses, heels and anything delicate, and honour the specific activity named — hiking wants covered, sturdy shoes, yoga wants soft stretch pieces.",
    "If the occasion is Travel (a flight, a transfer, a long drive): prioritise comfort and layers — soft, non-restrictive pieces, closed comfortable shoes (sneakers or flats, no heels), and one light layer that can go on and off.",
    "For a 'Work' occasion specifically, exclude anything sequinned, sparkly, or overtly evening/party-coded (check the material field for sequin/sparkle/lurex/metallic), exclude cocktail or evening dresses, and exclude very short skirts (mini-length) — these read as going-out wear, not workwear, even if the color/formality score looks fine on paper.",
    "Use each item's subcategory when present to judge fit-for-purpose: e.g. in hot weather prefer sandals/flats over boots; in rain or cold prefer boots over sandals; for formal occasions prefer pumps/heels over sneakers. When subcategory is empty, judge from category alone.",
    "Return ONLY item ids that exist in the provided catalog. Never invent ids.",
    "Explanation: 1-2 short sentences (max 200 chars) on why these pieces work.",
    "",
    "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
    '{"item_ids": ["id1", "id2"], "explanation": "short reason"}',
  ].join("\n");

  const userContent = `${wx} ${occ}\nWardrobe:\n${JSON.stringify(catalog)}`;
  try {
    let text: string;
    try {
      const r1 = await generateText({
        model,
        system,
        messages: [{ role: "user", content: userContent }],
      });
      text = r1.text;
    } catch (err) {
      console.error("[AURA suggest-outfit] first call failed", err);
      text = "";
    }

    let parsed: z.infer<typeof OutputSchema>;
    try {
      parsed = parseAiJson(text, OutputSchema);
    } catch {
      const r2 = await generateText({
        model,
        system,
        messages: [
          { role: "user", content: userContent },
          { role: "assistant", content: text || "(no response)" },
          {
            role: "user",
            content: "That was not a single valid JSON object matching the required shape. Reply again with ONLY the JSON object, nothing else.",
          },
        ],
      });
      parsed = parseAiJson(r2.text, OutputSchema);
    }

    const validIds = new Set(catalog.map((c) => c.id));
    const item_ids = parsed.item_ids.filter((id) => validIds.has(id)).slice(0, 5);
    return {
      ok: true as const,
      item_ids,
      explanation: (parsed.explanation ?? "").slice(0, 240),
    };
  } catch (err) {
    console.error("[AURA suggest-outfit] failed", err);
    return { ok: false as const, error: err instanceof Error ? err.message : "AI failed" };
  }
}

export const suggestOutfitAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: profileRow } = await (context.supabase.from("profiles" as never) as any)
      .select("gender, style_boldness").eq("id", context.userId).maybeSingle();
    const profile = profileRow as { gender?: string | null; style_boldness?: string | null } | null;

    return suggestOutfitCore({
      supabase: context.supabase,
      userId: context.userId,
      temperature: data.temperature ?? null,
      condition: data.condition ?? null,
      occasion: data.occasion ?? null,
      dressRules: data.dressRules ?? null,
      gender: profile?.gender ?? null,
      styleBoldness: profile?.style_boldness ?? null,
      items: data.items,
      avoidItemIds: data.avoidItemIds,
    });
  });
