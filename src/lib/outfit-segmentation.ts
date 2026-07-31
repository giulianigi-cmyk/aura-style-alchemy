/** Client-side clothing segmentation using segformer_b2_clothes.
 *  Runs entirely in the browser via @huggingface/transformers (WASM/WebGPU),
 *  no server round-trip and no per-image cost. */

type Segmenter = (input: string) => Promise<Array<{ label: string; mask: { data: Uint8Array | Uint8ClampedArray; width: number; height: number } }>>;

let segmenterPromise: Promise<Segmenter> | null = null;

async function getSegmenter(): Promise<Segmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const seg = await pipeline("image-segmentation", "Xenova/segformer_b2_clothes");
      return seg as unknown as Segmenter;
    })().catch((e) => {
      segmenterPromise = null;
      throw e;
    });
  }
  return segmenterPromise;
}

const GARMENT_LABELS = new Set([
  "Hat", "Sunglasses", "Upper-clothes", "Skirt", "Pants", "Dress",
  "Belt", "Left-shoe", "Right-shoe", "Bag", "Scarf",
]);

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image failed to load"));
    el.src = dataUrl;
  });
}

function maskNonZero(mask: Uint8Array | Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 127) n++;
  return n;
}

function unionMasks(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] > 127 || b[i] > 127) ? 255 : 0;
  return out;
}

function tightBoundingBox(mask: Uint8Array | Uint8ClampedArray, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 127) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
}

export type SegmentationMasks = {
  maskWidth: number;
  maskHeight: number;
  masksByLabel: Map<string, Uint8Array | Uint8ClampedArray>;
};

/** Shared pipeline: run the model once and build the per-label mask map
 *  (with Left-shoe/Right-shoe merged into a single "Shoes" mask). */
async function runSegmentation(imageDataUrl: string): Promise<SegmentationMasks | null> {
  const segmenter = await getSegmenter();
  const output = await segmenter(imageDataUrl);

  const byLabel = new Map<string, Uint8Array | Uint8ClampedArray>();
  let maskW = 0, maskH = 0;
  for (const seg of output) {
    if (!seg?.mask) continue;
    maskW = seg.mask.width; maskH = seg.mask.height;
    if (GARMENT_LABELS.has(seg.label)) byLabel.set(seg.label, seg.mask.data);
  }
  if (!maskW || !maskH) return null;

  const ls = byLabel.get("Left-shoe");
  const rs = byLabel.get("Right-shoe");
  if (ls && rs) {
    byLabel.delete("Left-shoe"); byLabel.delete("Right-shoe");
    byLabel.set("Shoes", unionMasks(ls, rs));
  } else if (ls) {
    byLabel.delete("Left-shoe"); byLabel.set("Shoes", ls);
  } else if (rs) {
    byLabel.delete("Right-shoe"); byLabel.set("Shoes", rs);
  }

  return { maskWidth: maskW, maskHeight: maskH, masksByLabel: byLabel };
}

/** Public accessor for raw per-label masks. Uses the same singleton model. */
export async function getSegmentationMasks(imageDataUrl: string): Promise<SegmentationMasks | null> {
  return runSegmentation(imageDataUrl);
}

export async function segmentOutfitPhoto(imageDataUrl: string): Promise<{ label: string; imageDataUrl: string }[]> {
  try {
    const seg = await runSegmentation(imageDataUrl);
    if (!seg) return [];
    const { maskWidth: maskW, maskHeight: maskH, masksByLabel: byLabel } = seg;

    const totalPixels = maskW * maskH;
    const minPixels = Math.floor(totalPixels * 0.015);

    // Draw source photo to canvas at mask dimensions for accurate per-pixel alpha.
    const img = await loadImage(imageDataUrl);
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = maskW; srcCanvas.height = maskH;
    const srcCtx = srcCanvas.getContext("2d");
    if (!srcCtx) return [];
    srcCtx.drawImage(img, 0, 0, maskW, maskH);
    const srcData = srcCtx.getImageData(0, 0, maskW, maskH);

    const results: { label: string; imageDataUrl: string }[] = [];

    for (const [label, mask] of byLabel) {
      if (maskNonZero(mask) < minPixels) continue;
      const bbox = tightBoundingBox(mask, maskW, maskH);
      if (!bbox) continue;

      const bw = bbox.x1 - bbox.x0;
      const bh = bbox.y1 - bbox.y0;
      const padX = Math.round(bw * 0.04);
      const padY = Math.round(bh * 0.04);
      const x0 = Math.max(0, bbox.x0 - padX);
      const y0 = Math.max(0, bbox.y0 - padY);
      const x1 = Math.min(maskW, bbox.x1 + padX);
      const y1 = Math.min(maskH, bbox.y1 + padY);
      const cw = x1 - x0, ch = y1 - y0;
      if (cw < 2 || ch < 2) continue;

      const outCanvas = document.createElement("canvas");
      outCanvas.width = cw; outCanvas.height = ch;
      const outCtx = outCanvas.getContext("2d");
      if (!outCtx) continue;
      const outImg = outCtx.createImageData(cw, ch);
      const od = outImg.data;
      const sd = srcData.data;

      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const sx = x0 + x, sy = y0 + y;
          const srcIdx = (sy * maskW + sx) * 4;
          const dstIdx = (y * cw + x) * 4;
          const m = mask[sy * maskW + sx];
          od[dstIdx] = sd[srcIdx];
          od[dstIdx + 1] = sd[srcIdx + 1];
          od[dstIdx + 2] = sd[srcIdx + 2];
          od[dstIdx + 3] = m > 127 ? 255 : 0;
        }
      }
      outCtx.putImageData(outImg, 0, 0);
      results.push({ label, imageDataUrl: outCanvas.toDataURL("image/png") });
    }

    return results;
  } catch (e) {
    console.error("[AURA outfit-segmentation] failed", e);
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Per-item segmentation crop (batch scan review)
 * ------------------------------------------------------------------ */

export type NormalizedBBox = { x: number; y: number; width: number; height: number };

/** AURA wardrobe category → candidate segformer labels, in priority order. */
const CATEGORY_LABELS: Record<string, string[]> = {
  Tops: ["Upper-clothes"],
  Outerwear: ["Upper-clothes"],
  Bottoms: ["Pants", "Skirt"],
  Dresses: ["Dress"],
  Shoes: ["Shoes"],
  Bags: ["Bag"],
  Accessories: ["Belt", "Scarf", "Hat", "Sunglasses"],
  Underwear: ["Upper-clothes", "Pants"],
};

// One in-flight promise per unique photo — guarantees exactly one
// segmentation run per photo even under concurrent item processing.
const photoMaskCache = new Map<string, Promise<SegmentationMasks | null>>();

export function getSegmentationMasksCached(photoKey: string, imageDataUrl: string): Promise<SegmentationMasks | null> {
  let p = photoMaskCache.get(photoKey);
  if (!p) {
    p = runSegmentation(imageDataUrl).catch((e) => {
      console.error("[AURA outfit-segmentation] mask run failed", e);
      return null;
    });
    photoMaskCache.set(photoKey, p);
  }
  return p;
}

export function clearSegmentationCache() {
  photoMaskCache.clear();
}

function erodeDilate(mask: Uint8Array, w: number, h: number, dilate: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let hit = dilate ? false : true;
      for (let dy = -1; dy <= 1 && (dilate ? !hit : hit); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : mask[ny * w + nx];
          if (dilate) { if (v > 127) { hit = true; break; } }
          else if (v <= 127) { hit = false; break; }
        }
      }
      out[i] = hit ? 255 : 0;
    }
  }
  return out;
}

type Component = { pixels: number[]; minX: number; minY: number; maxX: number; maxY: number };

function connectedComponents(mask: Uint8Array, w: number, h: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const comps: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] <= 127 || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const comp: Component = { pixels: [], minX: w, minY: h, maxX: -1, maxY: -1 };
    while (stack.length) {
      const idx = stack.pop() as number;
      const x = idx % w, y = (idx / w) | 0;
      comp.pixels.push(idx);
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      const neigh = [
        x > 0 ? idx - 1 : -1,
        x < w - 1 ? idx + 1 : -1,
        y > 0 ? idx - w : -1,
        y < h - 1 ? idx + w : -1,
      ];
      for (const n of neigh) {
        if (n >= 0 && !seen[n] && mask[n] > 127) { seen[n] = 1; stack.push(n); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

/**
 * Build a per-pixel cutout for ONE detected item by intersecting the semantic
 * mask for its category with the item's AI bounding box, cleaning the mask,
 * and keeping only the connected component that belongs to this item.
 * Compositing/cropping happens at the ORIGINAL photo resolution.
 * Returns null when there is no confident match (caller should fall back).
 */
export async function cropItemFromSegmentation(
  photoKey: string,
  photoDataUrl: string,
  category: string,
  bbox: NormalizedBBox | null,
): Promise<string | null> {
  try {
    if (!bbox) return null;
    const seg = await getSegmentationMasksCached(photoKey, photoDataUrl);
    if (!seg) return null;
    const { maskWidth: mw, maskHeight: mh, masksByLabel } = seg;

    const candidates = CATEGORY_LABELS[category] ?? [];
    if (!candidates.length) return null;

    const total = mw * mh;
    const minPixels = Math.floor(total * 0.015);
    const minRegionPixels = Math.max(24, Math.floor(total * 0.002));

    // bbox in mask pixel space (original + padded).
    const bx0 = Math.max(0, Math.round(bbox.x * mw));
    const by0 = Math.max(0, Math.round(bbox.y * mh));
    const bx1 = Math.min(mw, Math.round((bbox.x + bbox.width) * mw));
    const by1 = Math.min(mh, Math.round((bbox.y + bbox.height) * mh));
    const padX = Math.round((bx1 - bx0) * 0.12);
    const padY = Math.round((by1 - by0) * 0.12);
    const px0 = Math.max(0, bx0 - padX);
    const py0 = Math.max(0, by0 - padY);
    const px1 = Math.min(mw, bx1 + padX);
    const py1 = Math.min(mh, by1 + padY);
    if (px1 - px0 < 2 || py1 - py0 < 2) return null;

    let chosen: Uint8Array | null = null;
    for (const label of candidates) {
      const src = masksByLabel.get(label);
      if (!src || maskNonZero(src) < minPixels) continue;

      // Intersect with the padded bbox.
      let work: Uint8Array<ArrayBufferLike> = new Uint8Array(total);
      let kept = 0;
      for (let y = py0; y < py1; y++) {
        for (let x = px0; x < px1; x++) {
          const i = y * mw + x;
          if (src[i] > 127) { work[i] = 255; kept++; }
        }
      }
      if (kept < minRegionPixels) continue;

      // Conservative cleanup: 1px opening then closing.
      work = erodeDilate(work, mw, mh, false);
      work = erodeDilate(work, mw, mh, true);
      work = erodeDilate(work, mw, mh, true);
      work = erodeDilate(work, mw, mh, false);

      // Keep the component that best overlaps the ORIGINAL bbox.
      const comps = connectedComponents(work, mw, mh).filter((c) => c.pixels.length >= minRegionPixels);
      if (!comps.length) continue;

      let best: Component | null = null;
      let bestScore = -1;
      const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
      for (const c of comps) {
        let overlap = 0;
        let sx = 0, sy = 0;
        for (const idx of c.pixels) {
          const x = idx % mw, y = (idx / mw) | 0;
          sx += x; sy += y;
          if (x >= bx0 && x < bx1 && y >= by0 && y < by1) overlap++;
        }
        const ccx = sx / c.pixels.length, ccy = sy / c.pixels.length;
        const dist = Math.hypot(ccx - cx, ccy - cy) || 1;
        const score = overlap > 0 ? overlap : 1 / dist;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (!best) continue;

      const final = new Uint8Array(total);
      for (const idx of best.pixels) final[idx] = 255;
      if (best.pixels.length < minRegionPixels) continue;
      chosen = final;
      break;
    }

    if (!chosen) return null;

    // Composite at ORIGINAL resolution.
    const img = await loadImage(photoDataUrl);
    const ow = img.naturalWidth, oh = img.naturalHeight;
    if (!ow || !oh) return null;

    const box = tightBoundingBox(chosen, mw, mh);
    if (!box) return null;
    const sxScale = ow / mw, syScale = oh / mh;
    const cx0 = Math.max(0, Math.floor(box.x0 * sxScale));
    const cy0 = Math.max(0, Math.floor(box.y0 * syScale));
    const cx1 = Math.min(ow, Math.ceil(box.x1 * sxScale));
    const cy1 = Math.min(oh, Math.ceil(box.y1 * syScale));
    const cw = cx1 - cx0, ch = cy1 - cy0;
    if (cw < 4 || ch < 4) return null;

    // Draw the source at full resolution, cropped.
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, cx0, cy0, cw, ch, 0, 0, cw, ch);
    const imgData = ctx.getImageData(0, 0, cw, ch);
    const d = imgData.data;

    // Upscale mask (nearest neighbour) onto the full-res crop as alpha.
    for (let y = 0; y < ch; y++) {
      const my = Math.min(mh - 1, Math.floor((cy0 + y) / syScale));
      for (let x = 0; x < cw; x++) {
        const mx = Math.min(mw - 1, Math.floor((cx0 + x) / sxScale));
        const on = chosen[my * mw + mx] > 127;
        if (!on) d[(y * cw + x) * 4 + 3] = 0;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    if (import.meta.env.DEV) {
      console.debug("[AURA segmentation-crop]", { category, mask: [mw, mh], source: [ow, oh], crop: [cw, ch] });
    }

    return canvas.toDataURL("image/png");
  } catch (e) {
    console.error("[AURA outfit-segmentation] item crop failed", e);
    return null;
  }
}
