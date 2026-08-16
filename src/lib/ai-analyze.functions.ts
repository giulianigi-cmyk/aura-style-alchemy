import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { COLOR_NAMES } from "./color-palette";
import {
  MATERIAL_OPTIONS, SUBCATEGORY_OPTIONS, SLEEVE_LENGTH_OPTIONS,
  LENGTH_OPTIONS_BY_CATEGORY, lengthOptionsFor,
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

const SUBCATEGORY_MAP_TEXT = CATEGORIES
  .map((c) => `  - ${c}: ${SUBCATEGORY_OPTIONS[c]?.join(", ") ?? ""}`)
  .join("\n");

const InputSchema = z.object({
  imageDataUrl: z.string().min(20),
});

const OutputSchema = z.object({
  category: z.string(),
  subcategory: z.string(),
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
  formality: z.number(),
  dayEvening: z.string(),
  detectedProductCode: z.string(),
  detectedManufacturer: z.string(),
});

export type WardrobeAnalysis = ReturnType<typeof buildFallback>;

function buildFallback() {
  return {
    category: "", subcategory: "", colors: [] as string[], styles: [] as string[], occasions: [] as string[],
    seasons: [] as string[], brand: "", materials: [] as string[], length: "", sleeveLength: "",
    fit: "", heelHeight: "", toeShape: "", closure: "", gender: "", styleTags: [] as string[],
    formality: null as number | null, dayEvening: "",
    detectedProductCode: "", detectedManufacturer: "",
  };
}

/**
 * Logica pura di analisi — nessun middleware, nessun createServerFn.
 * Usata sia dall'endpoint RPC autenticato (analyzeWardrobeImage, chiamato
 * dal client in AddItem.tsx) sia dal job di re-analisi in batch
 * (reanalyzeWardrobe), che gira lato server con privilegi admin e non ha
 * bisogno di un token utente per ogni singola immagine.
 */
export async function analyzeWardrobeImageCore(imageDataUrl: string): Promise<WardrobeAnalysis> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");

  const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-2.5-flash");

  const systemPrompt = [
    "You analyze a single fashion garment photo and return structured wardrobe metadata.",
    `First decide category as EXACTLY one of: ${CATEGORIES.join(", ")}.`,
    `Then, based on that category, return subcategory (this is the garment's TYPE — e.g. "T-Shirt", "Wrap Dress" — NEVER a length or heel height, those are separate fields below) as EXACTLY one value from the list for that SAME category — never mix values from a different category:\n${SUBCATEGORY_MAP_TEXT}\nAlways give your best guess from the matching category's list rather than leaving it empty. Return an empty string only if the garment type is genuinely ambiguous even after picking a category.`,
    `Shoes specifically: "Sneakers" and "Running Shoes" are NOT interchangeable — pick "Running Shoes" for anything that reads as a technical/performance training or running shoe (chunky foam midsole, mesh technical upper, visible cushioning technology like an air unit or foam wedge, bold color-blocking typical of a running model) even if the label or brand also happens to make lifestyle shoes. Pick "Sneakers" only for a clean lifestyle/fashion silhouette (minimal court shoe, canvas, leather, low-profile sole) meant to be worn as a style piece, not for exercise.`,
    `Return colors as an array (1-3 items) picked EXACTLY from this fixed palette (use these names verbatim): ${COLOR_NAMES.join(", ")}. Pick the closest matches; never invent color names.`,
       `Return styles as an array (0-3) from: ${STYLES.join(", ")}. This is the piece's AESTHETIC identity — reason from its silhouette, fit, material and color palette (all attributes you're already assessing below), not from a vague overall impression: Minimal (clean lines, neutral/monochrome colors, no ornamentation); Editorial (bold silhouette or a statement color/print, fashion-forward rather than everyday); Quiet luxury (refined plain basics, muted neutral tones, no visible branding, quality fabric like wool/cashmere/silk); Street (oversized or relaxed fit, sneakers, denim, graphic/logo prints, casual technical fabrics); Romantic (soft flowing fabric, ruffles/florals/lace, pastel or soft colors); Tailored (structured, fitted, sharp precise cuts — blazers, trousers with a clean line); Bohemian (flowing/layered silhouette, earthy tones, natural textured fabric like linen/suede, prints or fringe); Sporty (athletic cut, technical/stretch fabric, sneakers-adjacent); Vintage (a cut or print distinctly evocative of a past decade rather than current). Style, occasion and formality are three separate dimensions — don't let one drive the others: style is aesthetic identity, occasion is when/where it's typically worn, formality is purely how dressed-up it reads. A Sporty-style piece can still suit Everyday or Weekend occasions at low formality; a Tailored piece isn't automatically Formal occasion or high formality (e.g. tailored joggers are Tailored style, Everyday occasion, low formality).`,
    `Return occasions as an array (0-3) from: ${OCCASIONS.join(", ")}.`,
        `Return seasons as an array from: ${SEASONS.join(", ")}. NEVER combine "All Seasons" with a specific season in the same answer — pick either "All Seasons" alone, or 1-3 specific seasons, never both. Reason from the garment's material, coverage and weight rather than guessing: heavy insulating materials (Wool, Cashmere, Shearling, Down, Alpaca, thick fleece) or covering outerwear (coats, heavy jackets, boots) → Autumn/Winter; lightweight breathable materials (Linen, thin Cotton, thin Viscose) or minimal-coverage pieces (shorts, tank tops, sandals, swimwear) → Spring/Summer. Reserve "All Seasons" for genuinely versatile mid-weight basics with no strong material or coverage signal pointing to a specific time of year (e.g. plain cotton t-shirt, straight jeans, a simple leather bag, classic sneakers) — it is not a fallback for uncertainty, and most garments should get a specific 1-2 season pick rather than "All Seasons".`,
        `Return materials as an array (1-2) from: ${MATERIALS.join(", ")}. Always give your best guess — materials power season matching and outfit suggestions, and the user can correct them before saving. Combine visible texture cues (sheen, weave, grain, knit stitches) with what this garment type is typically made of (t-shirts and shirts → Cotton; jeans and denim jackets → Denim; tailored blazers and coats → Wool, Polyester or Viscose; flowing dresses and blouses → Viscose, Silk, Linen or Polyester; chunky sweaters → Wool, Cashmere, Merino or Acrylic depending on visible fiber thickness and sheen; sporty/technical pieces → Polyester, Polyamide or Elastane; boots and belts → Leather or Suede; watches, jewelry and metal hardware → Metal, Steel, Gold, Silver or Pearl). "Knit" describes a construction technique, not a fiber — never return it as a material even if the garment is visibly knitted; name the actual fiber instead. Return an empty array only if the item is genuinely impossible to assess (e.g. heavily obscured or not a garment).`,

    "Return brand if you can identify the comm
