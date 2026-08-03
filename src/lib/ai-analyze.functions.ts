import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { COLOR_NAMES } from "./color-palette";
import {
  MATERIAL_OPTIONS, SUBCATEGORY_OPTIONS, LENGTH_OPTIONS, SLEEVE_LENGTH_OPTIONS,
  FIT_OPTIONS, HEEL_HEIGHT_OPTIONS, TOE_SHAPE_OPTIONS, CLOSURE_OPTIONS,
  GENDER_OPTIONS, STYLE_TAG_OPTIONS, ATTRIBUTE_APPLICABILITY,
} from "./wardrobe-options";
import { parseAiJson } from "./ai-json";

const CATEGORIES = ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Outerwear", "Shoes", "Bags", "Accessories", "Underwear", "Swimwear", "Activewear"] as const;
const SEASONS = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"] as const;
const STYLES = ["Minimal", "Editorial", "Quiet luxury", "Street", "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage"] as const;
const OCCASIONS = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"] as const;
const MATERIALS = MATERIAL_OPTIONS;
const ALL_SUBCATEGORIES = Array.from(new Set(Object.values(SUBCATEGORY_OPTIONS).flat()));

// Type scritto per categoria (non una lista unica appiattita), così il
// modello associa correttamente il tipo alla categoria appena scelta.
const SUBCATEGORY_MAP_TEXT = CATEGORIES
  .map((c) => `  - ${c}: ${SUBCATEGORY_OPTIONS[c]?.join(", ") ?? ""}`)
  .join("\n");

const InputSchema = z.object({
  imageDataUrl: z.string().min(20), // data:image/...;base64,...
});

const OutputSchema = z.object({
  category: z.string(),
  subcategory: z.string(), // = "Type": solo il tipo di capo, mai lunghezza/tacco/fit
  colors: z.array(z.string()),
  styles: z.array(z.string()),
  occasions: z.array(z.string()),
  seasons: z.array(z.string()),
  brand: z.string(),
  materials: z.array(z.string()),
  length: z.string(),
  sleeveLength: z.string(),
  fit: z.string(),
  heelHeight: z.string(),
  toeShape: z.string(),
  closure: z.string(),
  gender: z.string(),
  styleTags: z.array(z.string()),
});

export const analyzeWardrobeImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const systemPrompt = [
      "You analyze a single fashion garment photo and return structured wardrobe metadata.",
      `First decide category as EXACTLY one of: ${CATEGORIES.join(", ")}.`,
      `Then, based on that category, return subcategory (this is the garment's TYPE — e.g. "T-Shirt", "Wrap Dress" — NEVER a length or heel height, those are separate fields below) as EXACTLY one value from the list for that SAME category — never mix values from a different category:\n${SUBCATEGORY_MAP_TEXT}\nAlways give your best guess from the matching category's list rather than leaving it empty. Return an empty string only if the garment type is genuinely ambiguous even after picking a category.`,
      `Return colors as an array (1-3 items) picked EXACTLY from this fixed palette (use these names verbatim): ${COLOR_NAMES.join(", ")}. Pick the closest matches; never invent color names.`,
      `Return styles as an array (0-3) from: ${STYLES.join(", ")}.`,
      `Return occasions as an array (0-3) from: ${OCCASIONS.join(", ")}.`,
      `Return seasons as an array (0-5) from: ${SEASONS.join(", ")}. Use "All Seasons" when unsure.`,
      `Return materials as an array (1-2) from: ${MATERIALS.join(", ")}. Always give your best guess — materials power season matching and outfit suggestions, and the user can correct them before saving. Combine visible texture cues (sheen, weave, grain, knit stitches) with what this garment type is typically made of (t-shirts and shirts → Cotton; jeans and denim jackets → Denim; tailored blazers and coats → Wool, Polyester or Viscose; flowing dresses and blouses → Viscose, Silk, Linen or Polyester; chunky sweaters → Knit, Wool or Cashmere; sporty/technical pieces → Polyester, Polyamide or Elastane; boots and belts → Leather or Suede; watches, jewelry and metal hardware → Metal, Steel, Gold, Silver or Pearl). Return an empty array only if the item is genuinely impossible to assess (e.g. heavily obscured or not a garment).`,
      "Return brand ONLY if a clearly visible logo/label is present in the image; otherwise return an empty string. Never guess a brand.",
      "",
      "SEPARATE ATTRIBUTES — these are independent fields, never folded into subcategory. Only fill in an attribute if it genuinely applies to this category (see rules below); otherwise return an empty string for it:",
      `- length (applies to: ${ATTRIBUTE_APPLICABILITY.length.join(", ")}): EXACTLY one of ${LENGTH_OPTIONS.join(", ")}.`,
      `- sleeveLength (applies to: ${ATTRIBUTE_APPLICABILITY.sleeveLength.join(", ")}): EXACTLY one of ${SLEEVE_LENGTH_OPTIONS.join(", ")}.`,
      `- fit (applies to: ${ATTRIBUTE_APPLICABILITY.fit.join(", ")}): EXACTLY one of ${FIT_OPTIONS.join(", ")}.`,
      `- heelHeight (applies to: ${ATTRIBUTE_APPLICABILITY.heelHeight.join(", ")} only): EXACTLY one of ${HEEL_HEIGHT_OPTIONS.join(", ")}.`,
      `- toeShape (applies to: ${ATTRIBUTE_APPLICABILITY.toeShape.join(", ")} only): EXACTLY one of ${TOE_SHAPE_OPTIONS.join(", ")}.`,
      `- closure (applies to: ${ATTRIBUTE_APPLICABILITY.closure.join(", ")}): EXACTLY one of ${CLOSURE_OPTIONS.join(", ")}.`,
      `- gender: EXACTLY one of ${GENDER_OPTIONS.join(", ")}. Only guess Woman or Man if the cut/design is unambiguously gendered (e.g. a bra, boxers); otherwise return "Unisex".`,
      `- styleTags (array, 1-4 items): pick from ${STYLE_TAG_OPTIONS.join(", ")}. These are free-form aesthetic labels for future style matching — be generous but accurate.`,
      "If a field cannot be determined confidently, or does not apply to this category, return an empty array or empty string for it.",
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
      '{"category": "", "subcategory": "", "colors": [], "styles": [], "occasions": [], "seasons": [], "brand": "", "materials": [], "length": "", "sleeveLength": "", "fit": "", "heelHeight": "", "toeShape": "", "closure": "", "gender": "", "styleTags": []}',
    ].join(" ");
    const fallback = {
      category: "", subcategory: "", colors: [], styles: [], occasions: [],
      seasons: [], brand: "", materials: [], length: "", sleeveLength: "",
      fit: "", heelHeight: "", toeShape: "", closure: "", gender: "", styleTags: [],
    };

    try {
      const call = () => generateText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: systemPrompt },
              { type: "image", image: data.imageDataUrl },
            ],
          },
        ],
