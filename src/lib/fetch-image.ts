/** Shared server-side image downloader for URL imports.
 *  - 12s timeout, 8 MB hard cap (declared and streamed).
 *  - Retries once without Referer on 401/403 (hotlink-protected CDNs).
 *  - Chunked base64 encoding (the naive byte loop was O(n²)). */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type FetchImageResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

export async function fetchImageAsDataUrl(
  imageUrl: string,
  referer?: string,
): Promise<FetchImageResult> {
  const attempt = async (withReferer: boolean): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      return await fetch(imageUrl, {
        signal: ctl.signal,
        headers: {
          "User-Agent": UA,
          Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
          ...(withReferer && referer ? { Referer: referer } : {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let resp: Response;
  try {
    resp = await attempt(true);
    if (resp.status === 401 || resp.status === 403) {
      resp = await attempt(false);
    }
  } catch (err) {
    console.warn("[AURA fetch-image] download failed", err);
    return { ok: false, error: "Could not download the product image." };
  }
  if (!resp.ok) {
    return { ok: false, error: `Could not download the product image (${resp.status}).` };
  }

  const declared = parseInt(resp.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    return { ok: false, error: "That image is too large to import (max 8 MB)." };
  }

  // Stream with a running byte cap — content-length can lie or be absent.
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    const reader = resp.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return { ok: false, error: "That image is too large to import (max 8 MB)." };
        }
        chunks.push(value);
      }
    } else {
      const whole = new Uint8Array(await resp.arrayBuffer());
      if (whole.byteLength > MAX_IMAGE_BYTES) {
        return { ok: false, error: "That image is too large to import (max 8 MB)." };
      }
      chunks.push(whole);
      received = whole.byteLength;
    }
  } catch (err) {
    console.warn("[AURA fetch-image] stream failed", err);
    return { ok: false, error: "Could not download the product image." };
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }

  let binary = "";
  const STEP = 0x8000;
  for (let i = 0; i < buf.length; i += STEP) {
    binary += String.fromCharCode(...buf.subarray(i, i + STEP));
  }
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  return { ok: true, dataUrl: `data:${contentType};base64,${btoa(binary)}` };
}
