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
  ctx.letterSpacing = `${Math.round(size * 0.08)}px`;

  const x = pad;
  const y = h - pad;

  // Sample the background under the future text box.
  const textW = Math.min(Math.ceil(ctx.measureText(label).width) + size, w - x);
  const boxX = Math.max(0, x);
  const boxY = Math.max(0, Math.round(y - size));
  const boxW = Math.max(1, Math.min(textW, w - boxX));
  const boxH = Math.max(1, Math.min(Math.round(size * 1.4), h - boxY));

  let ink = "0,0,0";
  try {
    const { data } = ctx.getImageData(boxX, boxY, boxW, boxH);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4 * 6) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count++;
    }
    const luma = count ? sum / count : 255;
    ink = luma > 140 ? "0,0,0" : "255,255,255";
  } catch {
    /* tainted canvas — keep the default dark ink */
  }

  ctx.fillStyle = `rgba(${ink},0.75)`;
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
