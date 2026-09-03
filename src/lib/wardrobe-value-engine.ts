// AURA — Wardrobe Value Engine (v3)
//
// Implementa lo pseudocodice approvato in
// docs/features/wardrobe-value-engine-calibration.md. Punti fermi:
//
// 1. MODEL ha priorità su BRAND_CATEGORY — mai stacking brand×model×materiale.
//    A livello MODEL/MODEL_CALIBRATION si usa SOLO la curva del profilo
//    modello; brand e materiale sono già impliciti nel dato di mercato.
// 2. Il ceiling della curva è 1.0 ovunque tranne che a livello MODEL, dove
//    può superare 1.0 SOLO se il profilo lo dichiara esplicitamente con
//    evidence_tier='market_evidence' e una fonte diretta.
// 3. Il current retail è anchor SOLO se current_retail_source è tra le
//    fonti anchor-eligible (tier A/B) — mai un retail non verificato.
// 4. data_confidence (completezza dei dati) e valuation_confidence
//    (affidabilità della stima) sono due dimensioni SEPARATE — la seconda
//    è quella mostrata come "confidence" principale in UI.
// 5. Plausibility: se l'anchor è current_retail e non siamo in un caso di
//    market_premium sourced, resale_high non supera mai l'anchor.
//
// Pure/testabile senza DB — fetchValuationConfig() è l'unica funzione che
// tocca Supabase, in fondo al file.

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Iconicity = "iconic" | "timeless" | "classic" | "seasonal" | "trend_driven" | "basic";
export type Confidence = "low" | "medium" | "high";
export type Evidence = "derived" | "assumption";
export type EvidenceTier = "market_evidence" | "calibration";
export type CurrentRetailSource = "user" | "ai_lookup_verified" | "ai_lookup_unverified" | "product_link";

export type ValuationLevel =
  | "model_market_evidence"
  | "model_calibration"
  | "brand_category"
  | "category_subcategory"
  | "category"
  | "generic_fallback"
  | "none";

const ANCHOR_ELIGIBLE_SOURCES: ReadonlySet<CurrentRetailSource> = new Set(["user", "ai_lookup_verified"]);

export interface CategoryProfile {
  category: string;
  subcategory: string | null;
  floor: number;
  tau_years: number;
  wear_expected_life_wears: number;
  wear_max_penalty: number;
  default_iconicity: Iconicity | null; // descrittivo — non entra nella formula
  evidence_floor: Evidence;
}

export interface BrandModifier {
  brand: string;
  category: string;
  subcategory: string | null;
  modifier: number;
  evidence: Evidence;
}

export interface MaterialModifier {
  material: string;
  modifier: number; // evidence sempre 'assumption'
}

export interface ModelProfile {
  brand: string;
  model: string;
  category: string;
  subcategory: string | null;
  floor: number;
  ceiling: number; // >1.0 solo se evidence_tier === 'market_evidence'
  tau_years: number;
  wear_expected_life_wears: number;
  wear_max_penalty: number;
  evidence_tier: EvidenceTier;
}

export interface SizeModifier {
  category: string;
  size_class: string;
  modifier: number;
}

export interface ValuationConfig {
  categoryProfiles: CategoryProfile[];
  brandModifiers: BrandModifier[];
  materialModifiers: MaterialModifier[];
  modelProfiles: ModelProfile[];
  sizeModifiers: SizeModifier[];
}

export interface ValuationInput {
  price: number | null; // purchase price
  currentRetailPrice?: number | null;
  currentRetailSource?: CurrentRetailSource | null;
  historicalRetailPrice?: number | null; // solo narrativo
  purchaseDate?: string | null; // ISO date
  wornCount?: number | null;
  brand?: string | null;
  category?: string | null;
  subcategory?: string | null;
  materials?: string[] | null;
  model?: string | null;
  bagSizeClass?: string | null; // solo per category === 'Bags'
  iconicity?: Iconicity | null; // descrittivo — non entra nella formula
  now?: Date; // injectable per i test
}

export interface ValuationResult {
  level: ValuationLevel;
  dataConfidence: Confidence | null;
  valuationConfidence: Confidence | null;
  anchorType: "current_retail" | "purchase_price" | null;
  anchorValue: number | null;
  calendarAgeYears: number | null;
  marketCurveValue: number | null;
  marketValueFactor: number | null;
  wearConditionFactor: number | null;
  retentionFactor: number | null;
  resaleLow: number | null;
  resaleHigh: number | null;
  marketPremium: boolean; // resale sopra il current retail, sourced esplicitamente
  purchasePrice: number | null;
  currentRetailPrice: number | null;
  historicalRetailPrice: number | null;
  costPerWear: number | null;
  retailAppreciation: { amount: number; pct: number } | null;
  retailChangeVsPurchase: { amount: number; pct: number } | null;
  resaleChangeVsPurchase: { amount: number; pct: number } | null;
  breakdown: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Generic fallback — la vecchia regola -25%/5yr, mai cancellata.
// ---------------------------------------------------------------------------

export const GENERIC_FALLBACK_FLOOR = 0.25;
export const GENERIC_FALLBACK_CLIFF_YEARS = 5;

export function genericFallbackRetention(ageYears: number): number {
  const t = Math.min(Math.max(ageYears, 0), GENERIC_FALLBACK_CLIFF_YEARS) / GENERIC_FALLBACK_CLIFF_YEARS;
  return 1 - (1 - GENERIC_FALLBACK_FLOOR) * t;
}

const MAX_CALENDAR_AGE_YEARS = 50;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

function findModelProfile(config: ValuationConfig, brand: string | null | undefined, model: string | null | undefined): ModelProfile | null {
  if (!brand || !model) return null;
  const b = brand.trim().toLowerCase();
  const m = model.trim().toLowerCase();
  return config.modelProfiles.find((p) => p.brand.trim().toLowerCase() === b && p.model.trim().toLowerCase() === m) ?? null;
}

function findCategoryProfile(
  config: ValuationConfig,
  category: string | null | undefined,
  subcategory: string | null | undefined
): { profile: CategoryProfile; matchedBy: "subcategory" | "category" } | null {
  if (!category) return null;
  const cat = category.trim().toLowerCase();
  const sub = subcategory?.trim().toLowerCase() ?? null;
  if (sub) {
    const exact = config.categoryProfiles.find((p) => p.category.trim().toLowerCase() === cat && p.subcategory?.trim().toLowerCase() === sub);
    if (exact) return { profile: exact, matchedBy: "subcategory" };
  }
  const fallback = config.categoryProfiles.find((p) => p.category.trim().toLowerCase() === cat && p.subcategory == null);
  return fallback ? { profile: fallback, matchedBy: "category" } : null;
}

function findBrandModifier(
  config: ValuationConfig,
  brand: string | null | undefined,
  category: string | null | undefined,
  subcategory: string | null | undefined
): { modifier: number; matched: boolean; evidence: Evidence | null } {
  if (!brand || !category) return { modifier: 1, matched: false, evidence: null };
  const b = brand.trim().toLowerCase();
  const c = category.trim().toLowerCase();
  const s = subcategory?.trim().toLowerCase() ?? null;
  if (s) {
    const exact = config.brandModifiers.find((m) => m.brand.trim().toLowerCase() === b && m.category.trim().toLowerCase() === c && m.subcategory?.trim().toLowerCase() === s);
    if (exact) return { modifier: exact.modifier, matched: true, evidence: exact.evidence };
  }
  const catOnly = config.brandModifiers.find((m) => m.brand.trim().toLowerCase() === b && m.category.trim().toLowerCase() === c && m.subcategory == null);
  if (catOnly) return { modifier: catOnly.modifier, matched: true, evidence: catOnly.evidence };
  return { modifier: 1, matched: false, evidence: null };
}

function findMaterialModifier(config: ValuationConfig, materials: string[] | null | undefined): number {
  const list = materials ?? [];
  const matched = list
    .map((m) => config.materialModifiers.find((mm) => mm.material.trim().toLowerCase() === m.trim().toLowerCase()))
    .filter((m): m is MaterialModifier => Boolean(m));
  if (matched.length === 0) return 1;
  return matched.reduce((s, m) => s + m.modifier, 0) / matched.length;
}

function findSizeModifier(config: ValuationConfig, category: string | null | undefined, sizeClass: string | null | undefined): number {
  if (!category || !sizeClass) return 1;
  const cat = category.trim().toLowerCase();
  const sz = sizeClass.trim().toLowerCase();
  const found = config.sizeModifiers.find((s) => s.category.trim().toLowerCase() === cat && s.size_class.trim().toLowerCase() === sz);
  return found?.modifier ?? 1;
}

// ---------------------------------------------------------------------------
// Confidence — due dimensioni separate, mai "molti campi = high"
// ---------------------------------------------------------------------------

function computeDataConfidence(input: ValuationInput, level: ValuationLevel, anchorType: ValuationResult["anchorType"]): Confidence {
  const hasPrice = input.price != null;
  const hasDate = !!input.purchaseDate;
  const hasBrand = !!input.brand;
  const hasCategoryMatch = level !== "generic_fallback" && level !== "none";
  const isModelLevel = level === "model_market_evidence" || level === "model_calibration";
  const hasModelOrRetail = isModelLevel || anchorType === "current_retail";

  if (hasPrice && hasDate && hasBrand && hasCategoryMatch && hasModelOrRetail) return "high";
  if (hasPrice && hasDate && hasCategoryMatch) return "medium";
  return "low";
}

function computeValuationConfidence(
  level: ValuationLevel,
  evidenceFloor: Evidence | null,
  anchorType: ValuationResult["anchorType"],
  brandMatched: boolean
): Confidence {
  if (level === "model_market_evidence") return "high";
  if (level === "model_calibration") return "medium";
  if (level === "generic_fallback" || level === "category" || level === "none") return "low";

  // level is 'brand_category' o 'category_subcategory'
  const hasAnchorReal = anchorType === "current_retail" || brandMatched;
  if (evidenceFloor === "derived") return hasAnchorReal ? "high" : "medium";
  return hasAnchorReal ? "medium" : "low"; // evidenceFloor === 'assumption'
}

// Spread per categoria — Bags ha uno spread più ampio (variabilità reale
// osservata anche a dati completi: condizione, pelle, hardware) tranne che
// a livello MODEL, dove la precisione del dato di mercato lo restringe.
function confidenceSpread(confidence: Confidence, category: string | null | undefined, level: ValuationLevel): number {
  const isBags = category?.trim().toLowerCase() === "bags";
  const isModelLevel = level === "model_market_evidence" || level === "model_calibration";
  if (isBags) {
    if (isModelLevel) return { high: 0.12, medium: 0.18, low: 0.25 }[confidence];
    return { high: 0.2, medium: 0.22, low: 0.25 }[confidence];
  }
  return { high: 0.08, medium: 0.15, low: 0.25 }[confidence];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeItemValuation(input: ValuationInput, config: ValuationConfig): ValuationResult {
  const now = input.now ?? new Date();
  const purchasePrice = input.price ?? null;
  const currentRetailPrice = input.currentRetailPrice ?? null;
  const currentRetailSource = input.currentRetailSource ?? null;
  const historicalRetailPrice = input.historicalRetailPrice ?? null;
  const wornCount = input.wornCount ?? 0;

  // ---- 1. ANCHOR SELECTION — solo fonti anchor-eligible fanno da anchor ----
  const retailAnchorEligible = currentRetailPrice != null && currentRetailSource != null && ANCHOR_ELIGIBLE_SOURCES.has(currentRetailSource);
  const anchorType: ValuationResult["anchorType"] = retailAnchorEligible ? "current_retail" : purchasePrice != null ? "purchase_price" : null;
  const anchorValue = retailAnchorEligible ? currentRetailPrice : purchasePrice ?? null;

  const costPerWear = purchasePrice != null && wornCount > 0 ? purchasePrice / wornCount : null;

  const retailChangeVsPurchase =
    currentRetailPrice != null && purchasePrice != null
      ? { amount: currentRetailPrice - purchasePrice, pct: purchasePrice !== 0 ? ((currentRetailPrice - purchasePrice) / purchasePrice) * 100 : 0 }
      : null;

  const retailAppreciation =
    currentRetailPrice != null && historicalRetailPrice != null && historicalRetailPrice !== 0
      ? { amount: currentRetailPrice - historicalRetailPrice, pct: ((currentRetailPrice - historicalRetailPrice) / historicalRetailPrice) * 100 }
      : null;

  if (anchorValue == null || !input.purchaseDate) {
    return {
      level: "none",
      dataConfidence: null,
      valuationConfidence: null,
      anchorType,
      anchorValue,
      calendarAgeYears: null,
      marketCurveValue: null,
      marketValueFactor: null,
      wearConditionFactor: null,
      retentionFactor: null,
      resaleLow: null,
      resaleHigh: null,
      marketPremium: false,
      purchasePrice,
      currentRetailPrice,
      historicalRetailPrice,
      costPerWear,
      retailAppreciation,
      retailChangeVsPurchase,
      resaleChangeVsPurchase: null,
      breakdown: { reason: anchorValue == null ? "no_anchor_value" : "no_purchase_date" },
    };
  }

  const purchaseDate = new Date(`${input.purchaseDate}T00:00:00`);
  const rawAgeYears = (now.getTime() - purchaseDate.getTime()) / (365.25 * 24 * 3600 * 1000);
  const calendarAgeYears = Math.min(Math.max(rawAgeYears, 0), MAX_CALENDAR_AGE_YEARS);

  // ---- 2. VALUATION PROFILE SELECTION — gerarchia a 6 livelli ----
  const modelProfile = findModelProfile(config, input.brand, input.model);
  const categoryMatch = findCategoryProfile(config, input.category, input.subcategory);
  const brand = findBrandModifier(config, input.brand, input.category, input.subcategory);

  let level: ValuationLevel;
  let marketCurveValue: number;
  let marketValueFactor: number;
  let wearConditionFactor: number;
  let evidenceFloorForConfidence: Evidence | null = null;
  const breakdown: Record<string, unknown> = { calendarAgeYears };

  if (modelProfile) {
    level = modelProfile.evidence_tier === "market_evidence" ? "model_market_evidence" : "model_calibration";
    marketCurveValue = modelProfile.floor + (modelProfile.ceiling - modelProfile.floor) * Math.exp(-calendarAgeYears / modelProfile.tau_years);
    // Nessun brand/materiale qui — già impliciti nel profilo del modello.
    marketValueFactor = Math.min(Math.max(marketCurveValue, 0.05), 1.5);
    const wearRatio = Math.min(wornCount / modelProfile.wear_expected_life_wears, 1);
    wearConditionFactor = 1 - modelProfile.wear_max_penalty * wearRatio;
    breakdown.model = `${input.brand} ${input.model}`;
    breakdown.evidenceTier = modelProfile.evidence_tier;
    breakdown.modelCeiling = modelProfile.ceiling;
  } else if (categoryMatch) {
    const { profile, matchedBy } = categoryMatch;
    level = brand.matched ? "brand_category" : matchedBy === "subcategory" ? "category_subcategory" : "category";
    evidenceFloorForConfidence = profile.evidence_floor;

    const ceiling = 1.0; // rigido, mai superabile fuori dal livello MODEL
    marketCurveValue = profile.floor + (ceiling - profile.floor) * Math.exp(-calendarAgeYears / profile.tau_years);

    const material = findMaterialModifier(config, input.materials);
    const size = findSizeModifier(config, input.category, input.bagSizeClass);
    const brandMult = brand.matched ? brand.modifier : 1;
    const combined = Math.min(Math.max(brandMult * material * size, 0.6), 1.4);
    marketValueFactor = Math.min(Math.max(marketCurveValue * combined, 0.05), 1.0); // hard ceiling 1.0

    const wearRatio = Math.min(wornCount / profile.wear_expected_life_wears, 1);
    wearConditionFactor = 1 - profile.wear_max_penalty * wearRatio;

    breakdown.evidenceFloor = profile.evidence_floor;
    breakdown.brandModifier = brand.modifier;
    breakdown.brandMatched = brand.matched;
    breakdown.materialModifier = material;
    breakdown.sizeModifier = size;
  } else {
    level = "generic_fallback";
    marketCurveValue = genericFallbackRetention(calendarAgeYears);
    marketValueFactor = marketCurveValue;
    wearConditionFactor = 1; // la regola legacy non considera l'usura
    breakdown.rule = "generic_fallback_-25pct_5yr";
  }

  const retentionFactor = marketValueFactor * wearConditionFactor;
  const resaleCenter = anchorValue * retentionFactor;

  const dataConfidence = computeDataConfidence(input, level, anchorType);
  const valuationConfidence = computeValuationConfidence(level, evidenceFloorForConfidence, anchorType, brand.matched);
  const spread = confidenceSpread(valuationConfidence, input.category, level);

  let resaleLow = resaleCenter * (1 - spread);
  let resaleHigh = resaleCenter * (1 + spread);

  // ---- 7. PLAUSIBILITY CHECK — asimmetrico, solo l'alto è vincolato ----
  let marketPremium = false;
  if (anchorType === "current_retail") {
    const isSourcedPremiumModel = level === "model_market_evidence" && modelProfile != null && modelProfile.ceiling > 1.0;
    if (!isSourcedPremiumModel) {
      resaleHigh = Math.min(resaleHigh, anchorValue);
      resaleLow = Math.min(resaleLow, resaleHigh);
    } else if (resaleCenter > anchorValue) {
      marketPremium = true; // nessun clamp — caso sourced (Prada, Rolex, Birkin/Kelly)
    }
  }

  const resaleChangeVsPurchase =
    purchasePrice != null
      ? { amount: resaleCenter - purchasePrice, pct: purchasePrice !== 0 ? ((resaleCenter - purchasePrice) / purchasePrice) * 100 : 0 }
      : null;

  return {
    level,
    dataConfidence,
    valuationConfidence,
    anchorType,
    anchorValue,
    calendarAgeYears,
    marketCurveValue,
    marketValueFactor,
    wearConditionFactor,
    retentionFactor,
    resaleLow,
    resaleHigh,
    marketPremium,
    purchasePrice,
    currentRetailPrice,
    historicalRetailPrice,
    costPerWear,
    retailAppreciation,
    retailChangeVsPurchase,
    resaleChangeVsPurchase,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Aggregate helper (Insights.tsx)
// ---------------------------------------------------------------------------

export interface AggregateValuationInput extends ValuationInput {
  id: string;
}

export function aggregateWardrobeValuation(items: AggregateValuationInput[], config: ValuationConfig) {
  let totalPurchase = 0;
  let purchaseCount = 0;
  let totalCurrentRetail = 0;
  let currentRetailCount = 0;
  let totalResaleLow = 0;
  let totalResaleHigh = 0;
  let resaleCount = 0;

  const perItem = items.map((it) => ({ id: it.id, result: computeItemValuation(it, config) }));

  for (const { result } of perItem) {
    if (result.purchasePrice != null) {
      totalPurchase += result.purchasePrice;
      purchaseCount += 1;
    }
    if (result.currentRetailPrice != null) {
      totalCurrentRetail += result.currentRetailPrice;
      currentRetailCount += 1;
    }
    if (result.resaleLow != null && result.resaleHigh != null) {
      totalResaleLow += result.resaleLow;
      totalResaleHigh += result.resaleHigh;
      resaleCount += 1;
    }
  }

  return { perItem, totalPurchase, purchaseCount, totalCurrentRetail, currentRetailCount, totalResaleLow, totalResaleHigh, resaleCount };
}

// ---------------------------------------------------------------------------
// Config fetching — unica parte del file che tocca Supabase
// ---------------------------------------------------------------------------

export const EMPTY_VALUATION_CONFIG: ValuationConfig = {
  categoryProfiles: [],
  brandModifiers: [],
  materialModifiers: [],
  modelProfiles: [],
  sizeModifiers: [],
};

export async function fetchValuationConfig(): Promise<ValuationConfig> {
  const [categoryRes, brandRes, materialRes, modelRes, sizeRes] = await Promise.all([
    supabase.from("valuation_category_profiles").select("*"),
    supabase.from("valuation_brand_modifiers").select("*"),
    supabase.from("valuation_material_modifiers").select("*"),
    supabase.from("valuation_model_profiles").select("*"),
    supabase.from("valuation_size_modifiers").select("*"),
  ]);

  if (categoryRes.error) console.error("[AURA value engine] category profiles", categoryRes.error);
  if (brandRes.error) console.error("[AURA value engine] brand modifiers", brandRes.error);
  if (materialRes.error) console.error("[AURA value engine] material modifiers", materialRes.error);
  if (modelRes.error) console.error("[AURA value engine] model profiles", modelRes.error);
  if (sizeRes.error) console.error("[AURA value engine] size modifiers", sizeRes.error);

  return {
    categoryProfiles: (categoryRes.data ?? []) as unknown as CategoryProfile[],
    brandModifiers: (brandRes.data ?? []) as unknown as BrandModifier[],
    materialModifiers: (materialRes.data ?? []) as unknown as MaterialModifier[],
    modelProfiles: (modelRes.data ?? []) as unknown as ModelProfile[],
    sizeModifiers: (sizeRes.data ?? []) as unknown as SizeModifier[],
  };
}
