import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { COLOR_NAMES } from "./color-palette";

const CATEGORIES = ["Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories", "Underwear"] as const;
const SEASONS = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"] as const;
const STYLES = ["Minimal", "Editorial", "Quiet luxury", "Street", "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage"] as const;
const OCCASIONS = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"] as const;
const MATERIALS = ["Silk", "Linen", "Cotton", "Wool", "Cashmere", "Denim", "Leather", "Suede", "Synthetic", "Knit"] as const;

const InputSchema = z.object({
  imageDataUrl: z.string().min(20), // data:image/...;base64,...
});

const OutputSchema = z.object({
  category: z.string(),
  colors: z.array(z.string()),
  styles: z.array(z.string()),
  occasions: z.array(z.string()),
  seasons: z.array(z.string()),
  brand: z.string(),
  materials: z.array(z.string()),
});

export const analyzeWardrobeImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const systemPrompt = [
      "You analyze a single fashion garment photo and return structured wardrobe metadata.",
      `Return category as EXACTLY one of: ${CATEGORIES.join(", ")}.`,
      `Return colors as an array (1-3 items) picked EXACTLY from this fixed palette (use these names verbatim): ${COLOR_NAMES.join(", ")}. Pick the closest matches; never invent color names.`,
      `Return styles as an array (0-3) from: ${STYLES.join(", ")}.`,
      `Return occasions as an array (0-3) from: ${OCCASIONS.join(", ")}.`,
      `Return seasons as an array (0-5) from: ${SEASONS.join(", ")}. Use "All Seasons" when unsure.`,
      `Return materials as an array (1-2) from: ${MATERIALS.join(", ")}. Always give your best guess — materials power season matching and outfit suggestions, and the user can correct them before saving. Combine visible texture cues (sheen, weave, grain, knit stitches) with what this garment type is typically made of (t-shirts and shirts → Cotton; jeans and denim jackets → Denim; tailored blazers and coats → Wool or Synthetic; flowing dresses and blouses → Silk, Linen or Synthetic; chunky sweaters → Knit, Wool or Cashmere; boots and belts → Leather or Suede). Return an empty array only if the item is genuinely impossible to assess (e.g. heavily obscured or not a garment).`,
      "Return brand ONLY if a clearly visible logo/label is present in the image; otherwise return an empty string. Never guess a brand.",
      "If a field cannot be determined confidently, return an empty array or empty string for it.",
    ].join(" ");

    try {
      const { output } = await generateText({
        model: gateway("google/gemini-2.5-flash"),
        output: Output.object({ schema: OutputSchema }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: systemPrompt },
              { type: "image", image: data.imageDataUrl },
            ],
          },
        ],
      });

      // Filter to allowed values
      const allowed = <T extends readonly string[]>(arr: string[], set: T) =>
        arr.filter(v => (set as readonly string[]).includes(v));

      return {
        category: (CATEGORIES as readonly string[]).includes(output.category) ? output.category : "",
        colors: output.colors.filter(c => COLOR_NAMES.includes(c)),
        styles: allowed(output.styles, STYLES),
        occasions: allowed(output.occasions, OCCASIONS),
        seasons: allowed(output.seasons, SEASONS),
        brand: output.brand?.trim() ?? "",
        materials: allowed(output.materials, MATERIALS),
      };
    } catch (err) {
      console.error("[AURA analyze] failed", err);
      return { category: "", colors: [], styles: [], occasions: [], seasons: [], brand: "", materials: [] };
    }
  });
