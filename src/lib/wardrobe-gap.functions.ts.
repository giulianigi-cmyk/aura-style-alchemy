import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { ITEM_CATEGORIES } from "./wardrobe-options";
import { COLOR_NAMES } from "./color-palette";
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

/**
 * Analyzes the user's real wardrobe and suggests ONE genuinely missing
 * piece — a category/subcategory/color combination that's absent or
 * under-represented given what they already own. This does NOT invent a
 * specific product, brand, or price (an LLM can't know what's actually
 * for sale) — it names a TYPE of piece with real reasoning. The list of
 * items it would pair with is computed HERE from the real wardrobe (not
 * asked of the model), so it references real, existing pieces — never a
 * fabricated count or fabricated items.
 */
export const analyzeWardrobeGap = createServerFn({ method: "POST" })
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

    const system = [
      "You analyze a real wardrobe catalog and identify ONE genuinely missing piece — a",
      "category + subcategory + color combination that is absent or clearly under-represented,",
      "and that would meaningfully increase how many outfits this person could put together.",
      `Category must be EXACTLY one of: ${ITEM_CATEGORIES.join(", ")}.`,
      `Colors: 1-2 items picked EXACTLY from this fixed palette (verbatim): ${COLOR_NAMES.join(", ")}.`,
      "Do not invent a brand, product name, or price — you have no way of knowing what's for sale.",
      "Base the suggestion strictly on real gaps in the provided catalog (e.g. many tops and bottoms but no outerwear at all, or no neutral shoes to anchor bright pieces).",
      "reason: 1 sentence, concrete, referencing what's actually missing.",
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
      '{"category": "", "subcategory": "", "colors": [], "reason": ""}',
    ].join("\n");

    const userContent = `Wardrobe catalog (JSON):\n${JSON.stringify(catalog)}`;

    try {
      let text: string;
      try {
        text = (await generateText({ model, system, messages: [{ role: "user", content: userContent }] })).text;
      } catch (err) {
        console.error("[AURA wardrobe-gap] first call failed", err);
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
            { role: "user", content: "That was not a single valid JSON object matching the required shape. Reply again with ONLY the JSON object, nothing else." },
          ],
        });
        parsed = parseAiJson(r2.text, OutputSchema);
      }

      const category = ITEM_CATEGORIES.includes(parsed.category) ? parsed.category : ITEM_CATEGORIES[0];
      const colors = parsed.colors.filter((c) => COLOR_NAMES.includes(c));

      // Real matching items, computed here — not trusted from the model.
      // Pieces from OTHER categories that share at least one color with
      // the suggestion; if no color overlap exists, fall back to a
      // capped list of other-category pieces. Deliberately a simple,
      // honest heuristic, not a real outfit-compatibility engine.
      const others = data.items.filter((it) => it.category !== category);
      const colorMatches = others.filter((it) => (it.colors ?? []).some((c) => colors.includes(c)));
      const pairsWithIds = (colorMatches.length > 0 ? colorMatches : others.slice(0, 12)).map((it) => it.id);

      const suggestion: GapSuggestion = {
        category,
        subcategory: parsed.subcategory || "",
        colors,
        reason: parsed.reason,
        pairsWithIds,
      };
      return { ok: true as const, suggestion };
    } catch (err) {
      console.error("[AURA wardrobe-gap] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "Analysis failed" };
    }
  });
