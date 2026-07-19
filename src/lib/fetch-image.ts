/** Shared server-side image downloader for URL imports.
 *  - 12s timeout, 8 MB hard cap (declared and streamed).
 *  - Full browser-like header set (some CDNs, e.g. Salesforce Commerce/Akamai
 *    behind luxury-brand sites, 403 anything that looks like a bot).
 *  - Retries once without Referer on 401/403 (hotlink-protected CDNs).
 *  - Last resort: images.weserv.nl proxy (some CDNs block datacenter IPs
 *    outright, so no header tweak can help from a Worker).
 *  - Chunked base64 encoding (the naive byte loop was O(n²)). */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  // Prefer jpeg/png: remove.bg (and some analyzers) reject avif.
  // webp only as a low-priority fallback; the client normalises it.
  Accept: "image/jpeg,image/png;q=0.9,image/webp;q=0.5,*/*;q=0.4",
  "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "Sec-Fetch-Dest": "image",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "same-origin",
};

export type FetchImageResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

async function timedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    return await fetch(url, { signal: ctl.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchImageAsDataUrl(
  imageUrl: string,
  referer?: string,
): Promise<FetchImageResult> {
  const blocked = (r: Response) => r.status === 401 || r.status === 403;

  let resp: Response;
  try {
    // 1. Full browser headers + Referer.
    resp = await timedFetch(imageUrl, {
      ...BROWSER_HEADERS,
      ...(referer ? { Referer: referer } : {}),
    });
    // 2. Retry without Referer (hotlink protection).
    if (blocked(resp)) {
      resp = await timedFetch(imageUrl, BROWSER_HEADERS);
    }
    // 3. Last resort: image proxy. Some CDNs block datacenter IPs at the
    //    network level; weserv fetches the image from its own edge instead.
    if (blocked(resp)) {
      const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}`;
      resp = await timedFetch(proxied, {
        "User-Agent": UA,
        Accept: "image/jpeg,image/png;q=0.9,image/webp;q=0.5,*/*;q=0.4",
      });
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
