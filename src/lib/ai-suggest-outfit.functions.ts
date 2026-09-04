import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "./ai-json";
import { isItemAtAnyLocation } from "./wardrobe-location";
import { isItemAllowedByDressPreferences, hasAnyPreference, type DressPreferences } from "./dress-preferences";
import { anyItemViolatesWeather } from "./outfit-weather-rules";

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
  heelHeight: z.string().nullable().optional(),
  toeShape: z.string().nullable().optional(),
  closure: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  styleTags: z.array(z.string()).nullable().optional(),
  // The piece's OWN occasion tags (from Wardrobe → edit → Occasion), as
  // opposed to params.occasion which is the TARGET occasion being
  // generated for. Previously never sent to this engine at all, so an
  // item tagged only "Travel" could freely surface in a Work outfit —
  // the AI had no way to know the tag existed.
  occasion: z.string().nullable().optional(),
  // Set while the item is out on loan (see wardrobe-loans.functions.ts).
  // A loaned item is physically not in the wardrobe right now, so it's
  // excluded before anything else runs — same hard-filter treatment as
  // location and dress preferences, not a prompt-level suggestion.
  activeLoanId: z.string().nullable().optional(),
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
   * Explicit multi-location selection (e.g. "use my main wardrobe AND
   * the beach house while I'm on this trip") — when provided, this
   * REPLACES the single active-location lookup entirely rather than
   * combining with it. An empty array is treated the same as omitting
   * it: no location restriction, everything eligible.
   */
  locationIdsOverride?: string[] | null;
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

  // A caller can explicitly choose which location(s) to build from for
  // this run, rather than always defaulting to whatever's currently
  // active — useful when generating outfits for a period spent
  // somewhere other than the active location, or across more than one
  // (a trip where both the main wardrobe and a second home are in
  // scope). locationIdsOverride (plural) takes priority when provided;
  // otherwise falls back to the single-location behavior this always
  // had.
  let activeLocations: { id: string; is_primary: boolean }[] = [];
  if (params.locationIdsOverride?.length) {
    const { data: locRows } = await (params.supabase.from("wardrobe_locations" as never) as any)
      .select("id, is_primary").in("id", params.locationIdsOverride).eq("user_id", params.userId);
    activeLocations = (locRows ?? []) as { id: string; is_primary: boolean }[];
  } else if (params.locationIdsOverride === undefined) {
    let locationId = params.locationIdOverride;
    if (locationId === undefined) {
      const { data: profileRow } = await (params.supabase.from("profiles" as never) as any)
        .select("active_location_id").eq("id", params.userId).maybeSingle();
      locationId = (profileRow as { active_location_id: string | null } | null)?.active_location_id ?? null;
    }
    if (locationId) {
      const { data: locRow } = await (params.supabase.from("wardrobe_locations" as never) as any)
        .select("id, is_primary").eq("id", locationId).eq("user_id", params.userId).maybeSingle();
      if (locRow) activeLocations = [locRow as { id: string; is_primary: boolean }];
    }
  }
  // locationIdsOverride === [] (explicitly empty) or === null both fall
  // through with activeLocations staying [], which isItemAtAnyLocation
  // already treats as "no restriction" — same as never scoping at all.
  let eligibleItems = params.items
    .filter((it) => !it.activeLoanId)
    .filter((it) =>
      isItemAtAnyLocation({ location_id: it.locationId ?? null }, activeLocations));

  // Hard filter, not just prompt text: SOLO le preferenze impostate per il
  // lavoro quando esistono (mai mischiate con quelle generali), altrimenti
  // le preferenze generali. Prima solo la chat applicava questo come
  // esclusione reale — gli altri motori (weekly, on-demand) lo passavano
  // solo come testo nel prompt, che il modello può ignorare in silenzio.
  const isWorkOccasionForPrefs = (params.occasion ?? "").toLowerCase().startsWith("work");
  const { data: prefsRow } = await (params.supabase.from("profiles" as never) as any)
    .select(isWorkOccasionForPrefs ? "dress_preferences, work_dress_preferences, work_dress_code" : "dress_preferences")
    .eq("id", params.userId).maybeSingle();
  const prefsRowTyped = prefsRow as { dress_preferences?: DressPreferences; work_dress_preferences?: DressPreferences; work_dress_code?: string | null } | null;
  const activeDressPrefs: DressPreferences | null =
    isWorkOccasionForPrefs && hasAnyPreference(prefsRowTyped?.work_dress_preferences)
      ? prefsRowTyped!.work_dress_preferences!
      : (prefsRowTyped?.dress_preferences ?? null);
  if (activeDressPrefs) {
    eligibleItems = eligibleItems.filter((it) => isItemAllowedByDressPreferences(it, activeDressPrefs));
  }

  // Work dress code (from Style Preferences) sets an acceptable formality
  // RANGE for a Work outfit, same mapping as the Outfit Engine spec
  // (Business Casual ~3, Business Formal ~4, etc). Only ever narrows the
  // catalog for a Work occasion, and only ever excludes items that HAVE
  // an explicit formality tag outside the range — an item with no
  // formality set yet (not all wardrobes are fully reanalyzed) is never
  // excluded on this basis, since that would be penalizing missing data
  // rather than an actual mismatch. "None" and "Uniform" apply no
  // constraint at all — a specified uniform makes formality irrelevant,
  // and "None" means the person hasn't set a floor/ceiling.
  const WORK_DRESS_CODE_FORMALITY_RANGE: Record<string, [number, number] | null> = {
    "None": null,
    "Casual": [1, 2],
    "Smart Casual": [2, 3],
    "Business Casual": [3, 4],
    "Business Formal": [4, 5],
    "Uniform": null,
  };
  if (isWorkOccasionForPrefs && prefsRowTyped?.work_dress_code) {
    const range = WORK_DRESS_CODE_FORMALITY_RANGE[prefsRowTyped.work_dress_code] ?? null;
    if (range) {
      const [min, max] = range;
      eligibleItems = eligibleItems.filter((it) => it.formality == null || (it.formality >= min && it.formality <= max));
    }
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

  // Every field ItemSchema accepts must survive into this catalog — this
  // is the object every hard filter below actually reads via
  // catalog.find(...), NOT eligibleItems. A field silently dropped here
  // makes any check against it a permanent no-op even if the field is
  // received and even if a filter function already checks it (this is
  // exactly what happened to length and fit: the Work mini-skirt/dress
  // exclusion and the dress-preference length/fit checks were reading
  // catalog items that never actually carried those two fields).
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
    length: it.length ?? "",
    fit: it.fit ?? "",
    heelHeight: it.heelHeight ?? "",
    toeShape: it.toeShape ?? "",
    closure: it.closure ?? "",
    gender: it.gender ?? "",
    styleTags: it.styleTags ?? [],
    occasion: it.occasion ?? "",
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
    "For a 'Work' occasion specifically, exclude anything sequinned, sparkly, feathered, fringed, or overtly evening/party-coded (check the material and styleTags fields), exclude cocktail or evening dresses, and exclude very short skirts (mini-length). Separately, exclude genuinely bare-shoulder construction — off-shoulder, bardot, halter, strapless, one-shoulder, bandeau (check subcategory and styleTags for these terms) — but a plain sleeveless top or dress (sleeveLength: Sleeveless, no other bare-shoulder signal) is completely normal workwear and must NOT be excluded just for having no sleeves; judge it on formality/coverage like any other piece. Also treat dayEvening \"evening\" or formality 4-5 as a strong signal the piece belongs in an Evening look, not Work — these read as going-out wear, not workwear, even if the color looks fine on paper.",
    "Color palette by occasion, when choosing between otherwise-equal options: 'Formal'/'Business Formal' favors navy, grey, black, black-and-white; 'Work'/'Business Casual' favors khaki, light grey, navy, brown as a base with bordeaux, olive, camel, or light blue as accents; 'Smart Casual'/'Weekend' allows one clearly colorful statement piece against a simple base. This is a preference between similarly-fitting options, not a hard exclusion — don't reject an otherwise great outfit purely for using an off-palette color.",
    "Sequins, sparkle, or lurex/metallic fabric are for evening only — never pick a sequinned or sparkly piece for a Day segment, regardless of occasion, even outside a Work context specifically.",
    "Use each item's subcategory when present to judge fit-for-purpose: e.g. in hot weather prefer sandals/flats over boots; in rain or cold prefer boots over sandals; for formal occasions prefer pumps/heels over sneakers. When subcategory is empty, judge from category alone.",
    "A 'Running Shoes' subcategory item is built for running, not for everyday city walking — never pick it for a non-Sport occasion unless it is the only shoe available in the catalog. For a Sport/gym/running occasion specifically, it's the right choice.",
    "A gilet or waistcoat (vest) is never worn directly against skin with nothing underneath — always pair it with a shirt, t-shirt, or top layered beneath it. A tailored suit waistcoat additionally expects a blazer/jacket over it for a complete formal look, not worn as the outermost layer on its own.",
       "A belt is a genuine styling option, not just a functional afterthought — actively consider one from Accessories when the outfit has a waist to define (high-rise trousers/jeans/skirt with a tucked or cropped top, a Relaxed/Oversized-fit dress or jumpsuit with no built-in waist definition) and the wardrobe has one whose color/formality fits (leather belt with tailoring, a slimmer or woven belt for casual). Skip it when the piece is already fitted at the waist (Slim/Tailored fit) or is a Wrap style — an extra belt there is redundant, not additive.",
    "LAYERING TECHNIQUES — two specific combinations to actively consider, not just default to a single top: (1) a denim shirt or jacket worn OPEN, unbuttoned, over a well-fitted tank top or t-shirt underneath (the layer underneath must be 'Slim'/'Tailored'/'Regular' fit — never Oversized or Cropped, which reads sloppy layered this way); (2) a lace bra or bralette worn deliberately visible under a semi-sheer/sheer shirt or sweater, or under an open blazer, or peeking from a low/plunging neckline top or dress — for occasions where that reads as styled rather than accidental (evening, going-out, creative/bold contexts — never for a Work occasion, and never if it would violate a stated dress preference). Only propose either technique when the wardrobe actually has pieces that fit it (right subcategory/fit/material) — never force a layering trick onto pieces it doesn't suit.",
 "A belt is a genuine styling option, not just a functional afterthought — actively consider one from Accessories when the outfit has a waist to define (high-rise trousers/jeans/skirt with a tucked or cropped top, a Relaxed/Oversized-fit dress or jumpsuit with no built-in waist definition) and the wardrobe has one whose color/formality fits (leather belt with tailoring, a slimmer or woven belt for casual). Skip it when the piece is already fitted at the waist (Slim/Tailored fit) or is a Wrap style — an extra belt there is redundant, not additive.",
    "LAYERING TECHNIQUES — two specific combinations to actively consider, not just default to a single top: (1) a denim shirt or jacket worn OPEN, unbuttoned, over a well-fitted tank top or t-shirt underneath (the layer underneath must be 'Slim'/'Tailored'/'Regular' fit — never Oversized or Cropped, which reads sloppy layered this way); (2) a lace bra or bralette worn deliberately visible under a semi-sheer/sheer shirt or sweater, or under an open blazer, or peeking from a low/plunging neckline top or dress — for occasions where that reads as styled rather than accidental (evening, going-out, creative/bold contexts — never for a Work occasion, and never if it would violate a stated dress preference). Only propose either technique when the wardrobe actually has pieces that fit it (right subcategory/fit/material) — never force a layering trick onto pieces it doesn't suit.",
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
  // Sleeveless is NOT bare shoulders — a plain sleeveless tank/top is a
  // completely normal piece of workwear at the right formality. Bare
  // shoulders is specifically about garment construction that exposes
  // the shoulder itself (off-shoulder, bardot, halter, strapless,
  // one-shoulder, bandeau) — a different thing sleeve length alone
  // can't tell you (an off-shoulder top can have full-length sleeves).
  // No dedicated attribute exists for this in the schema, so this reads
  // the same signal the AI itself uses when tagging subcategory/style —
  // free text, not sleeveLength.
  const BARE_SHOULDER_SIGNAL = /off.?shoulder|bardot|halter|strapless|one.?shoulder|cold.?shoulder|bandeau|tube top/i;
  const violatesWorkRules = (ids: string[]): boolean =>
    ids.some((id) => {
      const item = catalog.find((c) => c.id === id);
      if (!item) return false;
      if ((item.dayEvening ?? "") === "evening" && (item.formality ?? 0) >= 4) return true;
      const text = `${item.subcategory ?? ""} ${(item.styleTags ?? []).join(" ")} ${(item.material ?? []).join(" ")}`;
      if (EVENING_SIGNAL.test(text)) return true;
      if (["Tops", "Dresses", "Jumpsuits"].includes(item.category ?? "") && BARE_SHOULDER_SIGNAL.test(text)) return true;
      return false;
    });

  // Weather is a hard constraint for EVERY occasion, not just Work — see
  // outfit-weather-rules.ts (unica fonte di verità, condivisa con Home).
  const violatesWeather = (ids: string[]): boolean => anyItemViolatesWeather(ids, catalog, params.temperature);

  const isWorkOccasion = (params.occasion ?? "").toLowerCase().startsWith("work");

  // A bag is a mandatory component for a woman's outfit, not just a
  // prompt suggestion the model can skip — same principle as every other
  // hard rule here: the genderLine text above already asks for this, but
  // asking isn't enforcing. Never required for Sport/pool/beach, where a
  // handbag genuinely has no place, and never required when the wardrobe
  // simply has no eligible bag at all (nothing to enforce).
  const NO_BAG_OCCASION_SIGNAL = /sport|gym|yoga|running|hiking|training|pilates|tennis|cycling|pool|piscina|swim|beach|spiaggia|mare|snorkeling/i;
  const catalogHasBag = catalog.some((c) => c.category === "Bags");
  const missingMandatoryBag = (ids: string[]): boolean => {
    if (params.gender !== "Woman") return false;
    if (!catalogHasBag) return false;
    if (NO_BAG_OCCASION_SIGNAL.test(params.occasion ?? "")) return false;
    return !ids.some((id) => catalog.find((c) => c.id === id)?.category === "Bags");
  };

  // Running shoes are for actual Sport/gym/running occasions, never a
  // default "sneakers" pick elsewhere — universal, not just Work, since
  // the same wrong pick (e.g. running shoes for a concert/Everyday
  // outfit) can happen for any occasion type. Only enforced when a
  // non-running alternative genuinely exists in the wardrobe.
  const isSportOccasion = /sport|gym|yoga|running|hiking|training|pilates|tennis|cycling/i.test(params.occasion ?? "");
  const catalogHasNonRunningShoe = catalog.some((c) => c.category === "Shoes" && c.subcategory !== "Running Shoes");
  const violatesFootwearRule = (ids: string[]): boolean => {
    if (isSportOccasion) return false;
    if (!catalogHasNonRunningShoe) return false;
    return ids.some((id) => catalog.find((c) => c.id === id)?.subcategory === "Running Shoes");
  };

  // A piece the person has explicitly tagged as "Travel" or "Sport" only
  // (via Wardrobe → edit → Occasion) is situational — it shouldn't leak
  // into a Work, Evening, or Formal look just because it also happens to
  // fit color/formality. Only fires when the item's occasion tags are
  // SET and specifically one of these two situational tags without also
  // including the target occasion — an item with no occasion tags at
  // all, or one tagged broadly (e.g. "Everyday"), is never excluded by
  // this: most of a wardrobe isn't tagged per-occasion and shouldn't be
  // penalized for it.
  const SPECIALIZED_OCCASION_TAGS = ["Travel", "Sport"];
  const targetOccasionBase = (params.occasion ?? "").split(/[·-]/)[0].trim();
  const violatesOccasionTag = (ids: string[]): boolean =>
    ids.some((id) => {
      const item = catalog.find((c) => c.id === id);
      if (!item?.occasion) return false;
      const tags = item.occasion.split(",").map((s) => s.trim()).filter(Boolean);
      const hasSpecialized = tags.some((tg) => SPECIALIZED_OCCASION_TAGS.includes(tg));
      if (!hasSpecialized) return false;
      return !tags.includes(targetOccasionBase);
    });

  const isValidResult = (ids: string[]): boolean => {
    if (!ids.length) return false;
    if (hasSlotViolation(ids)) return false;
    if (isWorkOccasion && violatesWorkRules(ids)) return false;
    if (violatesWeather(ids)) return false;
    if (missingMandatoryBag(ids)) return false;
    if (violatesFootwearRule(ids)) return false;
    if (violatesOccasionTag(ids)) return false;
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
          system: system + "\n\nIMPORTANT — your previous answer broke a hard rule above (either more than one item in the same slot, an evening-coded/bare-shoulder piece for a Work occasion, an item excluded by the person's stated dress preferences, a piece unsuitable for the actual temperature — e.g. a wool/heavy piece when it's hot, or a bare/light piece when it's cold — or missing the mandatory bag for a women's outfit). Try again, respecting every rule strictly this time.",
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
            if (violatesFootwearRule([id])) return false;
            if (violatesOccasionTag([id])) return false;
            return true;
          });
        }
      } catch (err) {
        console.error("[AURA suggest-outfit] retry failed", err);
      }
    }

    // Last resort, after the retry/sanitize logic above has already run:
    // if the outfit is still missing its mandatory bag (the model simply
    // never included one), append the best available one directly rather
    // than shipping an incomplete women's outfit. Prefers a bag not
    // already excluded by avoidItemIds filtering upstream, and among the
    // eligible ones just takes the first — eligibleItems is already
    // filtered by dress preferences and location, so anything here is
    // already a legitimate candidate.
    if (missingMandatoryBag(item_ids)) {
      const bag = catalog.find((c) => c.category === "Bags" && !item_ids.includes(c.id));
      if (bag) item_ids = [...item_ids, bag.id];
    }

    // If a running-shoe violation survived the sanitize step above (it
    // only strips, it doesn't replace), swap in a proper alternative
    // rather than leaving the outfit without shoes at all.
      if (violatesFootwearRule(item_ids)) {
      const replacement = catalog.find((c) => c.category === "Shoes" && c.subcategory !== "Running Shoes" && !item_ids.includes(c.id));
      if (replacement) item_ids = [...item_ids, replacement.id];
    }

    if (!item_ids.some((id) => catalog.find((c) => c.id === id)?.category === "Shoes")) {
      const shoe = catalog.find((c) =>
        c.category === "Shoes" && !violatesFootwearRule([c.id]) && !violatesOccasionTag([c.id]) && !item_ids.includes(c.id)
      );
      if (shoe) item_ids = [...item_ids, shoe.id];
    }


    // Shoes are part of the STRUCTURE rule described in the prompt, but
    // — unlike the mandatory-bag case above — nothing ever actually
    // verified a Shoes item was present at all, only that IF one was
    // present it didn't violate the running-shoe/slide rules. An outfit
    // missing shoes entirely (the model just never included one, or the
    // sanitize step above stripped one for a weather/work violation
    // without anything replacing it) shipped as "valid" every time. Same
    // append-if-missing pattern as the bag fallback: prefer a shoe that
    // doesn't itself violate the footwear or occasion-tag rules.
    if (!item_ids.some((id) => catalog.find((c) => c.id === id)?.category === "Shoes")) {
      const shoe = catalog.find((c) =>
        c.category === "Shoes" && !violatesFootwearRule([c.id]) && !violatesOccasionTag([c.id]) && !item_ids.includes(c.id)
      );
      if (shoe) item_ids = [...item_ids, shoe.id];
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
