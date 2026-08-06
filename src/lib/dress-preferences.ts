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

/** Explicit, operational instructions for the AI — distinct from the short
 *  UI labels above. A vague label like "Cover legs" gets interpreted
 *  loosely by the model (e.g. it once suggested a midi skirt, reasoning
 *  that some coverage is "enough"); these spell out exactly what counts
 *  as compliant so there's no room for that kind of misreading. */
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

/** Human-readable list of the active rules (for the profile view). */
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

/** Binding constraint block to inject into EVERY AI styling prompt.
 *  Returns null when the user has no preferences set. Uses explicit,
 *  operational wording (BOOL_PROMPT_TEXT) rather than the short UI labels
 *  — a vague rule like "Cover legs" leaves room for the model to decide
 *  a midi skirt is "close enough"; this doesn't. */
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

/** Loads the signed-in user's dress preferences and returns the binding
 *  prompt block (or null). One-liner for every AI call site. */
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

/** Same lookup as loadDressRules, but returns the raw object instead of
 *  the prompt text — used to filter the wardrobe catalog deterministically
 *  (see isItemAllowedByDressPreferences) so a violating piece is never
 *  even offered to the model, rather than relying only on it following
 *  an instruction. */
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
/** Item 'length' only has 3 steps (Mini/Midi/Maxi) while the preference has
 *  4 (mini/knee/midi/long) — no exact "knee" equivalent exists yet on
 *  items. Mapped conservatively: an item must be Midi to satisfy "knee"
 *  or "midi", and Maxi to satisfy "long". */
const ITEM_LENGTH_ORDER: Record<string, number> = { Mini: 0, Midi: 2, Maxi: 3 };

/**
 * Deterministic filter: does this wardrobe item comply with the user's
 * dress preferences? Used to strip disqualifying items OUT of the catalog
 * before it ever reaches the model — a hard exclusion, not just a prompt
 * instruction the model could misjudge (e.g. treating a midi skirt as
 * "close enough" to satisfy "cover legs").
 *
 * Only covers the preferences that map to an actual item attribute
 * (cover_legs, min_skirt_length, cover_arms, avoid_tight). cover_head,
 * cover_shoulders, avoid_sheer and avoid_low_neckline have no matching
 * wardrobe attribute yet, so they remain prompt-only instructions —
 * documented here so that gap stays visible rather than assumed fixed.
 */
export function isItemAllowedByDressPreferences(
  item: { category?: string | null; subcategory?: string | null; length?: string | null; sleeveLength?: string | null; fit?: string | null },
  p: DressPreferences | null | undefined,
): boolean {
  if (!p) return true;
  const category = item.category ?? "";
  const isSkirtBottom = category === "Bottoms" && item.subcategory === "Skirt";
  const isDressOrSkirt = category === "Dresses" || isSkirtBottom;
  const isJumpsuit = category === "Jumpsuits";

  if (isJumpsuit && p.cover_legs) {
    if (item.subcategory === "Playsuit" || item.subcategory === "Romper") return false;
  }

  if (isDressOrSkirt) {
    if (p.cover_legs && item.length && item.length !== "Maxi") return false;
    if (p.min_skirt_length && item.length) {
      const need = SKIRT_MIN_ORDER[p.min_skirt_length];
      const have = ITEM_LENGTH_ORDER[item.length];
      if (have !== undefined && have < need) return false;
    }
  }

  if (p.cover_arms && ["Tops", "Dresses", "Outerwear", "Jumpsuits"].includes(category)) {
    if (item.sleeveLength === "Sleeveless") return false;
  }

  if (p.avoid_tight && item.fit === "Slim") return false;

  return true;
}
