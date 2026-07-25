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

export async function segmentOutfitPhoto(imageDataUrl: string): Promise<{ label: string; imageDataUrl: string }[]> {
  try {
    const segmenter = await getSegmenter();
    const output = await segmenter(imageDataUrl);

    // Collect per-label masks (there should be one per label).
    const byLabel = new Map<string, Uint8Array | Uint8ClampedArray>();
    let maskW = 0, maskH = 0;
    for (const seg of output) {
      if (!seg?.mask) continue;
      maskW = seg.mask.width; maskH = seg.mask.height;
      if (GARMENT_LABELS.has(seg.label)) byLabel.set(seg.label, seg.mask.data);
    }
    if (!maskW || !maskH) return [];

    // Merge shoes.
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
