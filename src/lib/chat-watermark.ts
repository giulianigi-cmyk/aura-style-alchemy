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

/** Draws the watermark bottom-left: dark text with a light halo, so it stays
 *  legible on both light and dark backgrounds. */
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

  // Halo / outline for contrast on dark imagery.
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.globalAlpha = 1;
  ctx.strokeText(label, x, y);

  // Soft shadow + semi-transparent ink for contrast on light imagery.
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.max(2, size * 0.25);
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.globalAlpha = 0.45;
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
