import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { ITEM_CATEGORIES } from "./wardrobe-options";
import { COLOR_NAMES, COLOR_PALETTE } from "./color-palette";
import { parseAiJson } from "./ai-json";

const ItemSchema = z.object({
  id: z.string(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  colors: z.array(z.string()).nullable().optional(),
  style: z.array(z.string()).nullable().optional(),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1),
});

const OutputSchema = z.object({
  category: z.string(),
  subcategory: z.string(),
  colors: z.array(z.string()),
  reason: z.string(),
});

export type GapSuggestion = {
  category: string;
  subcategory: string;
  colors: string[];
  reason: string;
  pairsWithIds: string[];
};

type ChatMsg = { role: "user" | "assistant"; content: string };

// Neutral families pair with virtually everything in real styling - same
// principle already used elsewhere in AURA's color logic. A "Pure White"
// suggestion shouldn't only match other white pieces.
const NEUTRAL_FAMILIES = new Set(["Whites", "Blacks & Greys", "Beiges"]);
const colorFamily = (name: string): string | undefined =>
  COLOR_PALETTE.find((c) => c.name === name)?.family;
const isNeutralColor = (name: string): boolean => {
  const f = colorFamily(name);
  return f ? NEUTRAL_FAMILIES.has(f) : false;
};

// Which categories make sense to show as "would pair with" companions for
// a suggested piece. Deliberately a whitelist, not a blacklist: Underwear,
// Activewear and Swimwear are real wardrobe categories but never belong in
// an everyday outfit-pairing preview, regardless of color match.
const PAIRING_WHITELIST: Record<string, string[]> = {
  Tops: ["Bottoms", "Outerwear", "Shoes", "Bags", "Accessories"],
  Bottoms: ["Tops", "Outerwear", "Shoes", "Bags", "Accessories"],
  Dresses: ["Outerwear", "Shoes", "Bags", "Accessories"],
  Jumpsuits: ["Outerwear", "Shoes", "Bags", "Accessories"],
  Outerwear: ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Shoes", "Bags"],
  Shoes: ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Outerwear", "Bags"],
  Bags: ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Outerwear", "Shoes"],
  Accessories: ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Outerwear"],
  Underwear: [],
  Swimwear: ["Bags", "Accessories"],
  Activewear: ["Shoes", "Bags"],
};

const MAX_PAIRS = 12;
const MAX_ATTEMPTS = 3;

/**
 * Analyzes the user's real wardrobe and suggests ONE genuinely missing
 * piece - a category/subcategory/color combination that's absent or
 * under-represented given what they already own. This does NOT invent a
 * specific product, brand, or price (an LLM can't know what's actually
 * for sale) - it names a TYPE of piece with real reasoning. The list of
 * items it would pair with is computed HERE from the real wardrobe (not
 * asked of the model), so it references real, existing pieces - never a
 * fabricated count or fabricated items.
 *
 * Two hard, code-level guarantees (not just prompt instructions):
 * 1. The suggestion is checked against what's actually owned
 *    (category + subcategory + color) - if the model proposes something
 *    already owned, it's rejected and the model is asked again, up to
 *    MAX_ATTEMPTS times. If no genuine gap is found, we say so honestly
 *    instead of forcing a bad suggestion.
 * 2. "Would pair with" only pulls from categories that make sense as
 *    outfit companions (never Underwear/Activewear/Swimwear), ranked by
 *    real color-compatibility logic (neutrals pair with everything, same
 *    family scores well) instead of literal same-name color matching or
 *    an arbitrary fallback slice of the wardrobe.
 */
export const analyzeWardrobeGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    if (data.items.length < 5) {
      return { ok: false as const, error: "Add a few more pieces to your wardrobe before gap analysis is meaningful." };
    }

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const catalog = data.items.map((it) => ({
      id: it.id,
      category: it.category ?? "",
      subcategory: it.subcategory ?? "",
      colors: it.colors ?? [],
      style: it.style ?? [],
    }));

    // Deterministic ownership index: "category|subcategory" -> colors
    // already owned in that combo. Used as a hard post-check, not trusted
    // to the model's self-report.
    const ownedCombos = new Map<string, Set<string>>();
    for (const it of data.items) {
      if (!it.category || !it.subcategory) continue;
      const k = `${it.category}|${it.subcategory}`;
      const set = ownedCombos.get(k) ?? new Set<string>();
      for (const c of it.colors ?? []) set.add(c);
      ownedCombos.set(k, set);
    }

    const system = [
      "You analyze a real wardrobe catalog and identify ONE genuinely missing piece - a",
      "category + subcategory + color combination that is absent or clearly under-represented,",
      "and that would meaningfully increase how many outfits this person could put together.",
      `Category must be EXACTLY one of: ${ITEM_CATEGORIES.join(", ")}.`,
      `Colors: 1-2 items picked EXACTLY from this fixed palette (verbatim): ${COLOR_NAMES.join(", ")}.`,
      "Do not invent a brand, product name, or price - you have no way of knowing what's for sale.",
      "Base the suggestion strictly on real gaps in the provided catalog (e.g. many tops and bottoms but no outerwear at all, or no neutral shoes to anchor bright pieces).",
      "CRITICAL: never suggest a category+subcategory+color the person already owns - check the catalog color by color, not just by category.",
      "reason: 1 sentence, concrete, referencing what's actually missing.",
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
      '{"category": "", "subcategory": "", "colors": [], "reason": ""}',
    ].join("\n");

    const userContent = `Wardrobe catalog (JSON):\n${JSON.stringify(catalog)}`;
    const messages: ChatMsg[] = [{ role: "user", content: userContent }];

    try {
      let accepted: z.infer<typeof OutputSchema> | null = null;
      let category = "";
      let subcategory = "";
      let colors: string[] = [];

      for (let attempt = 0; attempt < MAX_ATTEMPTS && !accepted; attempt++) {
        let text: string;
        try {
          text = (await generateText({ model, system, messages })).text;
        } catch (err) {
          console.error("[AURA wardrobe-gap] call failed", err);
          text = "";
        }

        let candidate: z.infer<typeof OutputSchema>;
        try {
          candidate = parseAiJson(text, OutputSchema);
        } catch {
          const r2 = await generateText({
            model,
            system,
            messages: [
              ...messages,
              { role: "assistant", content: text || "(no response)" },
              { role: "user", content: "That was not a single valid JSON object matching the required shape. Reply again with ONLY the JSON object, nothing else." },
            ],
          });
          candidate = parseAiJson(r2.text, OutputSchema);
        }

        const candCategory = ITEM_CATEGORIES.includes(candidate.category) ? candidate.category : ITEM_CATEGORIES[0];
        const candColors = candidate.colors.filter((c) => COLOR_NAMES.includes(c));
        const owned = ownedCombos.get(`${candCategory}|${candidate.subcategory}`);
        const alreadyOwned = !!owned && candColors.length > 0 && candColors.some((c) => owned.has(c));

        if (!alreadyOwned) {
          accepted = candidate;
          category = candCategory;
          subcategory = candidate.subcategory;
          colors = candColors;
          break;
        }

        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content: `That's already owned: the wardrobe already has ${candCategory} / ${candidate.subcategory} in ${[...owned].join(", ")}. Pick a genuinely different, currently missing category+subcategory+color combination. Reply with ONLY the JSON object.`,
        });
      }

      if (!accepted) {
        return { ok: false as const, error: "Couldn't find a clear wardrobe gap that isn't already covered - the wardrobe looks fairly complete." };
      }

      // Dresses/Jumpsuits gia' coprono lo slot top+bottom - abbinarli a un
      // Top o Bottom suggerito (o viceversa) non si indossa mai davvero
      // insieme, indipendentemente dal colore. Stessa regola gia' usata
      // per la generazione outfit AI altrove in AURA. Gestita qui tramite
      // whitelist esplicita (mai categorie come Underwear/Activewear).
      const whitelist = new Set(PAIRING_WHITELIST[category] ?? []);
      const others = data.items.filter((it) => it.category && whitelist.has(it.category));

      // Color-aware ranking - reuses AURA's neutral-color logic instead of
      // a literal same-name match: neutrals pair with (almost) everything,
      // same color family scores well, everything else in a whitelisted
      // category is still eligible (real outfits mix colors) but ranks
      // lower. This replaces the old "same color, else random 12" fallback.
      //
      // Fixed a real bias here: neutral-on-neutral used to stack TWO
      // separate +2 bonuses (once for "the suggestion is neutral", once
      // for "this item is neutral") on top of each other, so whenever the
      // suggested piece was neutral - which is most of the time, since
      // that's the safe/versatile color an AI tends to suggest - every
      // neutral item in the wardrobe outscored everything else combined.
      // In practice that meant the "would pair with" preview was almost
      // always a wall of white/black/beige pieces regardless of what was
      // actually in the wardrobe. Neutral-on-neutral is still rewarded
      // (it's a genuinely strong pairing) but no longer double-stacked.
      const suggestedIsNeutral = colors.length === 0 || colors.every(isNeutralColor);
      const suggestedFamilies = new Set(colors.map(colorFamily).filter((f): f is string => !!f));

      const scored = others.map((it) => {
        const itColors = it.colors ?? [];
        const itemIsNeutral = itColors.some(isNeutralColor);
        let score = 0;
        if (itColors.some((c) => colors.includes(c))) score += 3; // exact color match
        if (suggestedIsNeutral && itemIsNeutral) score += 2; // both neutral: strong pairing, counted once
        else if (suggestedIsNeutral || itemIsNeutral) score += 1; // only one side neutral: still helps, less aggressively
        if (itColors.some((c) => suggestedFamilies.has(colorFamily(c) ?? ""))) score += 1; // same family
        return { it, score };
      });

      // Diversity, not just a global top-N by score: several items in
      // the same category (e.g. four pairs of light trousers) can easily
      // tie for the top score, and showing all four told the person
      // nothing new about their wardrobe. Round-robin across categories
      // instead - best-scoring item from each eligible category first,
      // then second-best from each, and so on - so the preview actually
      // reflects the breadth of what they own.
      const byCategory = new Map<string, typeof scored>();
      for (const s of scored) {
        const cat = s.it.category ?? "";
        const arr = byCategory.get(cat) ?? [];
        arr.push(s);
        byCategory.set(cat, arr);
      }
      for (const arr of byCategory.values()) arr.sort((a, b) => b.score - a.score);
      const categoryOrder = [...byCategory.keys()].sort(
        (a, b) => (byCategory.get(b)![0]?.score ?? 0) - (byCategory.get(a)![0]?.score ?? 0)
      );
      const pairsWithIds: string[] = [];
      for (let round = 0; pairsWithIds.length < MAX_PAIRS; round++) {
        let addedThisRound = false;
        for (const cat of categoryOrder) {
          const arr = byCategory.get(cat)!;
          if (arr[round]) {
            pairsWithIds.push(arr[round].it.id);
            addedThisRound = true;
            if (pairsWithIds.length >= MAX_PAIRS) break;
          }
        }
        if (!addedThisRound) break;
      }

      const suggestion: GapSuggestion = {
        category,
        subcategory,
        colors,
        reason: accepted.reason,
        pairsWithIds,
      };
      return { ok: true as const, suggestion };
    } catch (err) {
      console.error("[AURA wardrobe-gap] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "Analysis failed" };
    }
  });
