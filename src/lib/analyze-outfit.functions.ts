import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { COLOR_NAMES } from "./color-palette";
import { MATERIAL_OPTIONS, SUBCATEGORY_OPTIONS } from "./wardrobe-options";
import { parseAiJson } from "./ai-json";

const CATEGORIES = ["Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories", "Underwear"] as const;
const SEASONS = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"] as const;
const ALL_SUBCATEGORIES = Array.from(new Set(Object.values(SUBCATEGORY_OPTIONS).flat()));

const InputSchema = z.object({
  imageDataUrl: z.string().min(20),
});

const DetectedItemSchema = z.object({
  category: z.string(),
  subcategory: z.string(),
  colors: z.array(z.string()),
  description: z.string(),
  materials: z.array(z.string()),
  seasons: z.array(z.string()),
  confidence: z.number(),
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});

const OutputSchema = z.object({
  items: z.array(DetectedItemSchema),
});

export type DetectedOutfitItem = z.infer<typeof DetectedItemSchema>;

export const analyzeOutfit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const promptText = [
      "You analyze a photo of a person wearing an outfit and identify every distinct visible garment, shoe, bag and accessory.",
      "For EACH separate item worn, return one entry with:",
      `- category: EXACTLY one of ${CATEGORIES.join(", ")}.`,
      `- subcategory: EXACTLY one value from this fixed list matching the category (e.g. if category is "Shoes", pick a Shoes value): ${ALL_SUBCATEGORIES.join(", ")}. Return an empty string only if truly none apply.`,
      `- colors: 1-2 items picked EXACTLY from this fixed palette (verbatim names): ${COLOR_NAMES.join(", ")}.`,
      `- materials: 0-2 items from: ${MATERIAL_OPTIONS.join(", ")}. Best guess from visible texture and garment type; empty array if genuinely unclear.`,
      `- seasons: 0-3 items from: ${SEASONS.join(", ")}.`,
      "- description: 3-6 words, e.g. \"cropped denim jacket\".",
      "- confidence: 0 to 1, how sure you are this is a distinct, correctly identified item.",
      "- bbox: the item's bounding box as FRACTIONS of the full image (0 to 1): x and y are the top-left corner, width and height the box size. Be generous enough to include the whole item.",
      "Do not detect skin, hair, or background as items. Do not detect the same physical item twice. Return between 1 and 12 items, ordered roughly top-to-bottom on the body.",
      "If the photo does not clearly show a person wearing clothes, return an empty items array.",
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
      '{"items": [{"category": "", "subcategory": "", "colors": [], "description": "", "materials": [], "seasons": [], "confidence": 0.9, "bbox": {"x": 0, "y": 0, "width": 0, "height": 0}}]}',
    ].join("\n");

    const buildMessages = () => [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: promptText },
          { type: "image" as const, image: data.imageDataUrl },
        ],
      },
    ];
    try {
      let text: string;
      try {
        text = (await generateText({ model, messages: buildMessages() })).text;
      } catch (err) {
        console.error("[AURA analyze-outfit] first call failed", err);
        text = "";
      }

      let output: z.infer<typeof OutputSchema>;
      try {
        output = parseAiJson(text, OutputSchema);
      } catch {
        const r2 = await generateText({
          model,
          messages: [
            ...buildMessages(),
            { role: "assistant", content: text || "(no response)" },
            {
              role: "user",
              content: "That was not a single valid JSON object matching the required shape. Reply again with ONLY the JSON object, nothing else.",
            },
          ],
        });
        output = parseAiJson(r2.text, OutputSchema);
      }

      const validColors = new Set(COLOR_NAMES);
      const items = output.items
        .filter((it) => (CATEGORIES as readonly string[]).includes(it.category))
        .slice(0, 12)
        .map((it) => {
          const validSubs = SUBCATEGORY_OPTIONS[it.category] ?? [];
          const b = it.bbox;
          const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
          return {
            ...it,
            subcategory: validSubs.includes(it.subcategory) ? it.subcategory : "",
            colors: it.colors.filter((c) => validColors.has(c)).slice(0, 2),
            materials: it.materials.filter((m) => MATERIAL_OPTIONS.includes(m)).slice(0, 2),
            seasons: it.seasons.filter((s) => (SEASONS as readonly string[]).includes(s)),
            confidence: Math.max(0, Math.min(1, it.confidence)),
            bbox: {
              x: clamp01(b.x),
              y: clamp01(b.y),
              width: Math.max(0.05, Math.min(1, b.width || 0.3)),
              height: Math.max(0.05, Math.min(1, b.height || 0.3)),
            },
          };
        });

      return { ok: true as const, items };
    } catch (err) {
      console.error("[AURA analyze-outfit] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "AI failed", items: [] as DetectedOutfitItem[] };
    }
  });
