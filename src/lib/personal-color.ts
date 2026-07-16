import { hexToRgb } from "./color-palette";
import { hexToHsl } from "./itten-wheel";

export type ColorSeason = "Spring" | "Summer" | "Autumn" | "Winter";

export interface SeasonResult {
  season: ColorSeason;
  undertone: "Warm" | "Cool";
  value: "Light" | "Deep";
  clarity: "Clear" | "Muted";
  description: string;
  recommendedPalette: string[];
  avoidPalette: string[];
}

const SEASON_INFO: Record<ColorSeason, { description: string; recommended: string[]; avoid: string[] }> = {
  Spring: {
    description:
      "Warm and light undertones with a clear, fresh quality. Colors that carry a touch of yellow " +
      "and stay bright rather than dusty tend to be the most flattering.",
    recommended: ["#FF6F61", "#FFD166", "#8DBF6E", "#4FB0C6", "#F4A261", "#FFB4A2"],
    avoid: ["#5C4033", "#2F3E46", "#800020", "#4B0082"],
  },
  Summer: {
    description:
      "Cool and light undertones with a soft, muted quality. Colors with a touch of blue or grey in " +
      "them, rather than pure or golden tones, tend to work best.",
    recommended: ["#A7C7E7", "#C9A9D9", "#F4C2C2", "#9CADCE", "#B0C4B1", "#E6B0AA"],
    avoid: ["#FF4500", "#FFD700", "#8B0000", "#228B22"],
  },
  Autumn: {
    description:
      "Warm and deep undertones with a rich, muted quality. Earthy, golden tones with depth tend to " +
      "be the most flattering — think spice, moss, and rust rather than pastels.",
    recommended: ["#B5651D", "#6B8E23", "#C19A6B", "#8B4513", "#DAA520", "#A0522D"],
    avoid: ["#FF69B4", "#00CED1", "#C71585", "#7FFFD4"],
  },
  Winter: {
    description:
      "Cool and deep undertones with a clear, high-contrast quality. Bold, saturated colors and true " +
      "icy tones tend to work best, more than warm or muted shades.",
    recommended: ["#000080", "#DC143C", "#4B0082", "#008B8B", "#FFFFFF", "#C0C0C0"],
    avoid: ["#DAA520", "#CD853F", "#F4A460", "#EEE8AA"],
  },
};

/**
 * Estimates a personal color season from three sampled points on a photo
 * (skin, hair, eyes). This is a simplified 4-season model, not a
 * professional draping analysis — always presented to the user as an
 * ESTIMATE (per AURA's truth-in-data principle), never a verified fact.
 * The actual sampled swatches should always be shown alongside the result
 * so the person can see exactly what the estimate is based on.
 */
export function classifyColorSeason(skinHex: string, hairHex: string, eyeHex: string): SeasonResult {
  const skin = hexToHsl(skinHex);
  const hair = hexToHsl(hairHex);
  const eye = hexToHsl(eyeHex);
  const [r, g, b] = hexToRgb(skinHex);

  // Undertone: skin hues in the red/magenta neighborhood read as cooler
  // (rosier) than hues in the orange/yellow neighborhood (warmer/golden).
  // This is a deliberately simple heuristic, not a lab-grade measurement.
  const warmScore = (r - g) - (g - b);
  const undertone: "Warm" | "Cool" = warmScore >= 0 ? "Warm" : "Cool";

  const avgLightness = (skin.l + hair.l) / 2;
  const value: "Light" | "Deep" = avgLightness >= 0.55 ? "Light" : "Deep";

  const contrast = Math.abs(skin.l - hair.l);
  const clarity: "Clear" | "Muted" = (eye.s >= 0.35 || contrast >= 0.3) ? "Clear" : "Muted";

  let season: ColorSeason;
  if (undertone === "Warm" && value === "Light") season = "Spring";
  else if (undertone === "Warm") season = "Autumn";
  else if (value === "Light") season = "Summer";
  else season = "Winter";

  const info = SEASON_INFO[season];
  return {
    season,
    undertone,
    value,
    clarity,
    description: info.description,
    recommendedPalette: info.recommended,
    avoidPalette: info.avoid,
  };
}
