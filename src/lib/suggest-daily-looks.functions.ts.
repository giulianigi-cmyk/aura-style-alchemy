import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "./ai-json";

const ItemSchema = z.object({
  id: z.string(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  colors: z.array(z.string()).nullable().optional(),
  style: z.array(z.string()).nullable().optional(),
  season: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
});

const InputSchema = z.object({
  temperature: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  dressRules: z.string().nullable().optional(),
  items: z.array(ItemSchema).min(3),
});

const LookSchema = z.object({
  item_ids: z.array(z.string()),
  occasion: z.string().min(1),
  explanation: z.string(),
});
const OutputSchema = z.object({
  today: LookSchema,
  curated: z.array(LookSchema).min(1).max(4),
});
export type DailyLook = z.infer<typeof LookSchema>;
export type DailyLooksResult = z.infer<typeof OutputSchema>;

/**
 * Generates real outfit recommendations from the user's ACTUAL wardrobe in
 * a single AI call: one "today" look (weather-aware, for right now) plus
 * a small set of "curated" looks spanning a few different real occasions.
 * All items referenced must exist in the provided catalog — nothing is
 * invented. Intended to be called once per day and cached by the caller
 * (see home_suggestions table), not re-generated on every page view.
 */
export const suggestDailyLooks = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    if (data.items.length < 3) {
      return { ok: false as const, error: "Not enough wardrobe pieces to compose a look yet." };
    }

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const wx = data.temperature != null
      ? `Today's weather: ${Math.round(data.temperature)}°C, ${data.condition ?? "unknown"}.`
      : "Today's weather: unknown.";

    const catalog = data.items.slice(0, 200).map((it) => ({
      id: it.id,
      category: it.category ?? "",
      subcategory: it.subcategory ?? "",
      colors: it.colors ?? [],
      style: it.style ?? [],
      season: it.season ?? "",
      brand: it.brand ?? "",
    }));

    const system = [
      ...(data.dressRules ? [data.dressRules, ""] : []),
      "You are a personal stylist. Compose REAL outfits using ONLY items from the",
      "user's own wardrobe catalog below. Never invent an item id.",
      "",
      "Produce TWO things:",
      "1. \"today\": ONE outfit specifically appropriate for today's actual weather",
      "   (see below), for a general everyday occasion.",
      "2. \"curated\": build toward THREE specific occasions, in this order:",
      "   \"Work\", \"Weekend\", \"Evening\". Each one is a genuinely different brief —",
      "   Work = put-together and professional, Weekend = relaxed and casual,",
      "   Evening = dressier or more elevated. Give each its own distinct outfit,",
      "   built for that specific brief, not a minor variation of another one.",
      "   Set each look's \"occasion\" field to exactly that label. Avoid reusing",
      "   the exact same combination as \"today\" or as another curated look.",
      "",
      "Each outfit: pick 3-5 items that work together (typically 1 top + 1 bottom OR",
      "1 dress, + shoes, optionally outerwear/accessory). Match colors and style",
      "coherently. Use subcategory to judge fit-for-purpose when present (e.g. prefer",
      "sandals over boots in hot weather; heels over sneakers for formal occasions).",
      "If the wardrobe genuinely can't support a distinct, coherent look for one of",
      "the three occasions without being repetitive or nonsensical, skip that",
      "occasion rather than forcing a bad or near-identical combination — quality",
      "over hitting the count of three.",
      "occasion: exactly \"Work\", \"Weekend\", or \"Evening\" for curated looks; any",
      "short label for \"today\".",
      "explanation: 1 short sentence (max 160 chars) on why it works.",
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text,",
      "in exactly this shape:",
      '{"today":{"item_ids":[],"occasion":"","explanation":""},"curated":[{"item_ids":[],"occasion":"","explanation":""}]}',
    ].join("\n");

    const userContent = `${wx}\nWardrobe:\n${JSON.stringify(catalog)}`;
    const validIds = new Set(catalog.map((c) => c.id));

    /** Fraction of overlap between two item sets (0 = nothing shared,
     *  1 = identical sets). Simple, explainable, no scoring system needed. */
    const jaccard = (a: string[], b: string[]): number => {
      const setA = new Set(a);
      const setB = new Set(b);
      const intersection = [...setA].filter((x) => setB.has(x)).length;
      const union = new Set([...setA, ...setB]).size;
      return union === 0 ? 0 : intersection / union;
    };
    const TOO_SIMILAR = 0.7; // 70%+ shared items counts as "practically the same look"

    const sanitize = (r: DailyLooksResult): DailyLooksResult => {
      const today = { ...r.today, item_ids: r.today.item_ids.filter((id) => validIds.has(id)) };
      const seen = [today.item_ids];
      const curated = r.curated
        .map((l) => ({ ...l, item_ids: l.item_ids.filter((id) => validIds.has(id)) }))
        .filter((l) => l.item_ids.length >= 2)
        // Drop any curated look that's identical OR near-identical (>=70%
        // item overlap) to "today" or an earlier curated look — a real
        // similarity check, not just an exact-match string comparison.
        .filter((l) => {
          if (seen.some((s) => jaccard(l.item_ids, s) >= TOO_SIMILAR)) return false;
          seen.push(l.item_ids);
          return true;
        });
      return { today, curated };
    };

    try {
      let text: string;
      try {
        text = (await generateText({ model, system, messages: [{ role: "user", content: userContent }] })).text;
      } catch (err) {
        console.error("[AURA daily-looks] first call failed", err);
        text = "";
      }

      let parsed: DailyLooksResult;
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

      const clean = sanitize(parsed);
      if (clean.today.item_ids.length < 2) {
        return { ok: false as const, error: "Couldn't compose a valid look from your wardrobe." };
      }
      return { ok: true as const, result: clean };
    } catch (err) {
      console.error("[AURA daily-looks] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "Generation failed" };
    }
  });
