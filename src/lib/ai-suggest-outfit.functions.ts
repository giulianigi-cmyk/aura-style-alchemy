import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { suggestOutfitCore, type SuggestOutfitItem } from "./ai-suggest-outfit.functions";
import { dressPreferencesToPrompt, hasAnyPreference, type DressPreferences } from "./dress-preferences";
import { resolvePlanSlot, validateEventSlot } from "./outfit-plan-slot";
import { describeWeather } from "./weather";

const DailyWeatherSchema = z.object({
  date: z.string(),
  tempMin: z.number(),
  tempMax: z.number(),
  weatherCode: z.number(),
});

const InputSchema = z.object({
  startDate: z.string(), // YYYY-MM-DD
  numDays: z.union([z.literal(7), z.literal(14)]),
  locationId: z.string().nullable(),
  dailyWeather: z.array(DailyWeatherSchema).default([]),
});

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Pure string slicing on purpose — an ISO timestamp like
// "2026-08-15T20:30:00+02:00" already carries the intended wall-clock
// time before the offset. Going through Date object math instead would
// silently convert to the server's own runtime timezone, which is wrong
// for a person anywhere else in the world.
function clockTime(iso: string): string {
  return iso.slice(11, 16);
}

function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Fills in the General outfit slot (see calendar_event_id on outfit_plans)
 * for each work day in the range that doesn't already have one — never
 * touches a day that's already planned, and never touches event-specific
 * slots (a dinner or gym outfit already set for that day stays exactly
 * as it is). An event-linked plan only blocks the General slot if that
 * event actually falls within the person's work hours; an evening plan
 * outside those hours doesn't stop the work outfit from being generated
 * too. Weather comes from the client's own forecast data since the
 * server has no location fix of its own; the wardrobe location is an
 * explicit per-run choice, not silently assumed from whatever's active
 * right now.
 */
export const generateWeeklyOutfits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profileRow } = await (supabase.from("profiles" as never) as any)
            .select("work_days, work_start_time, work_end_time, dress_preferences, work_dress_preferences, gender, style_boldness").eq("id", userId).maybeSingle();
    const profile = profileRow as {
      work_days?: string[]; work_start_time?: string; work_end_time?: string;
      dress_preferences?: DressPreferences; work_dress_preferences?: DressPreferences;
      gender?: string | null; style_boldness?: string | null;
    } | null;
    const workDays = profile?.work_days ?? ["MO", "TU", "WE", "TH", "FR"];
    const workStart = profile?.work_start_time ?? "09:00";
    const workEnd = profile?.work_end_time ?? "18:00";
    // Work-specific dress preferences, when the person has set any, fully
    // replace the general ones for this generator — it only ever produces
    // Work-occasion outfits. Falls back to the general preferences when
    // no work-specific ones exist yet.
    const dressRules = hasAnyPreference(profile?.work_dress_preferences)
      ? dressPreferencesToPrompt(profile!.work_dress_preferences)
      : dressPreferencesToPrompt(profile?.dress_preferences ?? null);
    const gender = profile?.gender ?? null;
    const styleBoldness = profile?.style_boldness ?? null;

    const endDateExclusive = addDaysIso(data.startDate, data.numDays);

    const [{ data: itemsRaw }, { data: existingPlans }, { data: calEvents }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", userId),
            (supabase.from("outfit_plans" as never) as any)
        .select("date, calendar_event_id").eq("user_id", userId)
        .neq("status", "cancelled")
        .gte("date", data.startDate).lt("date", endDateExclusive),
      (supabase.from("calendar_events_cache" as never) as any)
        .select("id, title, start_time, end_time, all_day").eq("user_id", userId)
        .gte("start_time", `${data.startDate}T00:00:00`).lt("start_time", `${endDateExclusive}T00:00:00`),
    ]);

    const items: SuggestOutfitItem[] = ((itemsRaw ?? []) as any[]).map((it) => ({
      id: it.id,
      category: it.category,
      subcategory: it.subcategory,
      colors: it.colors,
      style: it.style ? [it.style] : [],
      season: it.season,
      brand: it.brand,
      material: it.material ?? [],
      locationId: it.location_id ?? null,
      formality: it.formality ?? null,
      dayEvening: it.day_evening ?? "",
      sleeveLength: it.sleeve_length ?? "",
      length: it.length ?? "",
      fit: it.fit ?? "",
      styleTags: it.style_tags ?? [],
    }));

    const eventById = new Map(
      ((calEvents ?? []) as { id: string; title: string | null; start_time: string; end_time: string | null; all_day: boolean }[])
        .map((e) => [e.id, e]),
    );

    const plansByDate = new Map<string, { date: string; calendar_event_id: string | null }[]>();
    ((existingPlans ?? []) as { date: string; calendar_event_id: string | null }[]).forEach((p) => {
      const arr = plansByDate.get(p.date) ?? [];
      arr.push(p);
      plansByDate.set(p.date, arr);
    });

    const isWorkHoursEvent = (ev: { all_day: boolean; start_time: string; end_time: string | null }): boolean => {
      if (ev.all_day) return true;
      const evStart = clockTime(ev.start_time);
      const evEnd = ev.end_time ? clockTime(ev.end_time) : evStart;
      return timeRangesOverlap(evStart, evEnd, workStart, workEnd);
    };

    // The real work event for a day, if there is one. When it exists the
    // work outfit is written into THAT event's slot (unique on
    // calendar_event_id) rather than the day's general slot — which is what
    // lets a work outfit and a generic/evening outfit coexist on one date.
    const workEventByDate = new Map<string, { id: string; title: string | null }>();
    eventById.forEach((e) => {
      const d = e.start_time.slice(0, 10);
      if (!workEventByDate.has(d) && isWorkHoursEvent(e)) workEventByDate.set(d, { id: e.id, title: e.title });
    });

    // A day is "already handled" only if its target slot is taken: the
    // event slot when there's a work event, otherwise the general slot.
    // An evening dinner plan never blocks the work outfit.
    const isSlotTaken = (date: string, eventId: string | null): boolean => {
      const dayPlans = plansByDate.get(date) ?? [];
      return eventId
        ? dayPlans.some((p) => p.calendar_event_id === eventId)
        : dayPlans.some((p) => !p.calendar_event_id);
    };

    const eventTitleByDate = new Map<string, string>();
    eventById.forEach((e) => {
      const d = e.start_time.slice(0, 10);
      if (!eventTitleByDate.has(d) && e.title) eventTitleByDate.set(d, e.title);
    });

    const weatherByDate = new Map(data.dailyWeather.map((d) => [d.date, d]));

    const usedThisBatch: string[] = [];
    const created: { date: string }[] = [];
    const skippedExisting: string[] = [];
    const failed: { date: string; error: string }[] = [];

    for (let i = 0; i < data.numDays; i++) {
      const date = addDaysIso(data.startDate, i);
      const dow = WEEKDAY_CODES[new Date(`${date}T00:00:00`).getDay()];
      if (!workDays.includes(dow)) continue;

      const workEvent = workEventByDate.get(date) ?? null;
      const calendarEventId = workEvent?.id ?? null;
      if (isSlotTaken(date, calendarEventId)) { skippedExisting.push(date); continue; }

      // Event-linked writes are validated first: same owner, matching day.
      if (calendarEventId) {
        const problem = await validateEventSlot(supabase, userId, calendarEventId, date);
        if (problem) { failed.push({ date, error: problem }); continue; }
      }

      const w = weatherByDate.get(date);
      const occasionHint = eventTitleByDate.get(date) ? `Work · ${eventTitleByDate.get(date)}` : "Work";

      const result = await suggestOutfitCore({
        supabase, userId,
        temperature: w ? (w.tempMin + w.tempMax) / 2 : null,
        condition: w ? describeWeather(w.weatherCode).label : null,
        occasion: occasionHint,
        dressRules,
        gender,
        styleBoldness,
        items,
        avoidItemIds: usedThisBatch,
        locationIdOverride: data.locationId,
      });

      if (!result.ok || !result.item_ids.length) {
        failed.push({ date, error: !result.ok ? result.error : "No matching pieces" });
        continue;
      }

      usedThisBatch.push(...result.item_ids);

      const { onConflict } = resolvePlanSlot({ calendarEventId });
      const { data: planRow, error: insErr } = await supabase.from("outfit_plans").upsert({
        user_id: userId,
        date,
        item_ids: result.item_ids,
        occasion: "Work",
        notes: result.explanation || null,
        weather_temp: w ? Math.round((w.tempMin + w.tempMax) / 2) : null,
        status: "planned",
        calendar_event_id: calendarEventId,
      } as never, { onConflict }).select("id").single();


      if (insErr || !planRow) {
        failed.push({ date, error: insErr?.message ?? "Could not save" });
        continue;
      }

      const { data: eventRow, error: evErr } = await (supabase.from("wardrobe_events" as never) as any)
        .insert({
          user_id: userId,
          event_type: "planned",
          event_date: date,
          outfit_plan_id: (planRow as { id: string }).id,
          occasion: "Work",
        })
        .select("id")
        .single();
      if (!evErr && eventRow) {
        const rows = result.item_ids.map((item_id) => ({ event_id: (eventRow as { id: string }).id, item_id }));
        await (supabase.from("wardrobe_event_items" as never) as any).insert(rows);
      }

      created.push({ date });
    }

    return { created: created.length, skippedExisting: skippedExisting.length, failed };
  });
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "./ai-json";
import { isItemAtLocation } from "./wardrobe-location";
import { isItemAllowedByDressPreferences, hasAnyPreference, type DressPreferences } from "./dress-preferences";

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
  formality: z.number().nullable().optional(),
  dayEvening: z.string().nullable().optional(),
  sleeveLength: z.string().nullable().optional(),
  length: z.string().nullable().optional(),
  fit: z.string().nullable().optional(),
  styleTags: z.array(z.string()).nullable().optional(),
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
  /**
   * Items of an outfit that already exists and is being ADAPTED (e.g. the
   * weather re-check). Soft constraint on purpose: the prompt asks to swap
   * only what the new weather makes wrong and keep the rest, but nothing
   * is hard-locked — a 22°C → 5°C swing must still be allowed to rebuild
   * the look rather than preserve summer pieces at any cost.
   */
  baseItemIds?: string[];

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

  // Hard filter, not just prompt text: SOLO le preferenze impostate per il
  // lavoro quando esistono (mai mischiate con quelle generali), altrimenti
  // le preferenze generali. Prima solo la chat applicava questo come
  // esclusione reale — gli altri motori (weekly, on-demand) lo passavano
  // solo come testo nel prompt, che il modello può ignorare in silenzio.
  const isWorkOccasionForPrefs = (params.occasion ?? "").toLowerCase().startsWith("work");
  const { data: prefsRow } = await (params.supabase.from("profiles" as never) as any)
    .select(isWorkOccasionForPrefs ? "dress_preferences, work_dress_preferences" : "dress_preferences")
    .eq("id", params.userId).maybeSingle();
  const prefsRowTyped = prefsRow as { dress_preferences?: DressPreferences; work_dress_preferences?: DressPreferences } | null;
  const activeDressPrefs: DressPreferences | null =
    isWorkOccasionForPrefs && hasAnyPreference(prefsRowTyped?.work_dress_preferences)
      ? prefsRowTyped!.work_dress_preferences!
      : (prefsRowTyped?.dress_preferences ?? null);
  if (activeDressPrefs) {
    eligibleItems = eligibleItems.filter((it) => isItemAllowedByDressPreferences(it, activeDressPrefs));
  }

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
    formality: it.formality ?? null,
    dayEvening: it.dayEvening ?? "",
    sleeveLength: it.sleeveLength ?? "",
    styleTags: it.styleTags ?? [],
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
    // The rules below this line are styling DEFAULTS, not absolute bans —
    // treat them as: strong preference → deviate when the outfit's own
    // context makes the combination clearly intentional (a monochrome-
    // adjacent look, a deliberate color-blocked statement, an eclectic
    // outfit the wardrobe's style tags support) → your final judgment
    // wins. A real outfit that reads as put-together always beats
    // mechanically satisfying every rule below.
    "Default: avoid combining black and navy/dark blue in the same outfit — two near-identical dark neutrals more often read as a mismatch than a choice. Deviate when one is clearly a small accent against the other as the dominant piece, or when nothing else in the eligible pieces avoids it.",
    "Default: keep the total color count to about 3-4 per outfit, counting accessories — neutrals (black, white, grey, beige, navy, brown, cream) are forgiving and don't count as strictly as a bold or saturated color does. Going over this isn't a hard stop, just a sign to double check the extra colors are earning their place rather than accumulating by accident.",
    "Default: when shoes and a bag are both part of the outfit, prefer their leather tone coordinating with EACH OTHER specifically — black shoes with a black/grey-toned bag, brown/cognac/tan shoes with a brown/tan/navy-toned bag. This is only about the two leather accessories relative to each other, not to the rest of the outfit — black shoes with a brown dress, sweater, or trousers is completely normal and not a deviation from anything. And even shoes-vs-bag mismatched tones (e.g. brown dress + black shoes + burgundy bag) can work when the overall palette reads as deliberately coordinated rather than accidental — this is a preference to weigh, not a requirement to enforce mechanically.",
    "Default: avoid two different bold patterns in the same outfit (leopard with stripes, floral with plaid). One dominant pattern plus one clearly secondary/small-scale pattern can work — e.g. a subtly striped shirt under a tartan blazer — when their scale and color contrast are deliberately different, not just two unrelated statements colliding.",
    "Default: avoid pairing a bold statement pattern (leopard, animal print, floral, plaid) with another loud, saturated, contrasting color elsewhere in the outfit. Once one piece is doing the visual work, lean the rest neutral or toward the pattern's own dominant color — unless the wardrobe's style tags for this person suggest they genuinely favor maximalist, high-contrast combinations, in which case a bolder pairing can be the right call.",
    "Default: denim-on-denim works when both pieces are the same wash/tone, or are deliberately very different (white denim with dark blue denim) — two similar-but-not-matching mid-blue denim pieces tend to clash rather than coordinate. When unsure and no clearly-matching or clearly-contrasting pair exists, use only one denim piece.",
    "Default: don't pair a short/mini-length skirt or dress with a deep/plunging neckline in the same outfit — treat the outfit's overall visual exposure as something to balance, not maximize on every axis at once. This is about overall balance, not a moral judgment, and it never overrides the dress-rules constraints stated earlier, which always take priority when they conflict.",
    "Default: an evening-specific piece (an evening gown, a cocktail dress, anything formality 5) belongs in an Evening segment, not Day — deviate only if the eligible pieces genuinely leave nothing better for that day.",
    "Default: keep formality roughly consistent across the outfit — an elegant, dressed-up piece paired with something at the opposite end (flip-flops with a tailored dress, gym sneakers with a cocktail dress) usually reads as unintentional. A deliberate contrast (like a smart top with clean minimal sneakers) can absolutely work when the rest of the outfit supports it as a coherent choice rather than an accident.",
    "Above ~25°C, prefer a top that hasn't already been worn earlier in this batch over one that has, even if it scores slightly lower on style — a fresh piece matters more in hot weather (sweat, hygiene) than in cooler seasons, where repeating a top once or twice is completely normal.",
    ...(boldnessLine ? [boldnessLine] : []),
    "NEVER pick more than one outerwear/layering piece in the same outfit — a blazer and a cardigan (or any two of blazer/cardigan/jacket/coat) are never worn together. Pick at most one.",
    "A Dress or Jumpsuit is a complete base on its own and REPLACES both top and bottom — NEVER combine a Dress or Jumpsuit with a separate Bottoms item (trousers, jeans, shorts, skirt) in the same outfit. If you pick a Dress or Jumpsuit, do not also pick anything from the Bottoms category.",
    "Weather overrides everything else for outerwear: above ~26°C, do not include a blazer, jacket, cardigan, or coat at all, regardless of occasion — a lightweight top alone is correct. Only add outerwear when the temperature genuinely calls for it.",
    // The occasion string carries the real activity name (e.g. "Yoga at
    // sunset (Sport)"), not just a dress-code label, so these rules can
    // key off what the day actually is.
    "If the occasion mentions a pool, swimming, the beach or the sea (pool, piscina, swim, beach, spiaggia, mare, snorkeling): the outfit MUST be built around a Swimwear item — a one-piece swimsuit, or a bikini top AND bikini bottom together — instead of the usual top + bottom. Add a cover-up, a light top/shorts or a dress only as a layer over it, plus sandals/flats and sunglasses if available — never a bag. Never return a city outfit for a swim occasion, and never pair a bikini top with trousers or a skirt.",
    "If the occasion is Sport or mentions yoga, gym, running, hiking, training, pilates, tennis or cycling: the outfit MUST be built from Activewear pieces (sports bra / training top + leggings, bike shorts or running shorts) with sneakers or the appropriate sport shoe. Exclude denim, tailoring, dresses, heels and anything delicate, and honour the specific activity named — hiking wants covered, sturdy shoes, yoga wants soft stretch pieces.",
    "If the occasion is Travel (a flight, a transfer, a long drive): prioritise comfort and layers — soft, non-restrictive pieces, closed comfortable shoes (sneakers or flats, no heels), and one light layer that can go on and off.",
    "For a 'Work' occasion specifically, exclude anything sequinned, sparkly, feathered, fringed, or overtly evening/party-coded (check the material and styleTags fields), exclude cocktail or evening dresses, exclude very short skirts (mini-length), and exclude off-shoulder, strapless, halter, one-shoulder, or otherwise bare-shoulder tops/dresses — check the sleeveLength field: only Short, Three-Quarter, or Long sleeves are workwear-appropriate, never None/Strapless/Halter/Off-shoulder. Also treat dayEvening \"evening\" or formality 4-5 as a strong signal the piece belongs in an Evening look, not Work — these read as going-out wear, not workwear, even if the color looks fine on paper.",
    "Color palette by occasion, when choosing between otherwise-equal options: 'Formal'/'Business Formal' favors navy, grey, black, black-and-white; 'Work'/'Business Casual' favors khaki, light grey, navy, brown as a base with bordeaux, olive, camel, or light blue as accents; 'Smart Casual'/'Weekend' allows one clearly colorful statement piece against a simple base. This is a preference between similarly-fitting options, not a hard exclusion — don't reject an otherwise great outfit purely for using an off-palette color.",
    "Sequins, sparkle, or lurex/metallic fabric are for evening only — never pick a sequinned or sparkly piece for a Day segment, regardless of occasion, even outside a Work context specifically.",
    "Use each item's subcategory when present to judge fit-for-purpose: e.g. in hot weather prefer sandals/flats over boots; in rain or cold prefer boots over sandals; for formal occasions prefer pumps/heels over sneakers. When subcategory is empty, judge from category alone.",
    "A 'Running Shoes' subcategory item is built for running, not for everyday city walking — never pick it for a non-Sport occasion unless it is the only shoe available in the catalog. For a Sport/gym/running occasion specifically, it's the right choice.",
    "A gilet or waistcoat (vest) is never worn directly against skin with nothing underneath — always pair it with a shirt, t-shirt, or top layered beneath it. A tailored suit waistcoat additionally expects a blazer/jacket over it for a complete formal look, not worn as the outermost layer on its own.",
    "Return ONLY item ids that exist in the provided catalog. Never invent ids.",
    ...(params.baseItemIds?.length
      ? [
          `This person already planned an outfit made of these items: ${JSON.stringify(params.baseItemIds)}. The weather changed. ADAPT that outfit: keep every piece that still works and replace ONLY the pieces the new weather makes unsuitable, staying on the same occasion, formality and style. Do not redesign the look from scratch. If the temperature change is so large that most pieces no longer make sense, you may rebuild more of it — but always keep as much of the original outfit as the new weather allows.`,
        ]
      : []),
    "Explanation: 1-2 short sentences (max 200 chars) on why these pieces work.",
    "",
    "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
    '{"item_ids": ["id1", "id2"], "explanation": "short reason"}',
  ].join("\n");

  const userContent = `${wx} ${occ}\nWardrobe:\n${JSON.stringify(catalog)}`;

  // Hard, code-level guardrails — mirrors the pattern in
  // suggest-daily-looks.functions.ts. The prompt above ALSO asks for all
  // of this, but a text instruction is a request the model can silently
  // ignore; these checks are what actually rejects a bad result instead
  // of trusting the model got it right.
  const SLOT_LIMITS: Record<string, number> = {
    Tops: 1, Bottoms: 1, Dresses: 1, Jumpsuits: 1, Shoes: 1, Bags: 1, Outerwear: 1,
  };
  const hasSlotViolation = (ids: string[]): boolean => {
    const counts: Record<string, number> = {};
    for (const id of ids) {
      const cat = catalog.find((c) => c.id === id)?.category;
      if (!cat) continue;
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return Object.entries(SLOT_LIMITS).some(([cat, limit]) => (counts[cat] ?? 0) > limit);
  };
      const EVENING_SIGNAL = /rhinestone|embellish|diamant|strappy|sequin|paillette|feather|piuma|fringe|frange|tulle/i;
  const violatesWorkRules = (ids: string[]): boolean =>
    ids.some((id) => {
      const item = catalog.find((c) => c.id === id);
      if (!item) return false;
      if ((item.dayEvening ?? "") === "evening" && (item.formality ?? 0) >= 4) return true;
      const text = `${item.subcategory ?? ""} ${(item.styleTags ?? []).join(" ")} ${(item.material ?? []).join(" ")}`;
      if (EVENING_SIGNAL.test(text)) return true;
      // Bare shoulders is a hard rule for Work regardless of personal
      // dress preferences — a workwear norm, not just something the
      // person has to opt into. sleeveLength is the only attribute the
      // wardrobe currently records for this; a true off-shoulder/halter
      // tag doesn't exist yet, so this catches genuinely sleeveless
      // pieces (tank, cami, sleeveless top/dress) for now.
      if (["Tops", "Dresses", "Jumpsuits"].includes(item.category ?? "") && (item.sleeveLength ?? "") === "Sleeveless") return true;
      return false;
    });

  // Weather is a hard constraint for EVERY occasion, not just Work —
  // mirrors the same rule already enforced in suggest-daily-looks.functions.ts
  // (Home). A wool sweater or wool trousers are never correct at 30°C in
  // Empoli in August, no matter how good the rest of the outfit reads.
  const HOT_THRESHOLD_C = 26;
  const COLD_THRESHOLD_C = 10;
  const HEAVY_SIGNAL = /coat|cappotto|piumino|parka|overcoat|puffer|shearling|montone|wool|lana|maglione|sweater|felted|fleece|boots?\b|stivali|tweed|corduroy|velluto a coste|flannel|flanella|cashmere|cachemire/i;
  const LIGHT_SIGNAL = /tank|canotta|sandal|sandalo|shorts?\b|infradito|flip.?flop|sleeveless|senza maniche/i;
  const violatesWeather = (ids: string[]): boolean => {
    if (params.temperature == null) return false;
    const hot = params.temperature >= HOT_THRESHOLD_C;
    const cold = params.temperature <= COLD_THRESHOLD_C;
    if (!hot && !cold) return false;
    return ids.some((id) => {
      const item = catalog.find((c) => c.id === id);
      if (!item) return false;
      const text = `${item.category} ${item.subcategory} ${(item.styleTags ?? []).join(" ")} ${(item.material ?? []).join(" ")}`;
      const season = (item.season ?? "").toLowerCase();
      if (hot) {
        if (season === "winter") return true;
        if (HEAVY_SIGNAL.test(text)) return true;
      }
      if (cold) {
        if (season === "summer" && LIGHT_SIGNAL.test(text)) return true;
      }
      return false;
    });
  };

  const isWorkOccasion = (params.occasion ?? "").toLowerCase().startsWith("work");
  const isValidResult = (ids: string[]): boolean => {
    if (!ids.length) return false;
    if (hasSlotViolation(ids)) return false;
    if (isWorkOccasion && violatesWorkRules(ids)) return false;
    if (violatesWeather(ids)) return false;
    return true;
  };

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
    let item_ids = parsed.item_ids.filter((id) => validIds.has(id)).slice(0, 5);

    // If the first attempt breaks a hard rule (two tops, a bare-shoulder
    // piece for Work, etc.), ask once more instead of returning it —
    // mirrors the retry pattern used for daily looks.
    if (!isValidResult(item_ids)) {
      try {
        const retry = await generateText({
          model,
          system: system + "\n\nIMPORTANT — your previous answer broke a hard rule above (either more than one item in the same slot, an evening-coded/bare-shoulder piece for a Work occasion, an item excluded by the person's stated dress preferences, or a piece unsuitable for the actual temperature — e.g. a wool/heavy piece when it's hot, or a bare/light piece when it's cold). Try again, respecting every rule strictly this time.",
          messages: [{ role: "user", content: userContent }],
        });
        const retryParsed = parseAiJson(retry.text, OutputSchema);
        const retryIds = retryParsed.item_ids.filter((id) => validIds.has(id)).slice(0, 5);
        if (isValidResult(retryIds)) {
          item_ids = retryIds;
        } else if (hasSlotViolation(item_ids)) {
          // Neither attempt was clean and the original has a structural
          // slot conflict (e.g. two tops) — drop the lowest-priority
          // duplicate items rather than ship a visibly broken outfit.
          const seen = new Set<string>();
          item_ids = item_ids.filter((id) => {
            const cat = catalog.find((c) => c.id === id)?.category ?? "";
            const key = SLOT_LIMITS[cat] ? cat : id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        } else {
          // Not a slot conflict — a weather- or work-rule violation
          // (a wool piece in summer, a bare-shoulder top for Work, an
          // item outside the person's stated dress preferences). Strip
          // just the offending piece(s) rather than shipping a wrong
          // outfit — mirrors the "today" sanitize pattern in
          // suggest-daily-looks.functions.ts. Missing a shoe/top after
          // this is preferable to a materially wrong suggestion.
          item_ids = item_ids.filter((id) => {
            if (violatesWeather([id])) return false;
            if (isWorkOccasion && violatesWorkRules([id])) return false;
            return true;
          });
        }
      } catch (err) {
        console.error("[AURA suggest-outfit] retry failed", err);
      }
    }

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
