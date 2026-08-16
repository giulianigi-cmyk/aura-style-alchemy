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

    "Return brand if you can identify the commercial brand with confidence, for ANY brand — not just well-known luxury houses, and not limited to the kind of mark shown in any example below. Two independent signals count, and a single garment may show either or both: (1) readable brand text/wordmark printed on a label, hangtag, woven tag or the garment itself; (2) a graphic/symbolic logo you recognize even without text — an animal, a geometric shape, a monogram, an abstract mark, a stitched emblem, or any other symbol a fashion brand uses as its mark. Some brands print their name as plain text, some use only a symbol, and some (like Patrizia Pepe, whose label often shows just a stylized bee) use a symbol as their primary mark with the name only elsewhere — treat these as equally valid identification paths, not a hierarchy. Look closely at every logo/mark in the image before deciding it's unidentifiable — a small monogram or symbol on a label is very often a recognizable brand mark, not decoration. Only return an empty string if you genuinely don't recognize the brand from either signal; never guess or invent a brand name you're not confident about, and never confuse a manufacturer/company name (see detectedManufacturer below) for the brand — a manufacturer name printed in plain text on a label is a DIFFERENT thing from the brand's logo, even when the manufacturer name is the only text visible.",
    "",
    "LABEL / TAG TEXT — the photo may show a garment's care label or hang tag instead of (or in addition to) the garment itself. If ANY printed text is visible on a label or tag, read it carefully and extract:",
    "- detectedProductCode: any article number, style code, product code, model code or reference number printed on the label (e.g. \"800005 D001\"). Copy it EXACTLY as printed, including spaces — this is used as a search key, so accuracy matters more than tidiness. Return an empty string if no such code is visible.",
    "- detectedManufacturer: the manufacturer/company name printed on the label if present (e.g. \"Tessilform S.p.A.\"), which is often DIFFERENT from the commercial brand (e.g. a logo like a stylized animal or symbol) — never assume the manufacturer name IS the brand, and never assume the brand is unknown just because only a manufacturer name is printed. Return an empty string if no manufacturer/company name is visible.",
    "These two fields are read literally from visible text — never invent or infer them from general knowledge of the category.",
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
    "- formality: an integer 1-5, purely about how dressed-up this specific piece reads, independent of season/color: 1 = very casual/sport (activewear, flip-flops, gym leggings, and ALWAYS running/training/performance shoes — subcategory \"Running Shoes\" is formality 1, full stop, regardless of colorway or brand); 2 = casual (jeans, everyday t-shirts, lifestyle sneakers — subcategory \"Sneakers\" only, never \"Running Shoes\" — casual sweaters); 3 = smart casual (casual blazers, loafers, non-formal tailored trousers, structured casual bags); 4 = elegant (tailored blazers, slingbacks, refined sandals, elegant bags); 5 = formal/very elegant (evening dresses, cocktail dresses, clutches, evening shoes, tuxedo-type formalwear). Always give your best estimate — never leave this out.",
    "- dayEvening: EXACTLY one of day, evening, both — whether this piece reads as appropriate for daytime, nighttime, or either. Most everyday pieces are \"both\"; reserve \"evening\" for pieces that read as distinctly after-dark (sequins, evening satin, tuxedo-type pieces) and \"day\" only for pieces that would look out of place at night (e.g. very sporty daywear).",
    "",
    "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
    '{"category": "", "subcategory": "", "colors": [], "styles": [], "occasions": [], "seasons": [], "brand": "", "materials": [], "length": "", "sleeveLength": "", "fit": "", "heelHeight": "", "toeShape": "", "closure": "", "gender": "", "styleTags": [], "formality": 3, "dayEvening": "both", "detectedProductCode": "", "detectedManufacturer": ""}',
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
      detectedProductCode: output.detectedProductCode?.trim() ?? "",
      detectedManufacturer: output.detectedManufacturer?.trim() ?? "",
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
