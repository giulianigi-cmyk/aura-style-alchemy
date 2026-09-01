import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText } from "ai";
import { parseAiJson } from "./ai-json";
import { resolveProductImageUrl } from "./import-url.functions";
import { analyzeWardrobeImageCore } from "./ai-analyze.functions";
import { findBestMatch } from "./outfit-dedupe";
import { isItemAllowedByDressPreferences, hasAnyPreference, type DressPreferences } from "./dress-preferences";
import { COLOR_PALETTE } from "./color-palette";
import type { WardrobeItem } from "./aura-types";

// ============================================================================
// Purchase Advisor — "Should I buy this?"
//
// Deliberately isolated from every other module: it only ever READS from
// resolveProductImageUrl, analyzeWardrobeImageCore, findBestMatch and the
// dress-preferences helpers, never modifies them. Anything specific to
// this feature (label OCR, pairing/gap heuristics) lives entirely in this
// file so nothing else in the app can be affected by it.
// ============================================================================

const InputSchema = z.discriminatedUnion("source", [
  // accessToken is needed for the same reason it's needed in the plain
  // AddItem → paste-link flow: Firecrawl's per-user daily credit count
  // (see consumeFirecrawlCredit) is tracked against the signed-in user,
  // and the auth middleware here only exposes a Supabase client + userId
  // to the handler, never the raw bearer token — the client has to pass
  // it through explicitly, same as importProductFromUrl already does.
  z.object({ source: z.literal("url"), url: z.string().min(1), accessToken: z.string().optional() }),
  z.object({ source: z.literal("photo"), imageDataUrl: z.string().min(1) }),
  z.object({ source: z.literal("label"), imageDataUrl: z.string().min(1) }),
  z.object({ source: z.literal("photos"), garmentImageDataUrl: z.string().min(1), labelImageDataUrl: z.string().min(1) }),
]);

type PurchaseProduct = {
  title: string | null;
  brand: string | null;
  price: string | null;
  currency: string | null;
  imageUrl: string | null;
  category: string | null;
  subcategory: string | null;
  colors: string[];
  material: string | null;
  length: string | null;
  sleeveLength: string | null;
  fit: string | null;
  styleTags: string[];
};

export type PurchaseAdvisorResult =
  | {
      ok: true;
      verdict: "buy" | "maybe" | "skip";
      reason: string;
      confidence: "high" | "medium" | "low";
      product: {
        title: string | null;
        brand: string | null;
        price: string | null;
        currency: string | null;
        imageUrl: string | null;
      };
      analysis: {
        category: string | null;
        subcategory: string | null;
        colors: string[];
        material: string | null;
      };
      wardrobe: {
        duplicate: { verdict: "certain" | "maybe"; itemId: string } | null;
        similarItemsCount: number;
        pairsWithCount: number;
        wardrobeGap: boolean;
      };
      rules: {
        dressPreferenceViolation: boolean;
      };
    }
  | { ok: false; error: string };

// ---- Label OCR/vision — new, self-contained, no shared file touched ----

const LabelSchema = z.object({
  brand: z.string().nullable(),
  productName: z.string().nullable(),
  material: z.string().nullable(),
  productCode: z.string().nullable(),
  size: z.string().nullable(),
  price: z.string().nullable(),
  currency: z.string().nullable(),
});
type LabelAnalysis = z.infer<typeof LabelSchema>;
const EMPTY_LABEL: LabelAnalysis = { brand: null, productName: null, material: null, productCode: null, size: null, price: null, currency: null };

async function analyzeLabelImage(imageDataUrl: string, model: Parameters<typeof generateText>[0]["model"]): Promise<LabelAnalysis> {
  const system = [
    "You read a photo of a garment's care label or hang tag. Extract ONLY what is actually printed and legible on it — never guess, infer, or fill in a plausible-sounding value that isn't visibly there.",
    "Fields: brand (commercial brand name/logo, if legible), productName (product/style name if printed), material (fabric composition as printed, e.g. \"100% Cotton\"), productCode (article/style/SKU code, copied exactly as printed), size (as printed, e.g. \"M\" or \"40\"), price (the numeric price as printed), currency (the currency symbol or code next to the price, e.g. EUR, USD, €, $).",
    "Every field MUST be null if it is not clearly legible in the photo.",
    "Respond with ONLY a single valid JSON object, no markdown fences, no extra text:",
    '{"brand": null, "productName": null, "material": null, "productCode": null, "size": null, "price": null, "currency": null}',
  ].join("\n");

  const callOnce = () => generateText({
    model,
    messages: [{ role: "user", content: [{ type: "text", text: system }, { type: "image", image: imageDataUrl }] }],
  });

  let text = "";
  try { text = (await callOnce()).text; } catch (e) { console.error("[AURA purchase-advisor] label call failed", e); }

  try {
    return parseAiJson(text, LabelSchema);
  } catch {
    try {
      const r2 = await generateText({
        model,
        messages: [
          { role: "user", content: [{ type: "text", text: system }, { type: "image", image: imageDataUrl }] },
          { role: "assistant", content: text || "(no response)" },
          { role: "user", content: "That was not a single valid JSON object. Reply again with ONLY the JSON object." },
        ],
      });
      return parseAiJson(r2.text, LabelSchema);
    } catch (e) {
      console.error("[AURA purchase-advisor] label retry failed", e);
      return EMPTY_LABEL;
    }
  }
}

// ---- Pairing heuristic — same neutral-aware idea already used (and
// recently fixed) in wardrobe-gap.functions.ts, kept as a small local
// copy per the isolation rule rather than touching that file. ----

const NEUTRAL_FAMILIES = new Set(["Whites", "Blacks & Greys", "Beiges"]);
const colorFamily = (name: string): string | undefined => COLOR_PALETTE.find((c) => c.name === name)?.family;
const isNeutralColor = (name: string): boolean => {
  const f = colorFamily(name);
  return f ? NEUTRAL_FAMILIES.has(f) : false;
};
const PAIRING_WHITELIST: Record<string, string[]> = {
  Tops: ["Bottoms", "Outerwear", "Shoes", "Bags", "Accessories"],
  Bottoms: ["Tops", "Outerwear", "Shoes", "Bags", "Accessories"],
  Dresses: ["Outerwear", "Shoes", "Bags", "Accessories"],
  Jumpsuits: ["Outerwear", "Shoes", "Bags", "Accessories"],
  Outerwear: ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Shoes", "Bags"],
  Shoes: ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Outerwear", "Bags"],
  Bags: ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Outerwear", "Shoes"],
  Accessories: ["Tops", "Bottoms", "Dresses", "Jumpsuits", "Outerwear"],
};

function countPairings(category: string, colors: string[], wardrobe: WardrobeItem[]): number {
  const whitelist = new Set(PAIRING_WHITELIST[category] ?? []);
  if (whitelist.size === 0) return 0;
  const productIsNeutral = colors.length === 0 || colors.every(isNeutralColor);
  let count = 0;
  for (const it of wardrobe) {
    if (!it.category || !whitelist.has(it.category)) continue;
    const itColors = it.colors ?? [];
    const exactMatch = itColors.some((c) => colors.includes(c));
    const eitherNeutral = productIsNeutral || itColors.some(isNeutralColor);
    if (exactMatch || eitherNeutral) count++;
  }
  return count;
}

const LANGUAGE_NAMES: Record<string, string> = { it: "Italian", en: "English", es: "Spanish", fr: "French" };
const FALLBACK_REASON: Record<string, string> = {
  it: "Impossibile generare la spiegazione completa, ma l'analisi del guardaroba è comunque completa.",
  en: "Couldn't generate the full explanation, but the wardrobe analysis is complete.",
  es: "No se pudo generar la explicación completa, pero el análisis del armario está completo.",
  fr: "Impossible de générer l'explication complète, mais l'analyse de la garde-robe est terminée.",
};

/** Downloads a remote image and returns it as a data URL, for feeding
 *  into the vision model — used only for the URL input mode, where the
 *  photo comes from resolveProductImageUrl rather than an upload. */
async function fetchAsDataUrl(imageUrl: string): Promise<string> {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`image fetch ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  return `data:${contentType};base64,${Buffer.from(buf).toString("base64")}`;
}

/**
 * "Should I buy this?" across four input modes (URL / photo / label /
 * photo+label). The verdict is 100% deterministic, computed in code from
 * real wardrobe facts (duplicate check, dress-preference hard rule,
 * pairing count, wardrobe gap) BEFORE any AI call — the AI is only ever
 * asked to phrase the 1-2 sentence reason for a decision that has
 * already been made, and is explicitly told not to change it. This
 * mirrors the same "hard rules first, AI explains, never overrides"
 * principle already used everywhere else in the outfit engine.
 */
export const analyzePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<PurchaseAdvisorResult> => {
    const { supabase, userId } = context;

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const product: PurchaseProduct = {
      title: null, brand: null, price: null, currency: null, imageUrl: null,
      category: null, subcategory: null, colors: [], material: null,
      length: null, sleeveLength: null, fit: null, styleTags: [],
    };

    // ---- 1. Gather product facts, depending on input mode ----
    if (data.source === "url") {
      let target: URL;
      try { target = new URL(data.url.startsWith("http") ? data.url : `https://${data.url}`); }
      catch { return { ok: false, error: "Invalid link." }; }

      const resolved = await resolveProductImageUrl(target.toString(), data.accessToken);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error || "Couldn't read this product page." };
      }
      product.title = resolved.title || null;
      product.brand = resolved.brand || null;
      product.price = resolved.price ?? null;
      product.currency = resolved.priceCurrency ?? null;
      product.imageUrl = resolved.imageUrl;

      if (resolved.imageUrl) {
        try {
          const imageDataUrl = await fetchAsDataUrl(resolved.imageUrl);
          const garment = await analyzeWardrobeImageCore(imageDataUrl);
          product.category = garment.category || null;
          product.subcategory = garment.subcategory || null;
          product.colors = garment.colors ?? [];
          product.material = garment.materials?.[0] ?? null;
          product.length = garment.length || null;
          product.sleeveLength = garment.sleeveLength || null;
          product.fit = garment.fit || null;
          product.styleTags = garment.styleTags ?? [];
          if (!product.brand && garment.brand) product.brand = garment.brand;
        } catch (e) {
          // Text-only facts from the page are still usable even if the
          // photo itself couldn't be downloaded or analyzed.
          console.error("[AURA purchase-advisor] url image analysis failed", e);
        }
      }
    } else if (data.source === "photo") {
      product.imageUrl = data.imageDataUrl;
      const garment = await analyzeWardrobeImageCore(data.imageDataUrl);
      product.category = garment.category || null;
      product.subcategory = garment.subcategory || null;
      product.colors = garment.colors ?? [];
      product.material = garment.materials?.[0] ?? null;
      product.length = garment.length || null;
      product.sleeveLength = garment.sleeveLength || null;
      product.fit = garment.fit || null;
      product.styleTags = garment.styleTags ?? [];
      product.brand = garment.brand || null;
    } else if (data.source === "label") {
      const label = await analyzeLabelImage(data.imageDataUrl, model);
      product.brand = label.brand;
      product.title = label.productName;
      product.material = label.material;
      product.price = label.price;
      product.currency = label.currency;
      // category / colors / shape are unknowable from a label alone —
      // left null rather than guessed, per the "never invent" rule.
    } else {
      const [garment, label] = await Promise.all([
        analyzeWardrobeImageCore(data.garmentImageDataUrl),
        analyzeLabelImage(data.labelImageDataUrl, model),
      ]);
      product.imageUrl = data.garmentImageDataUrl;
      product.category = garment.category || null;
      product.subcategory = garment.subcategory || null;
      product.colors = garment.colors ?? [];
      product.length = garment.length || null;
      product.sleeveLength = garment.sleeveLength || null;
      product.fit = garment.fit || null;
      product.styleTags = garment.styleTags ?? [];
      // The label wins for printed-text fields when it has an answer —
      // more reliable there than reading small print off a garment photo.
      product.brand = label.brand || garment.brand || null;
      product.title = label.productName || null;
      product.material = label.material || garment.materials?.[0] || null;
      product.price = label.price;
      product.currency = label.currency;
    }

    // ---- 2. Wardrobe facts ----
    const { data: wardrobeRaw } = await supabase.from("wardrobe_items").select("*").eq("user_id", userId);
    const wardrobe = (wardrobeRaw ?? []) as WardrobeItem[];

    const duplicate = product.category
      ? (() => {
          const d = findBestMatch(
            { category: product.category!, subcategory: product.subcategory ?? undefined, colors: product.colors, brand: product.brand },
            wardrobe,
          );
          return d.verdict === "new" ? null : { verdict: d.verdict as "certain" | "maybe", itemId: d.match!.id };
        })()
      : null;

    const similarItemsCount = product.category
      ? wardrobe.filter((it) => it.category === product.category && (!product.subcategory || it.subcategory === product.subcategory)).length
      : 0;

    // "Does this fill a real gap?" — same spirit as the wardrobe-gap
    // suggestion: zero comparable pieces owned reads as a genuine gap;
    // several near-identical pieces already owned does not, regardless
    // of how nice the new one looks.
    const wardrobeGap = product.category ? similarItemsCount === 0 : false;

    const pairsWithCount = product.category ? countPairings(product.category, product.colors, wardrobe) : 0;

    // ---- 3. Dress preferences — hard rule, same as the outfit engine ----
    const { data: profileRow } = await (supabase.from("profiles" as never) as any)
      .select("dress_preferences, language, season, undertone")
      .eq("id", userId).maybeSingle();
    const profile = profileRow as { dress_preferences?: DressPreferences; language?: string | null; season?: string | null; undertone?: string | null } | null;
    const dressPrefs = profile?.dress_preferences ?? null;
    const dressViolation = hasAnyPreference(dressPrefs) && product.category
      ? !isItemAllowedByDressPreferences(
          { category: product.category, subcategory: product.subcategory, length: product.length, sleeveLength: product.sleeveLength, fit: product.fit, styleTags: product.styleTags },
          dressPrefs,
        )
      : false;

    // ---- 4. Deterministic verdict — the AI never decides this part ----
    let verdict: "buy" | "maybe" | "skip";
    let confidence: "high" | "medium" | "low";

    if (dressViolation) {
      verdict = "skip"; confidence = "high";
    } else if (!product.category) {
      // Not enough to reason about (e.g. label-only, or vision genuinely
      // couldn't classify the piece) — never fake certainty.
      verdict = "maybe"; confidence = "low";
    } else if (duplicate?.verdict === "certain") {
      verdict = "skip"; confidence = "medium";
    } else if (!duplicate && pairsWithCount >= 3 && wardrobeGap) {
      verdict = "buy"; confidence = "high";
    } else if (!duplicate && pairsWithCount >= 3) {
      verdict = "buy"; confidence = wardrobe.length > 0 ? "medium" : "low";
    } else {
      verdict = "maybe";
      confidence = pairsWithCount > 0 ? "medium" : "low";
    }
    // A label photo alone never supports a confident visual verdict,
    // whatever the heuristics above computed from the (mostly null)
    // product shape.
    if (data.source === "label" && confidence === "high") confidence = "medium";

    const base = {
      product: { title: product.title, brand: product.brand, price: product.price, currency: product.currency, imageUrl: product.imageUrl },
      analysis: { category: product.category, subcategory: product.subcategory, colors: product.colors, material: product.material },
      wardrobe: { duplicate, similarItemsCount, pairsWithCount, wardrobeGap },
      rules: { dressPreferenceViolation: dressViolation },
    };

    // ---- 5. AI writes ONLY the reason for the already-decided verdict ----
    const langName = LANGUAGE_NAMES[profile?.language ?? "en"] ?? "English";
    const system = [
      "You write a short, natural 1-2 sentence explanation for a wardrobe purchase decision that has ALREADY been made. You do not choose or change the verdict — only explain it, using ONLY the facts listed below. Never invent facts, prices, qualities, or wardrobe details not listed. Never soften, contradict, or second-guess the decision.",
      `Respond in ${langName}.`,
      `Decision already made: ${verdict.toUpperCase()}.`,
      "Facts:",
      `- Product: ${product.category ?? "unknown category"}${product.subcategory ? " / " + product.subcategory : ""}, colors: ${product.colors.join(", ") || "unclear"}, brand: ${product.brand || "unknown"}, price: ${product.price ?? "unknown"}.`,
      duplicate?.verdict === "certain"
        ? "- Near-duplicate of something already owned."
        : duplicate?.verdict === "maybe"
        ? "- Similar to something already owned, not a certain duplicate."
        : "- Nothing similar already owned.",
      `- Would pair with about ${pairsWithCount} piece(s) already owned.`,
      wardrobeGap ? "- Fills a real gap: nothing comparable owned yet." : "- Not a gap: comparable pieces already owned.",
      dressViolation ? "- Conflicts with a stated dress preference — this is why it's a skip." : "",
      profile?.season ? `- Estimated color season: ${profile.season}${profile.undertone ? ` (${profile.undertone})` : ""} — soft note only, never a reason on its own.` : "",
      "Respond with ONLY a single valid JSON object, no markdown fences:",
      '{"reason": ""}',
    ].filter(Boolean).join("\n");

    let reason: string;
    try {
      const r1 = await generateText({ model, system, messages: [{ role: "user", content: "Write the reason." }] });
      const parsed = parseAiJson(r1.text, z.object({ reason: z.string() }));
      reason = parsed.reason.slice(0, 300);
    } catch (e) {
      console.error("[AURA purchase-advisor] reason generation failed", e);
      reason = FALLBACK_REASON[profile?.language ?? "en"] ?? FALLBACK_REASON.en;
    }

    return { ok: true as const, verdict, confidence, reason, ...base };
  });
