/**
 * Trims excess white/transparent margin around a garment photo — pure
 * pixel-scan, no model involved. A pixel counts as "background" if it's
 * either fully transparent (already background-removed) or near-pure-white
 * (the plain white backdrop every AURA photo is composited/cropped onto).
 * Finds the tight bounding box of everything else, adds a small safety
 * margin so nothing gets clipped, and crops to that.
 *
 * Skips images that are already tightly cropped (the savings would be
 * under MIN_TRIM_FRACTION of the area) — no point re-uploading a photo
 * that wouldn't visibly change.
 */

const WHITE_THRESHOLD = 248; // R,G,B all above this = "white"
const ALPHA_THRESHOLD = 12; // below this = "transparent"
const PADDING_FRACTION = 0.05; // safety margin kept around the detected content
const MIN_TRIM_FRACTION = 0.08; // skip if the crop wouldn't shrink the area by at least this much

export type TrimResult = { dataUrl: string; changed: boolean };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

export async function trimWhiteMargins(src: string): Promise<TrimResult> {
  const img = await loadImage(src);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return { dataUrl: src, changed: false };

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl: src, changed: false };
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      const isBackground = a < ALPHA_THRESHOLD || (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD);
      if (!isBackground) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return { dataUrl: src, changed: false }; // nothing found (blank photo) — leave it alone

  const padX = Math.round((maxX - minX) * PADDING_FRACTION);
  const padY = Math.round((maxY - minY) * PADDING_FRACTION);
  const x0 = Math.max(0, minX - padX);
  const y0 = Math.max(0, minY - padY);
  const x1 = Math.min(w, maxX + 1 + padX);
  const y1 = Math.min(h, maxY + 1 + padY);
  const cw = x1 - x0, ch = y1 - y0;

  const originalArea = w * h;
  const croppedArea = cw * ch;
  if (originalArea === 0 || (originalArea - croppedArea) / originalArea < MIN_TRIM_FRACTION) {
    return { dataUrl: src, changed: false }; // already tight — not worth re-saving
  }

  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  const outCtx = out.getContext("2d");
  if (!outCtx) return { dataUrl: src, changed: false };
  outCtx.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);

  return { dataUrl: out.toDataURL("image/png"), changed: true };
}

/** File-based wrapper for upload flows that work with File objects
 *  (AddItem, OutfitScan) rather than raw data URLs (BatchReview already
 *  has a data URL at the point it needs this, so it calls
 *  trimWhiteMargins directly). Never throws — a trim failure just means
 *  the original file is used unchanged, so it's never the reason a save
 *  fails. */
export async function trimFileMargins(file: File): Promise<File> {
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(file);
    });
    const result = await trimWhiteMargins(dataUrl);
    if (!result.changed) return file;
    const blob = await (await fetch(result.dataUrl)).blob();
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".png", { type: "image/png" });
  } catch (e) {
    console.warn("[AURA auto-crop] trim failed, using original file", e);
    return file;
  }
}
