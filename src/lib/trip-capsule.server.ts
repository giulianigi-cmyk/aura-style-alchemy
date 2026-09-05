import { suggestOutfitCore, type SuggestOutfitItem } from "./ai-suggest-outfit.functions";
import { dressPreferencesToPrompt, type DressPreferences } from "./dress-preferences";
import { resolvePlanSlot } from "./outfit-plan-slot";
import { getTripWeatherMap, weatherKey } from "./trip-weather.server";
import { describeWeather } from "./weather";
import { computeCapsuleSeedAndExclusions } from "./trip-capsule-persistence";
import { violatesWeatherRule, HEAVY_SIGNAL, LIGHT_SIGNAL, MILD_WARM_THRESHOLD_C, MILD_COOL_THRESHOLD_C, type WeatherCheckableItem } from "./outfit-weather-rules";

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

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
 *  day's actual weather is available (see the main generation loop). */
const HEAVY_MATERIALS = ["cashmere", "wool", "mohair", "alpaca", "shearling", "down"];
const HEAVY_MATERIAL_TEMP_THRESHOLD = 23;

// MILD_WARM_THRESHOLD_C / MILD_COOL_THRESHOLD_C now live in
// outfit-weather-rules.ts — shared with ai-suggest-outfit.functions.ts
// (violatesSleeveClimate), so both capsule building here and the final
// per-slot pick there agree on the same boundary instead of each having
// its own copy that could drift.

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
// Categories worn directly against skin, where a hot day's sweat makes
// same-day reuse a hygiene question, not just a styling one — a blazer
// or a pair of jeans worn all day is still perfectly fine that evening,
// a t-shirt worn all day at 30°C generally isn't.
const SKIN_CONTACT_ROLE = new Set(["Tops", "Underwear", "Swimwear"]);
const SWEAT_RELEVANT_TEMP_C = 25;

/** True when an item just worn at this temperature should be treated as
 *  used-up for the rest of THIS trip's generation run, not just briefly
 *  avoided the way avoidOutfitWindow already handles style variety. Pure
 *  and exported so this rule is testable on its own. */
export function isSweatConsumable(category: string | null, temperature: number | null): boolean {
  return temperature != null && temperature >= SWEAT_RELEVANT_TEMP_C && SKIN_CONTACT_ROLE.has(category ?? "");
}

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
const TRANSPORT_KEYWORDS = [
  "treno", "nave", "aereo", "volo", "traghetto", "autobus", "pullman", "train", "flight", "plane", "airplane", "ship", "ferry", "transfer", "bus",
  // Un'attività importata dal calendario spesso non contiene mai la
  // parola "treno"/"train" — è solo il nome della tratta ("Milano
  // Centrale - Firenze SMN 9551", numero del treno incluso). Le stazioni
  // e i terminal sono un segnale altrettanto affidabile.
  "stazione", "station", "centrale", "aeroporto", "airport", "terminal", "gare", "estación", "estacion", "bahnhof",
];
// A generic "City - City" pattern (both sides starting with a capital
// letter, separated by a dash) is a strong transport signal on its own —
// it's how route/transfer names read in any language ("Milano Centrale -
// Firenze SMN", "Paris - Lyon", "JFK - CDG") without needing the word
// "treno"/"train" anywhere in them. Catches real-world calendar-imported
// labels the keyword list alone never will, without having to enumerate
// every station name that exists.
export function isTransportActivity(label: string | null): boolean {
  return !!label && TRANSPORT_KEYWORDS.some((k) => label.toLowerCase().includes(k));
}

// No dedicated hotel/accommodation concept exists anywhere in the schema
// (checked before adding this — see debug notes) and one isn't needed: a
// logged check-in/hotel activity is the same kind of signal transport
// already is, just the opposite direction (arriving somewhere to change,
// not leaving on a journey). Detected the same way, not a new field.
// Multilingual on purpose — the app supports IT/EN/ES/FR and a person's
// activity label can be typed in any of them, or copied straight from a
// booking confirmation in whichever language that came in.
const ACCOMMODATION_KEYWORDS = [
  // Italiano
  "hotel", "albergo", "alloggio", "soggiorno", "pernottamento", "pernottare", "dormire",
  "ostello", "residence", "dimora", "foresteria", "agriturismo", "casa vacanze", "appartamento",
  // English
  "stay", "overnight", "accommodation", "lodging", "sleep", "sleeping", "resort", "hostel",
  "guesthouse", "guest house", "apartment", "rental", "inn", "motel", "lodge",
  // Español
  "alojamiento", "dormir", "pernoctar", "pernoctación", "pernoctacion", "estancia", "hostal",
  "albergue", "casa rural",
  // Français
  "hôtel", "séjour", "sejour", "nuitée", "nuitee", "hébergement", "hebergement", "auberge",
  "chambre d'hôtes", "chambre d'hotes", "gîte", "gite",
  // Condivisi tra più lingue
  "check-in", "checkin", "check in", "airbnb", "b&b", "bnb", "bed and breakfast",
];
export function isAccommodationActivity(label: string | null): boolean {
  return !!label && ACCOMMODATION_KEYWORDS.some((k) => label.toLowerCase().includes(k));
}

/**
 * Whether a change of clothes between a transport leg and whatever else
 * is happening that day can reasonably be assumed — inferred from the
 * itinerary that already exists, never a new question or a new field.
 *
 * Two signals, either is enough to assume YES:
 * - A logged hotel/check-in activity that same day. The clearest
 *   possible signal: the person is planning to arrive somewhere and
 *   settle in, which is exactly when clothes get changed.
 * - No OTHER activity shares this transport's exact day segment. Day
 *   and evening are hours apart by construction — a train at midday and
 *   a formal dinner that evening have a natural gap between them even
 *   with nothing explicitly logged in it.
 *
 * When neither holds — a transport activity sharing its OWN segment with
 * a same-day event, and no accommodation logged anywhere that day (the
 * "train straight to the concert" case) — a change is NOT assumed, and
 * the transport practicality filter is skipped entirely for that
 * activity: the event's own needs are allowed to govern what's "correct"
 * to wear, exactly like the document's Scenario B. This is a coarse
 * proxy, not a certainty — day_segment is the only time granularity
 * activities have, there's no literal clock time to reason about.
 */
export function changeAssumedPossible(req: Requirement, allRequirements: Requirement[], allActivities: { activity_date: string; activity_type: string | null }[]): boolean {
  const hasAccommodationSameDay = allActivities.some((a) => a.activity_date === req.date && isAccommodationActivity(a.activity_type));
  if (hasAccommodationSameDay) return true;
  const hasSameSegmentCompetingActivity = allRequirements.some(
    (r) => r.activityId !== req.activityId && r.date === req.date && r.daySegment === req.daySegment && !isTransportActivity(r.label),
  );
  return !hasSameSegmentCompetingActivity;
}

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

export type ClimateSuitability = "compatible" | "possible" | "inappropriate";

function toWeatherCheckable(it: PoolItem): WeatherCheckableItem {
  return { category: it.category, subcategory: it.subcategory, styleTags: it.style, material: it.material, season: it.season, toeShape: null };
}

/**
 * AURA doesn't dress the calendar, it dresses the person in the real
 * conditions forecast — season is context, weather is reality. One
 * generic function instead of a growing pile of `if (boot)`/`if
 * (tshirt)` special cases, applied identically to shoes, tops, bottoms,
 * outerwear, dresses, anything: every item's OWN category/subcategory/
 * material/season already carries what's needed to judge it.
 *
 * Three tiers, not a binary hard filter:
 * - "inappropriate": genuinely wrong for the real temperature — reuses
 *   violatesWeatherRule (outfit-weather-rules.ts), the same hard rule
 *   already enforced everywhere else in the app (a wool coat at 32°C,
 *   sandals at 2°C). This is the ONLY tier that excludes.
 * - "possible": the item's own season tag disagrees with a real
 *   temperature that isn't extreme (a boot at 21°C, a sandal at 14°C,
 *   a sandal in a mild December). Never excluded — only a soft nudge in
 *   scoring, because a sandal with tights on a mild winter evening can
 *   be a genuine, deliberate styling choice, not a mistake.
 * - "compatible": no real disagreement, or no weather data at all — the
 *   season tag is followed exactly as it always was.
 *
 * Without real temperature, this collapses to the season-tag check that
 * already existed — nothing changes for a destination/date AURA has no
 * forecast for.
 */
export function climateSuitability(it: PoolItem, temperature: number | null, calendarSeason: string): ClimateSuitability {
  if (temperature == null) {
    return matchesSeasonLoose(it.season, calendarSeason) ? "compatible" : "possible";
  }
  if (violatesWeatherRule(toWeatherCheckable(it), temperature)) return "inappropriate";
  // Moderate mismatch, from TWO independent signals — either is enough to
  // land on "possible":
  // (1) the item's own construction (category/subcategory/material text
  // — the same HEAVY_SIGNAL/LIGHT_SIGNAL patterns violatesWeatherRule
  // uses for the hard case above, just re-checked at the milder
  // thresholds). This is what still catches an ankle boot or a pair of
  // sandals even when nobody ever set a season tag on them — season is
  // frequently left blank, subcategory almost never is.
  // (2) an explicit season tag that disagrees with the real temperature,
  // when one is present — a secondary, additive signal, not a
  // replacement for (1).
  const warm = temperature >= MILD_WARM_THRESHOLD_C;
  const cool = temperature < MILD_COOL_THRESHOLD_C;
  const text = `${it.category ?? ""} ${it.subcategory ?? ""} ${(it.style ?? []).join(" ")} ${(it.material ?? []).join(" ")}`;
  const looksHeavy = HEAVY_SIGNAL.test(text);
  const looksLight = LIGHT_SIGNAL.test(text);
  const tag = (it.season ?? "").toLowerCase();
  if (warm && (looksHeavy || tag.includes("winter") || tag.includes("autumn"))) return "possible";
  if (cool && (looksLight || tag.includes("summer"))) return "possible";
  return "compatible";
}

export type PoolItem = {
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
  sleeveLength: string | null;
};

export type Requirement = {
  activityId: string;
  date: string;
  daySegment: "day" | "evening";
  dressCode: string | null;
  label: string | null;
};

function versatility(it: PoolItem, req?: Requirement, temperature?: number | null): number {
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

    // Generic, category-agnostic climate check — one shared signal
    // instead of separate boot/sandal/sneaker-season special cases,
    // applies identically to shoes, tops, bottoms, outerwear, dresses,
    // anything with a season tag. "inappropriate" already excludes
    // upstream in eligibleFor, so only the soft "possible" tier is left
    // to matter here. See climateSuitability's own comment for the
    // reasoning (real temperature over calendar-bucket season).
    const calendarSeason = seasonForDate(req.date);
    if (climateSuitability(it, temperature ?? null, calendarSeason) === "possible") score -= 3;

    // A transport leg (train, flight, ferry) is a practicality context,
    // not a styling one — a skirt or dress isn't WRONG on a train the way
    // a sneaker is wrong for a dinner, just a less practical pick than
    // trousers/jeans when both are equally appropriate otherwise. Soft
    // nudge only: if the only bottom available is a skirt, that's still
    // what gets worn. Skirt is a SUBCATEGORY under Bottoms, not its own
    // category, so this checks subcategory text, not just Dresses/
    // Jumpsuits — a plain pair of trousers (category Bottoms, no "skirt"
    // in its subcategory) is never penalized here.
    if (isTransportActivity(req.label)) {
      const isSkirtLike = it.category === "Dresses" || it.category === "Jumpsuits" || /skirt|gonna/i.test(it.subcategory ?? "");
      if (isSkirtLike) score -= 2;
    }

    // Occasion-driven, NOT climate-driven — deliberately kept separate
    // from climateSuitability above: a sneaker is climate-fine at any
    // temperature, just stylistically wrong for a dinner. Folding it into
    // the climate signal would either mislabel it "inappropriate" for the
    // wrong reason or dilute what that signal means.
    if (req.daySegment === "evening" && it.category === "Shoes") {
      const sub = (it.subcategory ?? "").toLowerCase();
      if (/sneaker|running|trainer|scarpe da ginnastica/.test(sub)) score -= 3;
    }

    // Sleeve length vs. real temperature: independent of the item's own
    // season TAG (climateSuitability above looks at that), this reads the
    // garment's actual construction — a short-sleeve top with no season
    // tag at all sails through climateSuitability but is still objectively
    // short-sleeved on a cold evening. Never excludes, only nudges.
    if ((it.category === "Tops" || it.category === "Dresses") && temperature != null) {
      const sleeve = (it.sleeveLength ?? "").toLowerCase();
      const isShortSleeve = sleeve === "sleeveless" || sleeve === "short sleeve";
      const isLongSleeve = sleeve === "long sleeve";
      if (temperature >= MILD_WARM_THRESHOLD_C && isLongSleeve) score -= 3;
      if (temperature < MILD_COOL_THRESHOLD_C && isShortSleeve) score -= 3;
    }
  }
  return score;
}

function eligibleFor(pool: PoolItem[], req: Requirement, season: string, temperature: number | null): PoolItem[] {
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
    // The season-only check below is now ONLY reached when the item
    // doesn't have a purpose exemption — climateSuitability replaces it
    // as the real gate: "inappropriate" (genuinely wrong for the real
    // forecast, not just off-tag) is the only case that excludes. This
    // is what lets a Summer-tagged sandal survive a September evening at
    // 25°C, when the calendar bucket alone would have called it "Autumn"
    // and dropped it here before temperature ever had a say.
    if (!isPurpose && climateSuitability(it, temperature, season) === "inappropriate") return false;
    return true;
  });
}


function countInRole(items: PoolItem[], role: Set<string>): number {
  return items.filter((it) => role.has(it.category ?? "")).length;
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
export function buildCapsule(
  pool: PoolItem[],
  requirements: Requirement[],
  seasonByDate: Map<string, string>,
  existingCapsuleSeed: string[] = [],
  tempByActivity: Map<string, number | null> = new Map(),
): Set<string> {
  // Items already chosen for OTHER activities of this same trip in a
  // previous, separate generation call (days already planned, and
  // therefore excluded from `requirements` above) start the capsule
  // instead of an empty one. Without this, adding one new day to a trip
  // that already has confirmed days built a capsule from scratch, blind
  // to what those confirmed days already established — the exact
  // "Day 3 proposes completely different pieces than Day 1" gap.
  const capsule = new Set<string>(existingCapsuleSeed.filter((id) => pool.some((p) => p.id === id)));

  // 2 per role was a flat floor regardless of trip length — fine for a
  // weekend, thin for anything longer (a 10-day trip with only 2 tops
  // rotates 5x each). Scales gently with the number of requirements
  // (~2 per day), capped so it never balloons into "pack everything".
  const perRoleTarget = Math.min(2 + Math.floor(requirements.length / 4), 5);
  const approxTripDays = Math.max(1, Math.ceil(requirements.length / 2));
  // Shoes don't need the same rotation depth as tops/bottoms — they're
  // bulky to pack and get reworn far more before anyone notices. Scaling
  // them the same way as tops turned "add one more top" into "also add a
  // third pair of sneakers", which is the opposite of what a capsule is for.
  // For a short trip (2 days or fewer) a SECOND pair has no real reason to
  // exist unless something else earns it — an elegant occasion or a
  // sport/swim day, both handled by their own reserved-slot logic below,
  // independently of this target. Without this, a 2-day trip always tried
  // to seat 2 pairs of sneakers even when one would have covered every
  // requirement just fine.
  const shoeTarget = approxTripDays <= 2 ? 1 : Math.min(perRoleTarget, 2);
  // Bags were never guaranteed a slot in the capsule at all before — the
  // AI's gender-aware prompt could suggest one, but only if an eligible
  // bag happened to already be in the pool by chance. A short trip only
  // needs one bag total; a week or longer earns a second (day + evening).
  const bagTarget = approxTripDays >= 7 ? 2 : 1;
  // Tops in hot weather want closer to one fresh piece per day (sweat,
  // not just looking different) — cooler seasons tolerate a top worn
  // twice comfortably, which perRoleTarget already reflects.
  const isSummerTrip = requirements.some((r) => seasonByDate.get(r.date) === "Summer");
  const topTarget = isSummerTrip ? Math.min(approxTripDays, 6) : perRoleTarget;
  // Bottoms don't need top-level rotation either — not skin-contact (see
  // SKIN_CONTACT_ROLE, sweat isn't the concern the way it is for tops),
  // and in practice people really do rewear the same pair of trousers or
  // jeans across a short trip without it reading as a mistake, the same
  // way shoes do. Capped like shoeTarget rather than sharing topTarget's
  // faster-scaling perRoleTarget: adding one more activity to an already-
  // short trip used to be enough to push a third pair of trousers into
  // the capsule when the first one could still have covered it.
  const bottomTarget = approxTripDays <= 3 ? 2 : Math.min(perRoleTarget, 3);

  const withEligibility = requirements.map((req) => ({
    req,
    eligible: eligibleFor(pool, req, seasonByDate.get(req.date)!, tempByActivity.get(req.activityId) ?? null),
  }));
  // Hardest first = fewest eligible candidates in the whole wardrobe —
  // solving these while the capsule is still empty leaves the most
  // freedom; solving them last could find nothing left to work with. On
  // ties (very common — season is the main eligibility filter, so a
  // same-season day and evening usually have identical eligible counts),
  // evening/elegant requirements go first: they're the pickier context
  // for a shared, capped budget like shoeTarget (versatility() penalizes
  // a sneaker for an evening slot, but that penalty can only matter if
  // evening gets a real turn at the budget before a same-sized "Day"
  // requirement — processed first purely by insertion order — fills it
  // entirely with sneakers that were perfectly fine for THAT day.
  const requirementPriority = (r: Requirement) => (hasEleganceSignal(r) ? 2 : r.daySegment === "evening" ? 1 : 0);
  withEligibility.sort((a, b) => {
    const diff = a.eligible.length - b.eligible.length;
    if (diff !== 0) return diff;
    return requirementPriority(b.req) - requirementPriority(a.req);
  });

  for (const { req, eligible } of withEligibility) {
    const inCapsule = eligible.filter((it) => capsule.has(it.id));
    const kind = activityKind(req);

    // BUG FIXED HERE: this used to be hasRole() — a boolean "is there at
    // least one item of this role in the capsule". The first (hardest,
    // fewest-eligible) requirement processed could satisfy that with a
    // single top, and every later requirement — even ones with many more
    // eligible tops — would then see the role as "not missing" and never
    // top it up toward topTarget. A summer trip could end up with exactly
    // one top for the whole trip regardless of topTarget=6, which is the
    // exact "same outfit every day" bug this produced in practice.
    // countInRole + a real target fixes it: every requirement tries to
    // top the role up further, converging on the target as looser
    // requirements reveal more eligible candidates.
    const topNeed = kind === "swim" ? 0 : Math.max(0, topTarget - countInRole(inCapsule, TOP_ROLE));
    const bottomNeed = kind === "swim" ? 0 : Math.max(0, bottomTarget - countInRole(inCapsule, BOTTOM_ROLE));
    const shoeNeed = Math.max(0, shoeTarget - countInRole(inCapsule, SHOE_ROLE));
    const bagNeed = (kind === "swim" || kind === "sport") ? 0 : Math.max(0, bagTarget - countInRole(inCapsule, BAG_ROLE));
    const swimNeed = kind === "swim" ? Math.max(0, perRoleTarget - countInRole(inCapsule, SWIM_ROLE)) : 0;
    const activeNeed = kind === "sport" ? Math.max(0, perRoleTarget - countInRole(inCapsule, ACTIVE_ROLE)) : 0;

    const roleNeeds: { role: Set<string>; need: number }[] = [
      { role: SWIM_ROLE, need: swimNeed },
      { role: ACTIVE_ROLE, need: activeNeed },
      { role: TOP_ROLE, need: topNeed },
      { role: BOTTOM_ROLE, need: bottomNeed },
      { role: SHOE_ROLE, need: shoeNeed },
      // Bag added last so it never displaces a top/bottom/shoe pick above.
      { role: BAG_ROLE, need: bagNeed },
    ].filter((r) => r.need > 0);

    for (const { role, need } of roleNeeds) {
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
        .map((it) => ({ it, score: versatility(it, req, tempByActivity.get(req.activityId) ?? null) + REWEARABILITY[it.category ?? ""] * 0.3 + Math.random() * 2.5 }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.it);
      candidates.slice(0, need).forEach((it) => capsule.add(it.id));
    }
  }

  // A formal-enough shoe protected against being crowded out by the
  // shoe cap above — only when this trip actually has a reason to need
  // one (see hasEleganceSignal). Owning a heel never forces it in;
  // an activity like a resort dinner does. Deliberately outside the
  // normal target/cap logic: this is a reserved slot, not a ranked pick.
  const eleganceReqs = requirements.filter(hasEleganceSignal);
  if (eleganceReqs.length) {
    const alreadyHasElegantShoe = Array.from(capsule).some((id) => {
      const it = pool.find((p) => p.id === id);
      return it?.category === "Shoes" && it.formality >= 4;
    });
    if (!alreadyHasElegantShoe) {
      // Scored against the first elegance-requiring requirement so the
      // same temperature-aware boot/sneaker penalties in versatility()
      // apply here too, not just in the per-role fill above — a
      // multi-occasion trip spanning very different weather is a rare
      // enough edge case that using just the first is a reasonable
      // simplification.
      const repReq = eleganceReqs[0];
      const repTemp = tempByActivity.get(repReq.activityId) ?? null;
      const repSeason = seasonByDate.get(repReq.date) ?? "";
      const formalShoes = pool.filter((it) => it.category === "Shoes" && it.formality >= 4 && !capsule.has(it.id));
      // This reserved slot bypasses the normal eligible/candidatePool
      // pipeline on purpose (it's a protected pick, not a ranked one —
      // see the comment above) but that must never mean it also bypasses
      // climate suitability: a genuinely "inappropriate" shoe (a heavy
      // boot on a real 28°C evening) needs to be excluded here exactly
      // as it would be everywhere else, not merely outscored —
      // versatility() only knows how to penalize the soft "possible"
      // tier, not exclude the hard one. Falls back to the unfiltered
      // list only if climate suitability would leave nothing at all —
      // this reserved slot must never end up empty over a climate
      // preference, same principle as the "never leave it unfilled"
      // rule already applied to the normal weather filter elsewhere.
      const climateOk = formalShoes.filter((it) => climateSuitability(it, repTemp, repSeason) !== "inappropriate");
      const bestElegantShoe = (climateOk.length > 0 ? climateOk : formalShoes)
        .sort((a, b) => versatility(b, repReq, repTemp) - versatility(a, repReq, repTemp))[0];
      if (bestElegantShoe) capsule.add(bestElegantShoe.id);
    }
  }

  return capsule;
}

// Formal and Sport are the only dress codes strong enough to be a real
// requirement, not just a preference — "Dinner + Evening + Formal" must
// actually produce a formal outfit, not merely one the AI was told about
// in a sentence (deterministic constraints first, AI styling second).
// Evening/Work/Everyday/Weekend/Travel stay purely soft (versatility()
// scoring) on purpose — "Evening" alone does NOT mean "always evening
// gown", context decides that, not a hard formality wall.
// Sport ceiling and Formal floor use the same progressive-widening
// fallback: try the strict band first, loosen once if that leaves too
// little to work with, and only ever fall back to "everything eligible"
// as a last resort — a bare wardrobe still gets an outfit, never a
// silent failure, but a genuinely available formal wardrobe should never
// be skipped in favor of jeans just because "Dinner" technically allows it.
export function applyHardDressCodeFilter(candidates: PoolItem[], dressCode: string | null): PoolItem[] {
  if (dressCode === "Formal") {
    const strict = candidates.filter((it) => it.formality >= 4);
    if (strict.length >= 3) return strict;
    const loose = candidates.filter((it) => it.formality >= 3);
    if (loose.length >= 3) return loose;
    return candidates;
  }
  if (dressCode === "Sport") {
    const strict = candidates.filter((it) => it.formality <= 1);
    if (strict.length >= 3) return strict;
    const loose = candidates.filter((it) => it.formality <= 2);
    if (loose.length >= 3) return loose;
    return candidates;
  }
  return candidates;
}

// A skirt/short dress or a cut-out/going-out top on a train/flight/ferry
// isn't a style preference gone slightly wrong, it was reported as
// actively unwanted — so this is a hard filter like Formal/Sport above,
// not the softer versatility() nudge alone. Falls back to the unfiltered
// list only if excluding them would leave nothing at all, same "never
// fail the slot" guarantee every hard filter in this pipeline follows.
//
// GOING_OUT_SIGNAL reuses the same keyword-matching approach already
// established elsewhere (HEAVY_SIGNAL/LIGHT_SIGNAL in
// outfit-weather-rules.ts, the bare-shoulder check in the Work-occasion
// prompt rule) rather than inventing a new "coverage" field — no such
// field exists on wardrobe items, and category/subcategory/style text is
// what AI classification actually populates.
const GOING_OUT_SIGNAL = /cut.?out|cutout|bralette|crop top|halter|bandeau|off.?shoulder|bardot|backless|sheer|see.?through|plunge|deep neckline|club|nightlife|party dress|going out/i;

export function applyTransportPracticalityFilter(candidates: PoolItem[], isTransport: boolean): PoolItem[] {
  if (!isTransport) return candidates;
  const practical = candidates.filter((it) => {
    const isSkirtOrShortDress = it.category === "Dresses" || /skirt|gonna/i.test(it.subcategory ?? "");
    if (isSkirtOrShortDress) return false;
    const text = `${it.subcategory ?? ""} ${(it.style ?? []).join(" ")}`;
    if (GOING_OUT_SIGNAL.test(text)) return false;
    return true;
  });
  return practical.length > 0 ? practical : candidates;
}

export async function generateTripCapsuleCore({ data, context }: {
  data: { tripId: string; activityIds?: string[] };
  context: { supabase: any; userId: string };
}) {
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

    const [{ data: profileRow }, { data: sourceLocRows }, { data: activityRows }, { data: existingPlans }, { data: itemsRaw }, { data: capsuleRows }] =
      await Promise.all([
        (supabase.from("profiles" as never) as any).select("dress_preferences, gender, style_boldness").eq("id", userId).maybeSingle(),
        (supabase.from("trip_source_locations" as never) as any).select("location_id").eq("trip_id", data.tripId),
        (supabase.from("trip_day_activities" as never) as any).select("*").eq("trip_id", data.tripId).order("activity_date"),
        (supabase.from("outfit_plans" as never) as any).select("trip_activity_id, item_ids").eq("trip_id", data.tripId),
        supabase.from("wardrobe_items").select("*").eq("user_id", userId).eq("archived", false),
        (supabase.from("trip_capsule_items" as never) as any).select("wardrobe_item_id, removed_by_user").eq("trip_id", data.tripId),
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
    //
    // Exception: ANY date with a logged transport activity (a train,
    // flight, ferry — outbound, return, or a leg moving between cities
    // mid-trip). A travel day already answers "what am I doing that day"
    // on its own — it doesn't need a separate invented outfit for
    // whichever segment the journey didn't happen to land in just
    // because the person hasn't explicitly planned an evening yet. This
    // used to only apply to the trip's first/last date; a mid-trip city-
    // to-city train got the same unwanted extra slot as any other day.
    if (!data.activityIds?.length && tripStartDate && tripEndDate) {
      const transportDates = new Set(
        activities.filter((a) => isTransportActivity(a.activity_type)).map((a) => a.activity_date),
      );
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
          .filter(() => !transportDates.has(date))
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
    // Two different requests were both routing through "targeted" as if
    // they were the same thing: regenerating a look you don't like
    // (which should feel free to try something else — no capsule seed,
    // see below) and generating the first look for a brand-new activity
    // that never had one (which should reuse what the trip has already
    // decided on, exactly like a full-trip run would). Distinguishing
    // them by whether ANY targeted activity already has a plan is what
    // fixes "add one more activity → completely different shoes/bag/
    // trousers, disconnected from everything already packed" — that was
    // always a fresh, unseeded run because it happened to go through the
    // single-activity endpoint, not because it needed to be.
    const isRegeneratingExistingLook = !!targeted && Array.from(targeted).some((id) => plannedActivityIds.has(id));
    const requirements = targeted
      ? allRequirements
      : allRequirements.filter((r) => !plannedActivityIds.has(r.activityId));
    const skippedExisting = allRequirements.length - requirements.length;

    // Credit- and cost-conscious cap — a trip logging more than 30
    // activities in one go is not the common case, and this keeps a
    // single run from firing an unbounded number of AI calls.
    const capped = requirements.slice(0, 30);

    // Transport gets first claim on the wardrobe's practical pieces
    // within its own day — processed ahead of any other same-date
    // activity (an accommodation check-in, an event) so the recently-
    // worn avoidance below naturally pushes those OTHER activities
    // toward different pieces, instead of the reverse: a same-day
    // accommodation activity claiming the one practical outfit first and
    // leaving the actual train ride to fall back on whatever's left,
    // which could easily be the same going-out look assigned to a later
    // event that day. This doesn't change WHICH items are eligible
    // (applyTransportPracticalityFilter already handles that per
    // activity) — only the order they're claimed in when several
    // same-day activities are competing for a limited wardrobe.
    capped.sort((a, b) => {
      if (a.date !== b.date) return 0;
      const aTransport = isTransportActivity(a.label) ? 1 : 0;
      const bTransport = isTransportActivity(b.label) ? 1 : 0;
      return bTransport - aTransport;
    });

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
    const persistedCapsule = ((capsuleRows ?? []) as { wardrobe_item_id: string; removed_by_user: boolean }[]);
    // Legacy fallback for trips generated before trip_capsule_items
    // existed — see trip-capsule-persistence.ts.
    const legacyOutfitPlanItemIds = ((existingPlans ?? []) as { trip_activity_id: string | null; item_ids: string[] | null }[])
      .flatMap((p) => p.item_ids ?? []);
    const { seedIds: persistedSeedIds, excludedIds: capsuleExcludedIds } =
      computeCapsuleSeedAndExclusions(persistedCapsule, legacyOutfitPlanItemIds);
    const capsuleExcludedSet = new Set(capsuleExcludedIds);

    const pool: PoolItem[] = [];
    let unclassifiedExcluded = 0;
    for (const it of locationFiltered) {
      // A manual removal from this trip's capsule wins over everything
      // else, permanently for this trip — the item isn't just deprioritized,
      // it's not a candidate at all, so neither buildCapsule nor the AI
      // inside suggestOutfitCore can pick it back up.
      if (capsuleExcludedSet.has(it.id)) continue;
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
        locationId: it.location_id ?? null, formality, dayEvening, sleeveLength: it.sleeve_length ?? null,

      });
    }

    const seasonByDate = new Map<string, string>();
    capped.forEach((r) => { if (!seasonByDate.has(r.date)) seasonByDate.set(r.date, seasonForDate(r.date)); });

    // Resolved once here, ahead of buildCapsule, so both capsule
    // selection AND the generation loop below score against the exact
    // same numbers — no risk of the two drifting apart by recomputing
    // this twice. Same tempMin(evening)/tempMax(day) split as before.
    const tempByActivity = new Map<string, number | null>();
    const dayWeatherByActivity = new Map<string, ReturnType<typeof weatherMap.get>>();
    for (const req of capped) {
      const dest = destinationForDate(req.date);
      const wKey = dest?.latitude != null && dest?.longitude != null ? weatherKey(dest.latitude, dest.longitude, req.date) : null;
      const dw = wKey ? weatherMap.get(wKey) ?? null : null;
      dayWeatherByActivity.set(req.activityId, dw);
      tempByActivity.set(req.activityId, dw ? (req.daySegment === "evening" ? dw.tempMin : dw.tempMax) : null);
    }

    // Seed for buildCapsule (see its own comment): the trip's persistent
    // capsule (trip_capsule_items, merged with the legacy fallback) — not
    // just what's already in outfit_plans, so an item added on Day 2 that
    // never actually made it into that day's chosen outfit is still
    // available as a preference for Day 3. Targeted runs (regenerate one
    // activity) never seed — a single-day regenerate has no business
    // forcing in unrelated days' items as a "preference", though
    // exclusions above still apply either way.
    const existingCapsuleSeed: string[] = isRegeneratingExistingLook ? [] : persistedSeedIds;

    const capsule = buildCapsule(pool, capped, seasonByDate, existingCapsuleSeed, tempByActivity);

    const created: { date: string; daySegment: string }[] = [];
    const failed: { date: string; daySegment: string; reason: string }[] = [];
    const usedOutfits: string[][] = [];
    const allChosenItemIds = new Set<string>();
    // A worn-and-sweated-in piece from earlier in a hot day isn't a clean,
    // available option again later — separate from, and permanent-for-
    // this-run unlike, the sliding avoidOutfitWindow above (which is about
    // visual variety, not hygiene, and naturally "forgets" after a few
    // outfits). Only skin-contact categories matter here: a blazer or
    // jeans worn on a 30°C day is completely fine again that evening.
    const sweatConsumedItemIds = new Set<string>();

    for (const req of capped) {
      const season = seasonByDate.get(req.date)!;
      const eligible = eligibleFor(pool, req, season, tempByActivity.get(req.activityId) ?? null);
      let candidatePool = eligible.filter((it) => capsule.has(it.id));
      // Falls back to the full eligible set only if the capsule subset is
      // too thin to plausibly compose a real outfit — never silently
      // fails a requirement the wardrobe could actually cover.
      if (candidatePool.length < 3) candidatePool = eligible;
      candidatePool = applyHardDressCodeFilter(candidatePool, req.dressCode);
      const applyTransportFilter = isTransportActivity(req.label) && changeAssumedPossible(req, allRequirements, activities);
      candidatePool = applyTransportPracticalityFilter(candidatePool, applyTransportFilter);

      if (candidatePool.length === 0) {
        failed.push({ date: req.date, daySegment: req.daySegment, reason: "No wardrobe piece matches this activity's dress code, weather window, or day/evening slot." });
        continue;
      }

      // Real forecast within ~15 days, a 5-year historical average beyond
      // that — see trip-weather.server.ts. Missing coordinates (no
      // destination lat/lon saved) falls back to null exactly as before,
      // rather than guessing a temperature. Reused from the map built
      // ahead of buildCapsule above — same numbers, computed once.
      const dayWeather = dayWeatherByActivity.get(req.activityId) ?? null;
      const temperature = tempByActivity.get(req.activityId) ?? null;
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

      // Evening usually runs cooler than the same day's daytime (that's
      // exactly why temperature above uses tempMin for evening / tempMax
      // for day) — but that fact never reached the model choosing BETWEEN
      // two similarly-styled tops (a short-sleeve tee vs a long-sleeve
      // shirt), only the absolute hot/cold thresholds did. A short-sleeve
      // top for a warm Day and a long-sleeve one for a cooler Evening is a
      // preference, not a violation (a sleeveless dress is still valid for
      // a warm evening) — so this is a system-prompt Default rule
      // (relativeWarmthHint), not a hard exclusion like violatesWeather.
      let relativeWarmthHint: string | null = null;
      if (dayWeather && Math.abs(dayWeather.tempMax - dayWeather.tempMin) >= 4) {
        relativeWarmthHint = req.daySegment === "evening"
          ? `this evening (~${Math.round(dayWeather.tempMin)}°C) is cooler than today's daytime (~${Math.round(dayWeather.tempMax)}°C) — between similarly-styled tops (e.g. a short-sleeve vs a long-sleeve piece), prefer the warmer one for this look.`
          : `today's daytime (~${Math.round(dayWeather.tempMax)}°C) is warmer than tonight (~${Math.round(dayWeather.tempMin)}°C) — between similarly-styled tops, prefer the lighter one for this look.`;
      }

      const result = await suggestOutfitCore({
        supabase, userId,
        temperature,
        condition,
        occasion: occasionText(req),
        dressRules,
        gender: profile?.gender ?? null,
        styleBoldness: profile?.style_boldness ?? null,
        items,
        avoidItemIds: Array.from(new Set([...usedOutfits.slice(-avoidOutfitWindow).flat(), ...sweatConsumedItemIds])),
        locationIdOverride: null,
        relativeWarmthHint,
        daySegment: req.daySegment,
      });

      if (!result.ok || !result.item_ids.length) {
        failed.push({ date: req.date, daySegment: req.daySegment, reason: !result.ok ? result.error : "Couldn't compose a valid look from the eligible pieces." });
        continue;
      }

      usedOutfits.push(result.item_ids);
      result.item_ids.forEach((id) => allChosenItemIds.add(id));

      // "Hot enough that sweat is a real concern" — deliberately its own
      // constant (see isSweatConsumable), not reused from HOT_THRESHOLD_C
      // or MILD_WARM_THRESHOLD_C, since it's answering a different
      // question (skin hygiene, not "is a coat wrong" or "is a boot a bit
      // much").
      for (const id of result.item_ids) {
        const chosenItem = pool.find((p) => p.id === id);
        if (isSweatConsumable(chosenItem?.category ?? null, temperature)) sweatConsumedItemIds.add(id);
      }

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

    // Persist what was actually chosen this run into the durable capsule
    // — only items that made it into a real generated outfit, not every
    // raw buildCapsule() candidate, to keep the persisted capsule genuinely
    // minimal rather than accumulating "considered but never worn" items.
    // ignoreDuplicates: a row already present (whatever its source or
    // removed_by_user) is left exactly as it is — this never resurrects a
    // manual removal (impossible anyway, since excluded items can't reach
    // allChosenItemIds) and never overwrites a 'user'-sourced row's source.
    if (allChosenItemIds.size) {
      const capsuleRowsToInsert = Array.from(allChosenItemIds).map((wardrobe_item_id) => ({
        trip_id: data.tripId,
        wardrobe_item_id,
        source: "automatic" as const,
      }));
      await (supabase.from("trip_capsule_items" as never) as any)
        .upsert(capsuleRowsToInsert, { onConflict: "trip_id,wardrobe_item_id", ignoreDuplicates: true });
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
}
