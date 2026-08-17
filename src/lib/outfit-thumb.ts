import { supabase } from "@/integrations/supabase/client";

/**
 * Outfit thumbnails: a small JPEG derived from the exported canvas PNG,
 * used ONLY for gallery/list views (e.g. the chat outfit picker).
 * The original `canvas_image_url` PNG stays the source of truth for
 * sharing and for the watermarked chat snapshot.
 */

export const OUTFIT_THUMB_MAX = 600;

/** Downscale an exported canvas data URL to a <=600px JPEG (q0.8). */
export async function makeOutfitThumbBlob(dataUrl: string): Promise<Blob | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("thumb source not readable"));
      i.src = dataUrl;
    });
    const scale = Math.min(1, OUTFIT_THUMB_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.8));
  } catch (e) {
    console.warn("[AURA] outfit thumb generation failed", e);
    return null;
  }
}

/** Generates + uploads the thumbnail. Returns null on any failure: the
 *  outfit save must never break because of a missing thumbnail. */
export async function uploadOutfitThumb(userId: string, dataUrl: string): Promise<string | null> {
  const blob = await makeOutfitThumbBlob(dataUrl);
  if (!blob) return null;
  const path = `${userId}/thumbs/outfit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from("outfits").upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
    cacheControl: "3600",
  });
  if (error) {
    console.warn("[AURA] outfit thumb upload failed", error);
    return null;
  }
  return path;
}

/** Grid-view source for an outfit: thumbnail when present and signed,
 *  otherwise the full canvas image (older outfits without a thumb). */
export function outfitThumbSrc(
  outfit: { canvas_image_url?: string | null; thumbnail_path?: string | null },
  signed: Record<string, string>,
): string | undefined {
  if (outfit.thumbnail_path && signed[outfit.thumbnail_path]) return signed[outfit.thumbnail_path];
  return outfit.canvas_image_url ? signed[outfit.canvas_image_url] : undefined;
}
