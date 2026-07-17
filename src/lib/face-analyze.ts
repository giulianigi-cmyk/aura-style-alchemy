// Automatic face-based color sampling using MediaPipe FaceLandmarker.
// Loads the model dynamically from Google's CDN — nothing is bundled.
import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
        // @ts-expect-error — option name accepted by tasks-vision
        refineLandmarks: true,
      });
    })().catch((e) => {
      landmarkerPromise = null;
      throw e;
    });
  }
  return landmarkerPromise;
}

export interface AutoSamples {
  skin: string;
  hair: string;
  eye: string;
}

// Well-known FaceMesh landmark indices (with refineLandmarks: 478 points).
const LEFT_CHEEK = [234, 93, 132, 58, 172, 136, 150, 149, 116, 123, 147];
const RIGHT_CHEEK = [454, 323, 361, 288, 397, 365, 379, 378, 345, 352, 376];
const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];
const FOREHEAD_ANCHOR = 10; // top of forehead centre

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function rgbDist(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function samplePatch(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  cx: number,
  cy: number,
  radius: number,
  accept?: (r: number, g: number, b: number) => boolean,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(W - 1, Math.ceil(cx + radius));
  const y1 = Math.min(H - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      if (accept && !accept(r, g, b)) continue;
      out.push([r, g, b]);
    }
  }
  return out;
}

function average(pixels: [number, number, number][]): [number, number, number] | null {
  if (!pixels.length) return null;
  let r = 0, g = 0, b = 0;
  for (const p of pixels) { r += p[0]; g += p[1]; b += p[2]; }
  return [r / pixels.length, g / pixels.length, b / pixels.length];
}

export async function autoSampleFromCanvas(canvas: HTMLCanvasElement): Promise<AutoSamples | null> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const W = canvas.width;
  const H = canvas.height;

  let landmarker: FaceLandmarker;
  try {
    landmarker = await getFaceLandmarker();
  } catch (e) {
    console.error("[AURA] FaceLandmarker init failed", e);
    return null;
  }

  let result;
  try {
    result = landmarker.detect(canvas);
  } catch (e) {
    console.error("[AURA] FaceLandmarker detect failed", e);
    return null;
  }

  const faces = result.faceLandmarks;
  if (!faces || !faces.length) return null;
  const lm: NormalizedLandmark[] = faces[0];
  if (!lm || lm.length < 478) return null;

  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, W, H);
  } catch (e) {
    console.error("[AURA] getImageData blocked", e);
    return null;
  }
  const data = img.data;

  const toPx = (p: NormalizedLandmark) => [p.x * W, p.y * H] as [number, number];

  // ---- SKIN: average multiple cheek patches ----
  const cheekIdx = [...LEFT_CHEEK, ...RIGHT_CHEEK];
  const skinPixels: [number, number, number][] = [];
  const cheekRadius = Math.max(3, Math.min(W, H) * 0.012);
  for (const idx of cheekIdx) {
    const [x, y] = toPx(lm[idx]);
    skinPixels.push(...samplePatch(data, W, H, x, y, cheekRadius));
  }
  const skinAvg = average(skinPixels);
  if (!skinAvg) return null;

  // ---- EYE: iris landmarks, exclude sclera / pupil / highlights ----
  const irisIdx = [...LEFT_IRIS, ...RIGHT_IRIS];
  const eyePixels: [number, number, number][] = [];
  const irisRadius = Math.max(2, Math.min(W, H) * 0.006);
  const eyeAccept = (r: number, g: number, b: number) => {
    const lum = (r + g + b) / 3;
    if (lum > 220) return false; // sclera / reflections
    if (lum < 25) return false;  // pupil
    return true;
  };
  for (const idx of irisIdx) {
    const [x, y] = toPx(lm[idx]);
    eyePixels.push(...samplePatch(data, W, H, x, y, irisRadius, eyeAccept));
  }
  const eyeAvg = average(eyePixels);

  // ---- HAIR: band above forehead, within face bbox, exclude skin-like pixels ----
  const [fx, fy] = toPx(lm[FOREHEAD_ANCHOR]);
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < lm.length; i++) {
    const x = lm[i].x * W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const faceWidth = maxX - minX;
  const bandTop = Math.max(0, fy - faceWidth * 0.35);
  const bandBottom = Math.max(0, fy - faceWidth * 0.05);
  const bandLeft = Math.max(0, fx - faceWidth * 0.28);
  const bandRight = Math.min(W - 1, fx + faceWidth * 0.28);
  const hairPixels: [number, number, number][] = [];
  const skinRef: [number, number, number] = [skinAvg[0], skinAvg[1], skinAvg[2]];
  for (let y = Math.floor(bandTop); y <= Math.floor(bandBottom); y++) {
    for (let x = Math.floor(bandLeft); x <= Math.floor(bandRight); x++) {
      const i = (y * W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      // Reject skin-like pixels
      if (rgbDist([r, g, b], skinRef) < 45) continue;
      // Reject the warm canvas background baked in during draw (#F5EFE0)
      if (rgbDist([r, g, b], [245, 239, 224]) < 20) continue;
      hairPixels.push([r, g, b]);
    }
  }
  const hairAvg = average(hairPixels);

  return {
    skin: toHex(skinAvg[0], skinAvg[1], skinAvg[2]),
    hair: hairAvg ? toHex(hairAvg[0], hairAvg[1], hairAvg[2]) : toHex(skinAvg[0] * 0.4, skinAvg[1] * 0.4, skinAvg[2] * 0.4),
    eye: eyeAvg ? toHex(eyeAvg[0], eyeAvg[1], eyeAvg[2]) : toHex(skinAvg[0] * 0.5, skinAvg[1] * 0.5, skinAvg[2] * 0.5),
  };
}
