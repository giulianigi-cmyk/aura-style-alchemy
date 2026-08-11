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
});

export type WardrobeAnalysis = ReturnType<typeof buildFallback>;

function buildFallback() {
  return {
    category: "", subcategory: "", colors: [] as string[], styles: [] as string[], occasions: [] as string[],
    seasons: [] as string[], brand: "", materials: [] as string[], length: "", sleeveLength: "",
    fit: "", heelHeight: "", toeShape: "", closure: "", gender: "", styleTags: [] as string[],
    formality: null as number | null, dayEvening: "",
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
    `Return colors as an array (1-3 items) picked EXACTLY from this fixed palette (use these names verbatim): ${COLOR_NAMES.join(", ")}. Pick the closest matches; never invent color names.`,
    `Return styles as an array (0-3) from: ${STYLES.join(", ")}.`,
    `Return occasions as an array (0-3) from: ${OCCASIONS.join(", ")}.`,
        `Return seasons as an array from: ${SEASONS.join(", ")}. NEVER combine "All Seasons" with a specific season in the same answer — pick either "All Seasons" alone, or 1-3 specific seasons, never both. Reason from the garment's material, coverage and weight rather than guessing: heavy insulating materials (Wool, Cashmere, Shearling, Down, Alpaca, thick fleece) or covering outerwear (coats, heavy jackets, boots) → Autumn/Winter; lightweight breathable materials (Linen, thin Cotton, thin Viscose) or minimal-coverage pieces (shorts, tank tops, sandals, swimwear) → Spring/Summer. Reserve "All Seasons" for genuinely versatile mid-weight basics with no strong material or coverage signal pointing to a specific time of year (e.g. plain cotton t-shirt, straight jeans, a simple leather bag, classic sneakers) — it is not a fallback for uncertainty, and most garments should get a specific 1-2 season pick rather than "All Seasons".`,
        `Return materials as an array (1-2) from: ${MATERIALS.join(", ")}. Always give your best guess — materials power season matching and outfit suggestions, and the user can correct them before saving. Combine visible texture cues (sheen, weave, grain, knit stitches) with what this garment type is typically made of (t-shirts and shirts → Cotton; jeans and denim jackets → Denim; tailored blazers and coats → Wool, Polyester or Viscose; flowing dresses and blouses → Viscose, Silk, Linen or Polyester; chunky sweaters → Wool, Cashmere, Merino or Acrylic depending on visible fiber thickness and sheen; sporty/technical pieces → Polyester, Polyamide or Elastane; boots and belts → Leather or Suede; watches, jewelry and metal hardware → Metal, Steel, Gold, Silver or Pearl). "Knit" describes a construction technique, not a fiber — never return it as a material even if the garment is visibly knitted; name the actual fiber instead. Return an empty array only if the item is genuinely impossible to assess (e.g. heavily obscured or not a garment).`,

    "Return brand ONLY if a clearly visible logo/label is present in the image; otherwise return an empty string. Never guess a brand.",
    "",
    "SEPARATE ATTRIBUTES — these are independent fields, never folded into subcategory. Only fill in an attribute if it genuinely applies to this category (see rules below); otherwise return an empty string for it:",
    `- length: this is CATEGORY-DEPENDENT, use the matching value set only — Dresses: ${LENGTH_OPTIONS_BY_CATEGORY.Dresses.join("/")}; Outerwear: ${LENGTH_OPTIONS_BY_CATEGORY.Outerwear.join("/")}; Tops: ${LENGTH_OPTIONS_BY_CATEGORY.Tops.join("/")}; Bottoms: ONLY when subcategory is "Skirt", use Mini/Midi/Maxi (leave empty for Jeans/Trousers/Shorts/etc.). For any other category, leave length empty.`,
    `- sleeveLength (applies to: ${ATTRIBUTE_APPLICABILITY.sleeveLength.join(", ")}): EXACTLY one of ${SLEEVE_LENGTH_OPTIONS.join(", ")}.`,
    `- fit (applies to: ${ATTRIBUTE_APPLICABILITY.fit.join(", ")}): EXACTLY one of ${FIT_OPTIONS.join(", ")}.`,
    `- heelHeight (applies to: ${ATTRIBUTE_APPLICABILITY.heelHeight.join(", ")} only): EXACTLY one of ${HEEL_HEIGHT_OPTIONS.join(", ")}.`,
    `- toeShape (applies to: ${ATTRIBUTE_APPLICABILITY.toeShape.join(", ")} only): EXACTLY one of ${TOE_SHAPE_OPTIONS.join(", ")}.`,
    `- closure (applies to: ${ATTRIBUTE_APPLICABILITY.closure.join(", ")}): EXACTLY one of ${CLOSURE_OPTIONS.join(", ")}.`,
    `- gender: EXACTLY one of ${GENDER_OPTIONS.join(", ")}. Only guess Woman or Man if the cut/design is unambiguously gendered (e.g. a bra, boxers); otherwise return "Unisex".`,
    `- styleTags (array, 1-4 items): pick from ${STYLE_TAG_OPTIONS.join(", ")}. These are free-form aesthetic labels for future style matching — be generous but accurate.`,
    "If a field cannot be determined confidently, or does not apply to this category, return an empty array or empty string for it.",
    "",
    "- formality: an integer 1-5, purely about how dressed-up this specific piece reads, independent of season/color: 1 = very casual/sport (activewear, flip-flops, gym leggings); 2 = casual (jeans, everyday t-shirts, lifestyle sneakers, casual sweaters); 3 = smart casual (casual blazers, loafers, non-formal tailored trousers, structured casual bags); 4 = elegant (tailored blazers, slingbacks, refined sandals, elegant bags); 5 = formal/very elegant (evening dresses, cocktail dresses, clutches, evening shoes, tuxedo-type formalwear). Always give your best estimate — never leave this out.",
    "- dayEvening: EXACTLY one of day, evening, both — whether this piece reads as appropriate for daytime, nighttime, or either. Most everyday pieces are \"both\"; reserve \"evening\" for pieces that read as distinctly after-dark (sequins, evening satin, tuxedo-type pieces) and \"day\" only for pieces that would look out of place at night (e.g. very sporty daywear).",
    "",
    "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
    '{"category": "", "subcategory": "", "colors": [], "styles": [], "occasions": [], "seasons": [], "brand": "", "materials": [], "length": "", "sleeveLength": "", "fit": "", "heelHeight": "", "toeShape": "", "closure": "", "gender": "", "styleTags": [], "formality": 3, "dayEvening": "both"}',
  ].join(" ");

  try {
    const call = () => generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: systemPrompt },
            { type: "image", image: imageDataUrl },
          ],
        },
      ],
    });

    let text: string;
    try {
      text = (await call()).text;
    } catch (err) {
      console.error("[AURA analyze] first call failed", err);
      text = "";
    }

    let output: z.infer<typeof OutputSchema>;
    try {
      output = parseAiJson(text, OutputSchema);
    } catch {
      const r2 = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: systemPrompt },
              { type: "image", image: imageDataUrl },
            ],
          },
          { role: "assistant", content: text || "(no response)" },
          {
            role: "user",
            content: "That was not a single valid JSON object matching the required shape. Reply again with ONLY the JSON object, nothing else.",
          },
        ],
      });
      output = parseAiJson(r2.text, OutputSchema);
    }

    const allowed = <T extends readonly string[]>(arr: string[], set: T) =>
      arr.filter(v => (set as readonly string[]).includes(v));
    const single = <T extends readonly string[]>(v: string, set: T) =>
      (set as readonly string[]).includes(v) ? v : "";

    const category = (CATEGORIES as readonly string[]).includes(output.category) ? output.category : "";
    const validSubcats = category ? (SUBCATEGORY_OPTIONS[category] ?? []) : ALL_SUBCATEGORIES;
    const subcategory = validSubcats.includes(output.subcategory) ? output.subcategory : "";
    const validLengths = lengthOptionsFor(category, subcategory);

    return {
          const rawSeasons = allowed(output.seasons, SEASONS);
    // Safety net for the mutual-exclusivity rule above: if the model
    // still returns both "All Seasons" and a specific season despite the
    // instruction, the specific ones carry more information and win.
    const seasons = rawSeasons.length > 1 && rawSeasons.includes("All Seasons")
      ? rawSeasons.filter((s) => s !== "All Seasons")
      : rawSeasons;

    return {
      category,
      subcategory,
      colors: output.colors.filter(c => COLOR_NAMES.includes(c)),
      styles: allowed(output.styles, STYLES),
      occasions: allowed(output.occasions, OCCASIONS),
      seasons,
      brand: output.brand?.trim() ?? "",
      materials: allowed(output.materials, MATERIALS),
      length: validLengths.length ? single(output.length, validLengths as readonly string[]) : "",
      sleeveLength: ATTRIBUTE_APPLICABILITY.sleeveLength.includes(category) ? single(output.sleeveLength, SLEEVE_LENGTH_OPTIONS) : "",

      fit: ATTRIBUTE_APPLICABILITY.fit.includes(category) ? single(output.fit, FIT_OPTIONS) : "",
      heelHeight: ATTRIBUTE_APPLICABILITY.heelHeight.includes(category) ? single(output.heelHeight, HEEL_HEIGHT_OPTIONS) : "",
      toeShape: ATTRIBUTE_APPLICABILITY.toeShape.includes(category) ? single(output.toeShape, TOE_SHAPE_OPTIONS) : "",
      closure: ATTRIBUTE_APPLICABILITY.closure.includes(category) ? single(output.closure, CLOSURE_OPTIONS) : "",
      gender: single(output.gender, GENDER_OPTIONS),
      styleTags: allowed(output.styleTags, STYLE_TAG_OPTIONS).slice(0, 4),
      formality: Number.isFinite(output.formality) ? Math.min(5, Math.max(1, Math.round(output.formality))) : null,
      dayEvening: (["day", "evening", "both"] as const).includes(output.dayEvening as never) ? output.dayEvening : "",
    };
  } catch (err) {
    console.error("[AURA analyze] failed", err);
    return buildFallback();
  }
}

/** RPC autenticata, invariata per chi la chiama (AddItem.tsx) — ora è solo un sottile involucro attorno alla logica pura sopra. */
export const analyzeWardrobeImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => analyzeWardrobeImageCore(data.imageDataUrl));
