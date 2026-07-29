import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  occasion: z.string().nullable().optional(),
  dressRules: z.string().nullable().optional(),
  items: z.array(ItemSchema).min(1),
});

const OutputSchema = z.object({
  item_ids: z.array(z.string()),
  explanation: z.string(),
});

export const suggestOutfitAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const wx = data.temperature != null
      ? `Weather: ${Math.round(data.temperature)}°C, ${data.condition ?? "unknown"}.`
      : "Weather: unknown.";
    const occ = data.occasion ? `Occasion: ${data.occasion}.` : "Occasion: everyday.";

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
      "You are a personal stylist. Compose ONE coherent outfit from the user's wardrobe.",
      "Pick 3-5 items that work together (typically 1 top + 1 bottom OR 1 dress, + 1 shoes, optionally 1 outerwear and 1 accessory/bag).",
      "Match the weather and occasion. Prefer colors that harmonize and consistent style.",
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
        // One repair retry: ask again, explicitly pointing out the failure.
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
  });
