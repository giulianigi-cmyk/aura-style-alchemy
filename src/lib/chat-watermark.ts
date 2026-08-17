import { supabase } from "@/integrations/supabase/client";

/**
 * Burns a discreet sender watermark into an outfit snapshot and uploads it as a
 * NEW object in the `outfits` bucket, used only for chat shares
 * (message_references.snapshot_image_url).
 *
 * Never mutates the original outfit `canvas_image_url`, the shared library, or
 * the community feed images: every share produces its own distinct file.
 */

const BUCKET = "outfits";

async function loadSourceImage(pathOrUrl: string): Promise<HTMLImageElement> {
  let src = pathOrUrl;
  if (!/^https?:\/\//i.test(pathOrUrl) && !pathOrUrl.startsWith("data:")) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pathOrUrl, 300);
    if (error || !data?.signedUrl) throw error ?? new Error("Immagine outfit non disponibile");
    src = data.signedUrl;
  }
  // Fetch as blob so the canvas never gets tainted by cross-origin pixels.
  const res = await fetch(src);
  if (!res.ok) throw new Error("Immagine outfit non scaricabile");
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Immagine outfit non leggibile"));
      img.src = objectUrl;
    });
  } finally {
    // Revoked after decode on the next tick to keep Safari happy.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }
}

/** Draws the watermark bottom-left with an adaptive ink colour: samples the
 *  pixels under the text area and picks black or white accordingly. */
function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, label: string) {
  const size = Math.max(14, Math.round(Math.min(w, h) * 0.032));
  const pad = Math.round(size * 1.1);

  ctx.save();
  ctx.font = `500 ${size}px ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  try {
    ctx.letterSpacing = `${Math.round(size * 0.08)}px`;
  } catch {
    /* letterSpacing unsupported */
  }

  const x = pad;
  const y = h - pad;

  // Sample exactly the glyph box: from the baseline upwards (ascent), not below it.
  const m = ctx.measureText(label);
  const ascent = m.actualBoundingBoxAscent || size * 0.72;
  const descent = m.actualBoundingBoxDescent || size * 0.2;
  const textW = Math.ceil(m.width) || size * 4;

  const boxX = Math.max(0, Math.floor(x));
  const boxY = Math.max(0, Math.floor(y - ascent));
  const boxW = Math.max(1, Math.min(Math.ceil(textW), w - boxX));
  const boxH = Math.max(1, Math.min(Math.ceil(ascent + descent), h - boxY));

  let ink = "255,255,255";
  let luma = 0;
  let sampled = false;
  try {
    const { data } = ctx.getImageData(boxX, boxY, boxW, boxH);
    let sum = 0;
    let count = 0;
    // step over whole pixels (multiple of 4) to keep channel alignment
    const step = 4 * Math.max(1, Math.floor((boxW * boxH) / 4000));
    for (let i = 0; i + 3 < data.length; i += step) {
      const a = data[i + 3] / 255;
      // pixels are composited over the white base we painted first
      const r = data[i] * a + 255 * (1 - a);
      const g = data[i + 1] * a + 255 * (1 - a);
      const b = data[i + 2] * a + 255 * (1 - a);
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      count++;
    }
    if (count) {
      luma = sum / count;
      sampled = true;
      ink = luma >= 140 ? "0,0,0" : "255,255,255";
    }
  } catch (e) {
    // Tainted canvas: we cannot know the background -> white reads better on
    // photos than black, and stays visible on mid tones.
    console.warn("[watermark] getImageData failed, defaulting to white ink", e);
  }
  console.log("[watermark] luma", sampled ? Math.round(luma) : "n/a", "ink", ink, {
    boxX,
    boxY,
    boxW,
    boxH,
  });

  ctx.fillStyle = `rgba(${ink},0.78)`;
  ctx.fillText(label, x, y);
  ctx.restore();
}



function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export non riuscito"))), "image/png", 0.95);
  });
}

/**
 * @returns the storage path of the freshly created watermarked snapshot.
 */
export async function createWatermarkedChatSnapshot(params: {
  sourcePath: string;
  senderId: string;
  senderUsername: string | null;
}): Promise<string> {
  const img = await loadSourceImage(params.sourcePath);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1000;
  canvas.height = img.naturalHeight || 1250;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponibile");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const handle = params.senderUsername?.trim() || "aura";
  drawWatermark(ctx, canvas.width, canvas.height, `@${handle} · AURA`);

  const blob = await canvasToBlob(canvas);
  const path = `${params.senderId}/chat/share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/png",
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
}
