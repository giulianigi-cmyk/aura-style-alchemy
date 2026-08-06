// Dress preferences: practical dressing requirements chosen by the user
// (cultural, religious or personal). We never ask or store the reason —
// only the practical rules. These rules are BINDING for every suggestion:
// armocromia and style advice may only rank within what these allow.

export type SkirtLength = "mini" | "knee" | "midi" | "long";
export type SleeveLength = "none" | "short" | "three-quarter" | "long";

export type DressPreferences = {
  cover_head?: boolean;
  cover_shoulders?: boolean;
  cover_arms?: boolean;
  cover_legs?: boolean;
  avoid_tight?: boolean;
  avoid_sheer?: boolean;
  avoid_low_neckline?: boolean;
  min_skirt_length?: SkirtLength;
  min_sleeve_length?: SleeveLength;
  custom_notes?: string;
};

export const BOOL_PREFS: { key: keyof DressPreferences; label: string }[] = [
  { key: "cover_head", label: "Cover head or hair" },
  { key: "cover_shoulders", label: "Cover shoulders" },
  { key: "cover_arms", label: "Cover arms" },
  { key: "cover_legs", label: "Cover legs" },
  { key: "avoid_tight", label: "Avoid tight fits" },
  { key: "avoid_sheer", label: "Avoid sheer fabrics" },
  { key: "avoid_low_neckline", label: "Avoid low necklines" },
];

export const SKIRT_OPTIONS: { value: SkirtLength; label: string }[] = [
  { value: "mini", label: "Mini" },
  { value: "knee", label: "Knee" },
  { value: "midi", label: "Midi" },
  { value: "long", label: "Long" },
];

export const SLEEVE_OPTIONS: { value: SleeveLength; label: string }[] = [
  { value: "none", label: "Sleeveless ok" },
  { value: "short", label: "Short" },
  { value: "three-quarter", label: "3/4" },
  { value: "long", label: "Long" },
];

const BOOL_PROMPT_TEXT: Record<string, string> = {
  cover_head: "Cover head or hair in every look — only suggest headwear (scarf, hat) that achieves this, or explicitly note that no current wardrobe item covers the head.",
  cover_shoulders: "Shoulders must be fully covered — exclude strapless, off-shoulder, halter, or bare-shoulder pieces of any kind.",
  cover_arms: "Arms must be covered — exclude sleeveless, tank, cami, or bare-shoulder tops/dresses. Any sleeve length counts as covered; no bare arms.",
  cover_legs: "FULL leg coverage is required. This means trousers, leggings, or a skirt/dress that reaches the ankle — nothing shorter. Mini, knee-length, and midi skirts or dresses do NOT satisfy this rule, even though they have some length: the legs are still visibly bare below the hem. Never suggest a skirt or dress unless it is ankle-length.",
  avoid_tight: "Avoid tight or body-hugging fits — prefer relaxed, straight, or A-line silhouettes.",
  avoid_sheer: "Avoid sheer or semi-transparent fabrics.",
  avoid_low_neckline: "Avoid low or plunging necklines — crew, boat, or high necklines only.",
};

export function hasAnyPreference(p: DressPreferences | null | undefined): boolean {
  if (!p) return false;
  return Boolean(
    p.cover_head || p.cover_shoulders || p.cover_arms || p.cover_legs ||
    p.avoid_tight || p.avoid_sheer || p.avoid_low_neckline ||
    p.min_skirt_length || p.min_sleeve_length ||
    (p.custom_notes && p.custom_notes.trim())
  );
}

export function activePreferenceLabels(p: DressPreferences): string[] {
  const out: string[] = [];
  for (const b of BOOL_PREFS) if (p[b.key]) out.push(b.label);
  if (p.min_skirt_length) {
    const o = SKIRT_OPTIONS.find((x) => x.value === p.min_skirt_length);
    if (o) out.push(`Skirts: ${o.label} or longer`);
  }
  if (p.min_sleeve_length) {
    const o = SLEEVE_OPTIONS.find((x) => x.value === p.min_sleeve_length);
    if (o) out.push(`Sleeves: ${o.label}${p.min_sleeve_length === "none" ? "" : " or longer"}`);
  }
  if (p.custom_notes?.trim()) out.push(p.custom_notes.trim());
  return out;
}

export function dressPreferencesToPrompt(p: DressPreferences | null | undefined): string | null {
  if (!hasAnyPreference(p)) return null;
  const rules: string[] = [];
  for (const b of BOOL_PREFS) if (p![b.key]) rules.push(BOOL_PROMPT_TEXT[b.key] ?? b.label);
  if (p!.min_skirt_length) {
    const o = SKIRT_OPTIONS.find((x) => x.value === p!.min_skirt_length);
    if (o) rules.push(`Skirts and dresses (when not otherwise excluded by a stricter rule above): ${o.label} length or longer only.`);
  }
  if (p!.min_sleeve_length && p!.min_sleeve_length !== "none") {
    const o = SLEEVE_OPTIONS.find((x) => x.value === p!.min_sleeve_length);
    if (o) rules.push(`Sleeves: ${o.label} length or longer only.`);
  }
  if (p!.custom_notes?.trim()) rules.push(p!.custom_notes.trim());
  return [
    "STRICT DRESSING RULES chosen by the user. These are NON-NEGOTIABLE and",
    "override any color, trend or style advice. Never suggest, show or",
    "recommend anything that violates them:",
    ...rules.map((r) => `- ${r}`),
  ].join("\n");
}

export async function loadDressRules(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase
    .from("profiles")
    .select("dress_preferences")
    .eq("id", userId)
    .maybeSingle();
  const p = (data as { dress_preferences?: DressPreferences } | null)?.dress_preferences ?? null;
  return dressPreferencesToPrompt(p);
}

export async function loadDressPreferencesRaw(userId: string | undefined): Promise<DressPreferences | null> {
  if (!userId) return null;
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase
    .from("profiles")
    .select("dress_preferences")
    .eq("id", userId)
    .maybeSingle();
  return (data as { dress_preferences?: DressPreferences } | null)?.dress_preferences ?? null;
}

const SKIRT_MIN_ORDER: Record<SkirtLength, number> = { mini: 0, knee: 1, midi: 2, long: 3 };
const ITEM_LENGTH_ORDER: Record<string, number> = { Mini: 0, Midi: 2, Maxi: 3 };

/**
 * Whitelist, not blacklist: does this garment cover the legs? Explicit
 * per known subcategory rather than "not shorts, so it must be fine" —
 * as the Bottoms taxonomy grows (culottes, capri, etc.), an unrecognized
 * subcategory falls through to the conservative default (needs an
 * explicit Maxi/Long length tag) instead of silently passing.
 *
 * Single source of truth: used both by the hard wardrobe filter below
 * AND by the "verified fact" the AI is told directly (see
 * stylist-chat.functions.ts) — duplicating this logic in two places
 * would risk them drifting out of sync.
 */
export function coversLegs(item: { category?: string | null; subcategory?: string | null; length?: string | null }): boolean {
  const category = item.category ?? "";
  const subcategory = item.subcategory ?? "";

  if (category === "Dresses") {
    return !item.length || item.length === "Maxi";
  }

  if (category === "Jumpsuits") {
    if (subcategory === "Playsuit" || subcategory === "Romper") return false;
    return true;
  }

  if (category === "Bottoms") {
    switch (subcategory) {
      case "Jeans":
      case "Trousers":
      case "Cargo Pants":
      case "Joggers":
      case "Leggings":
        return true;
      case "Shorts":
      case "Bermuda Shorts":
        return false;
      case "Skirt":
        return !item.length || item.length === "Maxi";
      default:
        return item.length === "Maxi" || item.length === "Long";
    }
  }

  return false;
}

/** Same principle as coversLegs, for arm coverage. */
export function coversArms(item: { category?: string | null; sleeveLength?: string | null }): boolean {
  const category = item.category ?? "";
  if (!["Tops", "Dresses", "Outerwear", "Jumpsuits"].includes(category)) return false;
  return item.sleeveLength !== "Sleeveless";
}

export function isItemAllowedByDressPreferences(
  item: { category?: string | null; subcategory?: string | null; length?: string | null; sleeveLength?: string | null; fit?: string | null },
  p: DressPreferences | null | undefined,
): boolean {
  if (!p) return true;
  const category = item.category ?? "";
  const isSkirtBottom = category === "Bottoms" && item.subcategory === "Skirt";
  const isDressOrSkirt = category === "Dresses" || isSkirtBottom;

  // cover_legs is only meaningful for categories that touch the legs at
  // all — applying coversLegs() as a blanket check wiped shoes, bags,
  // tops and outerwear out of the catalog entirely whenever cover_legs
  // was on, since coversLegs() correctly answers "no" for anything that
  // isn't a Dress/Jumpsuit/Bottoms. Scope it to where it's relevant.
  const isLegRelevantCategory = ["Dresses", "Jumpsuits", "Bottoms"].includes(category);
  if (p.cover_legs && isLegRelevantCategory && !coversLegs(item)) return false;

  if (isDressOrSkirt && p.min_skirt_length && item.length) {
    const need = SKIRT_MIN_ORDER[p.min_skirt_length];
    const have = ITEM_LENGTH_ORDER[item.length];
    if (have !== undefined && have < need) return false;
  }

  if (p.cover_arms && !coversArms(item)) return false;

  if (p.avoid_tight && item.fit === "Slim") return false;

  return true;
}
