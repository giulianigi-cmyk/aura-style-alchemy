import { hexToRgb } from "./color-palette";

export type ColorSeason = "Spring" | "Summer" | "Autumn" | "Winter";
export type DominantTrait = "undertone" | "value" | "intensity" | "balanced";
export type ClassificationConfidence = "High" | "Moderate" | "Low";
export type SampleQuality = "Good" | "Fair" | "Poor";
export type Undertone = "Warm" | "Cool" | "Olive" | "Neutral";

export interface ColorFamily {
  reds: string[];
  pinks: string[];
  oranges: string[];
  yellows: string[];
  greens: string[];
  blues: string[];
  purples: string[];
}

export interface SeasonResult {
  season: ColorSeason;
  seasonLabel: string;
  subgroup: string;
  dominantTrait: DominantTrait;
  undertone: Undertone;
  value: "Light" | "Deep";
  contrast: "Alto" | "Medio" | "Basso";
  metal: "Oro" | "Argento";
  compatibilityScores: Record<ColorSeason, number>;
  classificationConfidence: ClassificationConfidence;
  sampleQuality: SampleQuality;
  description: string;
  palette: ColorFamily;
  neutrals: string[];
  accents: string[];
  lessHarmonious: string[];
}

const SUBGROUP_NAMES: Record<ColorSeason, Record<DominantTrait, string>> = {
  Spring: { undertone: "Primavera Calda", value: "Primavera Chiara", intensity: "Primavera Brillante", balanced: "Primavera Assoluta" },
  Summer: { undertone: "Estate Fredda", value: "Estate Chiara", intensity: "Estate Soft", balanced: "Estate Assoluta" },
  Autumn: { undertone: "Autunno Caldo", value: "Autunno Profondo", intensity: "Autunno Soft", balanced: "Autunno Assoluto" },
  Winter: { undertone: "Inverno Freddo", value: "Inverno Profondo", intensity: "Inverno Brillante", balanced: "Inverno Assoluto" },
};

const SEASON_LABELS: Record<ColorSeason, string> = {
  Spring: "Primavera", Summer: "Estate", Autumn: "Autunno", Winter: "Inverno",
};

const SEASON_METAL: Record<ColorSeason, "Oro" | "Argento"> = {
  Spring: "Oro", Autumn: "Oro", Summer: "Argento", Winter: "Argento",
};

const SEASON_RANGES: Record<ColorSeason, Record<"temperature" | "intensity" | "value" | "contrast", [number, number]>> = {
  Spring: { temperature: [0.65, 1.0], intensity: [0.55, 0.85], value: [0.60, 0.85], contrast: [0.45, 0.75] },
  Summer: { temperature: [0.0, 0.35], intensity: [0.15, 0.50], value: [0.50, 0.75], contrast: [0.15, 0.50] },
  Autumn: { temperature: [0.65, 1.0], intensity: [0.15, 0.50], value: [0.15, 0.50], contrast: [0.15, 0.50] },
  Winter: { temperature: [0.0, 0.35], intensity: [0.55, 0.85], value: [0.15, 0.50], contrast: [0.55, 0.85] },
};

const AXIS_WEIGHTS = { temperature: 0.40, intensity: 0.30, value: 0.15, contrast: 0.15 };

const NEUTRAL_UNDERTONE_ZONE = 4;
const OLIVE_A_MAX = 8;
const OLIVE_B_MIN = 15;
const OLIVE_LABEL_THRESHOLD = 0.55;
const CONTRAST_MIN = 5;
const CONTRAST_MAX = 55;
const CHROMA_VARIANCE_HIGH = 150;

const SEASON_PALETTE: Record<ColorSeason, ColorFamily> = {
  Spring: {
    reds: ["#FF6F61"],
    pinks: ["#FFB4A2"],
    oranges: ["#F4A261", "#E9843F"],
    yellows: ["#FFD166", "#FFC94D"],
    greens: ["#8DBF6E", "#A0C878"],
    blues: ["#4169E1", "#4FB0C6"],
    purples: ["#B98ED6"],
  },
  Summer: {
    reds: ["#D88C93"],
    pinks: ["#F4C2C2", "#E6B0AA"],
    oranges: ["#E0A899"],
    yellows: ["#EDE1B0"],
    greens: ["#A9C4B5", "#8BA89A"],
    blues: ["#A7C7E7", "#7FA6C4", "#9CADCE"],
    purples: ["#C9A9D9", "#9D8EBF"],
  },
  Autumn: {
    reds: ["#A0421E"],
    pinks: ["#C77B58"],
    oranges: ["#B5651D", "#CB6D3E"],
    yellows: ["#DAA520", "#C99A2E"],
    greens: ["#6B8E23", "#77875A"],
    blues: ["#2E6E6E", "#3C7A89"],
    purples: ["#6E4B3A"],
  },
  Winter: {
    reds: ["#800020", "#DC143C"],
    pinks: ["#E85A9E"],
    oranges: [],
    yellows: ["#FFF44F"],
    greens: ["#009B5B"],
    blues: ["#0047AB", "#191970"],
    purples: ["#673147", "#9966CC", "#4B0082"],
  },
};

const SEASON_NEUTRALS: Record<ColorSeason, string[]> = {
  Spring: ["#F5EFE0", "#E8C9A0", "#C9A66B", "#8A7052"],
  Summer: ["#F0EEEC", "#D6D2CE", "#B9B4C2", "#6E6E76"],
  Autumn: ["#E7D9BE", "#C6A26A", "#8A5A32", "#5C4023"],
  Winter: ["#FFFFFF", "#D6D6D6", "#8E8E93", "#36454F"],
};

const SEASON_ACCENTS: Record<ColorSeason, string[]> = {
  Spring: ["#4FB0C6", "#FFD166"],
  Summer: ["#9CADCE", "#C9A9D9"],
  Autumn: ["#DAA520", "#8B4513"],
  Winter: ["#FFF44F", "#009B5B"],
};

const SEASON_LESS_HARMONIOUS: Record<ColorSeason, string[]> = {
  Spring: ["#5C4033", "#2F3E46", "#4B0082"],
  Summer: ["#FF4500", "#FFD700", "#228B22"],
  Autumn: ["#FF69B4", "#00CED1", "#7FFFD4"],
  Winter: ["#DAA520", "#CD853F", "#F4A460"],
};

const SEASON_DESCRIPTION: Record<ColorSeason, string> = {
  Spring: "Warm and light, with a clear, fresh quality.",
  Summer: "Cool and light, with a soft, muted quality.",
  Autumn: "Warm and deep, with a rich, muted quality.",
  Winter: "Cool and deep, with a clear, high-contrast quality.",
};

type Lab = { L: number; a: number; b: number };

function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToLab(hex: string): Lab {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = srgbToLinear(r8), g = srgbToLinear(g8), b = srgbToLinear(b8);
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
  const xn = x / 0.95047, yn = y / 1.0, zn = z / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xn), fy = f(yn), fz = f(zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const chroma = (s: Lab) => Math.sqrt(s.a * s.a + s.b * s.b);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function closeness(v: number, range: [number, number]): number {
  const [lo, hi] = range;
  const mid = (lo + hi) / 2;
  const sigma = Math.max(0.05, (hi - lo) / 2);
  return Math.exp(-(((v - mid) / sigma) ** 2));
}

export function classifyColorSeason(skinHex: string, hairHex: string, eyeHex: string): SeasonResult {
  const skin = hexToLab(skinHex);
  const hair = hexToLab(hairHex);
  const eye = hexToLab(eyeHex);
  const allLs = [skin.L, hair.L, eye.L];
  const chromas = { skin: chroma(skin), hair: chroma(hair), eye: chroma(eye) };

  const extremeReading = allLs.some((l) => l < 8 || l > 96);
  const allChromaLow = chromas.skin < 5 && chromas.hair < 5 && chromas.eye < 5;
  const eyeMatchesSkin = Math.abs(eye.L - skin.L) < 4 && Math.abs(chromas.eye - chromas.skin) < 4;
  let sampleQuality: SampleQuality = "Good";
  if (extremeReading || eyeMatchesSkin) sampleQuality = "Poor";
  else if (allChromaLow) sampleQuality = "Fair";

  const temperatureRaw = skin.b - skin.a;
  const temperature01 = clamp01((temperatureRaw - -15) / (35 - -15));
  const oliveness = clamp01((OLIVE_A_MAX - skin.a) / OLIVE_A_MAX) * clamp01((skin.b - OLIVE_B_MIN) / OLIVE_B_MIN);
  let undertone: Undertone;
  if (oliveness > OLIVE_LABEL_THRESHOLD) undertone = "Olive";
  else if (Math.abs(temperatureRaw) < NEUTRAL_UNDERTONE_ZONE) undertone = "Neutral";
  else undertone = temperatureRaw >= 0 ? "Warm" : "Cool";

  const valueRaw = skin.L * 0.6 + hair.L * 0.25 + eye.L * 0.15;
  const value01 = clamp01((valueRaw - 25) / (90 - 25));
  const value: "Light" | "Deep" = valueRaw >= 55 ? "Light" : "Deep";

  const intensityRaw = chromas.skin * 0.4 + chromas.eye * 0.35 + chromas.hair * 0.25;
  const intensity01 = clamp01((intensityRaw - 3) / (45 - 3));
  const chromaMean = (chromas.skin + chromas.hair + chromas.eye) / 3;
  const chromaVariance =
    ((chromas.skin - chromaMean) ** 2 + (chromas.hair - chromaMean) ** 2 + (chromas.eye - chromaMean) ** 2) / 3;

  const dSkinHair = Math.abs(skin.L - hair.L);
  const dSkinEye = Math.abs(skin.L - eye.L);
  const dHairEye = Math.abs(hair.L - eye.L);
  const contrastRaw = dSkinHair * 0.5 + dSkinEye * 0.3 + dHairEye * 0.2;
  const contrast01 = clamp01((contrastRaw - CONTRAST_MIN) / (CONTRAST_MAX - CONTRAST_MIN));
  const contrast: "Alto" | "Medio" | "Basso" = contrastRaw >= 40 ? "Alto" : contrastRaw >= 22 ? "Medio" : "Basso";

  const profile = { temperature: temperature01, intensity: intensity01, value: value01, contrast: contrast01 };

  const rawScores = (Object.keys(SEASON_RANGES) as ColorSeason[]).reduce((acc, s) => {
    const r = SEASON_RANGES[s];
    acc[s] =
      AXIS_WEIGHTS.temperature * closeness(profile.temperature, r.temperature) +
      AXIS_WEIGHTS.intensity * closeness(profile.intensity, r.intensity) +
      AXIS_WEIGHTS.value * closeness(profile.value, r.value) +
      AXIS_WEIGHTS.contrast * closeness(profile.contrast, r.contrast);
    return acc;
  }, {} as Record<ColorSeason, number>);

  const totalScore = (Object.values(rawScores) as number[]).reduce((a, b) => a + b, 0);
  const compatibilityScores = (Object.keys(rawScores) as ColorSeason[]).reduce((acc, s) => {
    acc[s] = Math.round((rawScores[s] / totalScore) * 1000) / 10;
    return acc;
  }, {} as Record<ColorSeason, number>);

  const ranked = (Object.entries(compatibilityScores) as [ColorSeason, number][]).sort((a, b) => b[1] - a[1]);
  const season = ranked[0][0];
  const gap = ranked[0][1] - ranked[1][1];

  let confPoints = 0;
  if (gap >= 20) confPoints += 2;
  else if (gap >= 8) confPoints += 1;
  if (ranked[0][1] >= 35) confPoints += 1;
  if (sampleQuality === "Good") confPoints += 1;
  else if (sampleQuality === "Poor") confPoints -= 2;
  if (undertone === "Neutral" || undertone === "Olive") confPoints -= 1;
  if (chromaVariance > CHROMA_VARIANCE_HIGH) confPoints -= 1;
  const classificationConfidence: ClassificationConfidence = confPoints >= 3 ? "High" : confPoints >= 1 ? "Moderate" : "Low";

  const ref = SEASON_RANGES[season];
  const deviations: Record<Exclude<DominantTrait, "balanced">, number> = {
    undertone: 1 - closeness(profile.temperature, ref.temperature),
    value: 1 - closeness(profile.value, ref.value),
    intensity: 1 - closeness(profile.intensity, ref.intensity),
  };
  const sortedDevs = (Object.entries(deviations) as [Exclude<DominantTrait, "balanced">, number][])
    .sort((a, b) => b[1] - a[1]);
  const [topTrait, topDev] = sortedDevs[0];
  const secondDev = sortedDevs[1][1];
  const dominantTrait: DominantTrait = (topDev >= 0.35 && topDev - secondDev >= 0.12) ? topTrait : "balanced";

  const subgroup = SUBGROUP_NAMES[season][dominantTrait];

  return {
    season,
    seasonLabel: SEASON_LABELS[season],
    subgroup,
    dominantTrait,
    undertone,
    value,
    contrast,
    metal: SEASON_METAL[season],
    compatibilityScores,
    classificationConfidence,
    sampleQuality,
    description: SEASON_DESCRIPTION[season],
    palette: SEASON_PALETTE[season],
    neutrals: SEASON_NEUTRALS[season],
    accents: SEASON_ACCENTS[season],
    lessHarmonious: SEASON_LESS_HARMONIOUS[season],
  };
}
