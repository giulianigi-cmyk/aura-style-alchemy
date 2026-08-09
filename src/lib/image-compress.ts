/**
 * Client-side compression, applied BEFORE anything else (AI analysis,
 * background removal, final upload) — not just before saving. A 10MB
 * photo straight off an iPhone is never needed to recognise a garment:
 * shrinking it early cuts time and timeout risk across the whole
 * pipeline, not just the upload step.
 * Never makes an already-small file worse (if the re-encoded result is
 * heavier than the original, the original is kept).
 *
 * Shared by AddItem.tsx (single-item add) and BatchScan.tsx (batch
 * upload) — previously duplicated only in AddItem, unused in BatchScan,
 * which is why batch uploads were sending full-resolution originals.
 */
export async function compressImageForUpload(f: File, maxDimension = 1600, quality = 0.85): Promise<File> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(f);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return f;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch (e) {
    console.warn("[AURA compress] failed, using original", e);
    return f;
  } finally {
    // ImageBitmap holds decoded, full-resolution pixel data (GPU/memory
    // backed) until explicitly closed — never garbage-collected on its
    // own in time to matter. Left open across a batch of 60+ photos,
    // this is exactly what pushes iOS Safari into silently killing the
    // tab partway through a large batch.
    bitmap?.close();
  }
}
