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
  if (p.min_sleeve_length && p.min_sleeve_length !== "none") {
    const o = SLEEVE_OPTIONS.find((x) => x.value === p.min_sleeve_length);
    if (o) out.push(`Sleeves: ${o.label} or longer`);
  }
  if (p.custom_notes?.trim()) out.push(p.custom_notes.trim());
  return out;
}

/** Binding constraint block to inject into EVERY AI styling prompt.
 *  Returns null when the user has no preferences set. */
export function dressPreferencesToPrompt(p: DressPreferences | null | undefined): string | null {
  if (!hasAnyPreference(p)) return null;
  const rules = activePreferenceLabels(p!);
  return [
    "STRICT DRESSING RULES chosen by the user. These are NON-NEGOTIABLE and",
    "override any color, trend or style advice. Never suggest, show or",
    "recommend anything that violates them:",
    ...rules.map((r) => `- ${r}`),
  ].join("\n");
}
