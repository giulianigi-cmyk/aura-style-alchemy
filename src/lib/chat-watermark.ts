import { supabase } from "@/integrations/supabase/client";

/**
 * Produces a fresh, standalone copy of an outfit canvas for a chat share
 * (message_references.snapshot_image_url) — no watermark burned in anymore
 * (that used to duplicate the "aura" mark already on the canvas itself, see
 * OutfitBuilder.tsx, and was too small to read regardless).
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
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas non disponibile");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // The sender-handle watermark ("@handle · AURA") used to be burned in here,
  // stacked on top of the outfit canvas's own "aura" signature — redundant,
  // and too small to read either way. Removed: the canvas's own mark (now
  // sized up in OutfitBuilder.tsx) is the only watermark now. senderId is
  // still needed below for the storage path.

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
