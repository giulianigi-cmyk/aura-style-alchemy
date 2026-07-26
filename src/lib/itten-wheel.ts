import { hexToRgb } from "./color-palette";

export type HSL = { h: number; s: number; l: number };

export function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = 60 * (((g - b) / d) % 6); break;
      case g: h = 60 * ((b - r) / d + 2); break;
      default: h = 60 * ((r - g) / d + 4); break;
    }
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function hexToHsl(hex: string): HSL {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

// 12 stops on the wheel (digital hue circle, basis for the Itten-style
// analysis). Names chosen to be readable in the UI, not for pigment-grade
// rigor from an art manual.
export const ITTEN_WHEEL_NAMES: { hue: number; name: string }[] = [
  { hue: 0, name: "Red" },
  { hue: 30, name: "Orange" },
  { hue: 60, name: "Yellow" },
  { hue: 90, name: "Yellow-Green" },
  { hue: 120, name: "Green" },
  { hue: 150, name: "Emerald Green" },
  { hue: 180, name: "Cyan" },
  { hue: 210, name: "Sky Blue" },
  { hue: 240, name: "Blue" },
  { hue: 270, name: "Purple" },
  { hue: 300, name: "Magenta" },
  { hue: 330, name: "Fuchsia" },
];


export function nearestWheelName(hue: number): string {
  let best = ITTEN_WHEEL_NAMES[0];
  let bestD = 360;
  for (const w of ITTEN_WHEEL_NAMES) {
    const d = Math.min(Math.abs(w.hue - hue), 360 - Math.abs(w.hue - hue));
    if (d < bestD) { bestD = d; best = w; }
  }
  return best.name;
}

export type Harmony = { label: string; hex: string; hue: number };

/** Classic Itten harmonies computed from a sampled base color. */
export function getHarmonies(baseHex: string): Harmony[] {
  const { h, s, l } = hexToHsl(baseHex);
  // Keep harmony swatches visibly saturated even when the sampled color
  // is muted/neutral (common for clothing) — otherwise every suggestion
  // collapses toward grey and becomes useless as a styling cue.
  const sUse = Math.max(s, 0.45);
  const lUse = Math.min(Math.max(l, 0.35), 0.65);
  const at = (deltaH: number, label: string): Harmony => {
    const hh = ((h + deltaH) % 360 + 360) % 360;
    return { label, hue: hh, hex: hslToHex(hh, sUse, lUse) };
  };
    return [
    at(180, "Complementary"),
    at(-30, "Analogous"),
    at(30, "Analogous"),
    at(150, "Split-Complementary"),
    at(-150, "Split-Complementary"),
    at(120, "Triadic"),
    at(-120, "Triadic"),
  ];

}
