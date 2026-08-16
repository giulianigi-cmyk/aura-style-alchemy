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
    // The rules below this line are styling DEFAULTS, not absolute bans —
    // treat them as: strong preference → deviate when the outfit's own
    // context makes the combination clearly intentional (a monochrome-
    // adjacent look, a deliberate color-blocked statement, an eclectic
    // outfit the wardrobe's style tags support) → your final judgment
    // wins. A real outfit that reads as put-together always beats
    // mechanically satisfying every rule below.
    "Default: avoid combining black and navy/dark blue in the same outfit — two near-identical dark neutrals more often read as a mismatch than a choice. Deviate when one is clearly a small accent against the other as the dominant piece, or when nothing else in the eligible pieces avoids it.",
    "Default: keep the total color count to about 3-4 per outfit, counting accessories — neutrals (black, white, grey, beige, navy, brown, cream) are forgiving and don't count as strictly as a bold or saturated color does. Going over this isn't a hard stop, just a sign to double check the extra colors are earning their place rather than accumulating by accident.",
    "Default: when shoes and a bag are both part of the outfit, prefer their leather tone coordinating with EACH OTHER specifically — black shoes with a black/grey-toned bag, brown/cognac/tan shoes with a brown/tan/navy-toned bag. This is only about the two leather accessories relative to each other, not to the rest of the outfit — black shoes with a brown dress, sweater, or trousers is completely normal and not a deviation from anything.",
    "Default: avoid two different bold patterns in the same outfit (leopard with stripes, floral with plaid). One dominant pattern plus one clearly secondary/small-scale pattern can work — e.g. a subtly striped shirt under a tartan blazer — when their scale and color contrast are deliberately different, not just two unrelated statements colliding.",
    "Default: avoid pairing a bold statement pattern (leopard, animal print, floral, plaid) with another loud, saturated, contrasting color elsewhere in the outfit. Once one piece is doing the visual work, lean the rest neutral or toward the pattern's own dominant color — unless the wardrobe's style tags for this person suggest they genuinely favor maximalist, high-contrast combinations, in which case a bolder pairing can be the right call.",
    "Default: denim-on-denim works when both pieces are the same wash/tone, or are deliberately very different (white denim with dark blue denim) — two similar-but-not-matching mid-blue denim pieces tend to clash rather than coordinate. When unsure and no clearly-matching or clearly-contrasting pair exists, use only one denim piece.",
    "Default: don't pair a short/mini-length skirt or dress with a deep/plunging neckline in the same outfit — treat the outfit's overall visual exposure as something to balance, not maximize on every axis at once. This is about overall balance, not a moral judgment, and it never overrides the dress-rules constraints stated earlier, which always take priority when they conflict.",
    "Default: an evening-specific piece (an evening gown, a cocktail dress, anything formality 5) belongs in an Evening segment, not Day — deviate only if the eligible pieces genuinely leave nothing better for that day.",
    "Default: keep formality roughly consistent across the outfit — an elegant, dressed-up piece paired with something at the opposite end (flip-flops with a tailored dress, gym sneakers with a cocktail dress) usually reads as unintentional. A deliberate contrast (like a smart top with clean minimal sneakers) can absolutely work when the rest of the outfit supports it as a coherent choice rather than an accident.",
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
    "Color palette by occasion, when choosing between otherwise-equal options: 'Formal'/'Business Formal' favors navy, grey, black, black-and-white; 'Work'/'Business Casual' favors khaki, light grey, navy, brown as a base with bordeaux, olive, camel, or light blue as accents; 'Smart Casual'/'Weekend' allows one clearly colorful statement piece against a simple base. This is a preference between similarly-fitting options, not a hard exclusion — don't reject an otherwise great outfit purely for using an off-palette color.",
    "Sequins, sparkle, or lurex/metallic fabric are for evening only — never pick a sequinned or sparkly piece for a Day segment, regardless of occasion, even outside a Work context specifically.",
    "Use each item's subcategory when present to judge fit-for-purpose: e.g. in hot weather prefer sandals/flats over boots; in rain or cold prefer boots over sandals; for formal occasions prefer pumps/heels over sneakers. When subcategory is empty, judge from category alone.",
    "A 'Running Shoes' subcategory item is built for running, not for everyday city walking — never pick it for a non-Sport occasion unless it is the only shoe available in the catalog. For a Sport/gym/running occasion specifically, it's the right choice.",
    "A gilet or waistcoat (vest) is never worn directly against skin with nothing underneath — always pair it with a shirt, t-shirt, or top layered beneath it. A tailored suit waistcoat additionally expects a blazer/jacket over it for a complete formal look, not worn as the outermost layer on its own.",
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
