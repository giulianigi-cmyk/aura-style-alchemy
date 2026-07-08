import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";

const ItemSchema = z.object({
  id: z.string(),
  category: z.string().nullable().optional(),
  colors: z.array(z.string()).nullable().optional(),
  style: z.array(z.string()).nullable().optional(),
  season: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
});

const InputSchema = z.object({
  temperature: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  occasion: z.string().nullable().optional(),
  items: z.array(ItemSchema).min(1),
});

const OutputSchema = z.object({
  item_ids: z.array(z.string()),
  explanation: z.string(),
});

export const suggestOutfitAI = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const wx = data.temperature != null
      ? `Weather: ${Math.round(data.temperature)}°C, ${data.condition ?? "unknown"}.`
      : "Weather: unknown.";
    const occ = data.occasion ? `Occasion: ${data.occasion}.` : "Occasion: everyday.";

    const catalog = data.items.slice(0, 200).map((it) => ({
      id: it.id,
      category: it.category ?? "",
      colors: it.colors ?? [],
      style: it.style ?? [],
      season: it.season ?? "",
      brand: it.brand ?? "",
    }));

    const system = [
      "You are a personal stylist. Compose ONE coherent outfit from the user's wardrobe.",
      "Pick 3-5 items that work together (typically 1 top + 1 bottom OR 1 dress, + 1 shoes, optionally 1 outerwear and 1 accessory/bag).",
      "Match the weather and occasion. Prefer colors that harmonize and consistent style.",
      "Return ONLY item ids that exist in the provided catalog. Never invent ids.",
      "Explanation: 1-2 short sentences (max 200 chars) on why these pieces work.",
    ].join(" ");

    try {
      const { output } = await generateText({
        model: gateway("google/gemini-2.5-flash"),
        output: Output.object({ schema: OutputSchema }),
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `${wx} ${occ}\nWardrobe:\n${JSON.stringify(catalog)}`,
          },
        ],
      });
      const validIds = new Set(catalog.map((c) => c.id));
      const item_ids = output.item_ids.filter((id) => validIds.has(id)).slice(0, 5);
      return {
        ok: true as const,
        item_ids,
        explanation: (output.explanation ?? "").slice(0, 240),
      };
    } catch (err) {
      console.error("[AURA suggest-outfit] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "AI failed" };
    }
  });
