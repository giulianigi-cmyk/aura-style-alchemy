import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getBrandFromUrl } from "./brand-domains";

const InputSchema = z.object({
  url: z.string().url(),
});


function pickMeta(html: string, property: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtml(m[1]);
  }
  return "";
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

type ProductJson = {
  name?: string;
  brand?: string | { name?: string };
  image?: string | string[];
  offers?: { price?: string | number; priceCurrency?: string } | Array<{ price?: string | number; priceCurrency?: string }>;
};

function parseJsonLd(html: string): ProductJson | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of items) {
        const type = it?.["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
          return it as ProductJson;
        }
        if (Array.isArray(it?.["@graph"])) {
          for (const g of it["@graph"]) {
            const t = g?.["@type"];
            if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return g as ProductJson;
          }
        }
      }
    } catch { /* ignore malformed JSON-LD blocks */ }
  }
  return null;
}

const HARD_BLOCK_STATUSES = new Set([401, 403, 503]);

async function firecrawlScrape(url: string): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ url, formats: ["rawHtml", "html"], onlyMainContent: false }),
    });
    if (!r.ok) return null;
    const data = await r.json() as { data?: { rawHtml?: string; html?: string } };
    return data.data?.rawHtml || data.data?.html || null;
  } catch (e) {
    console.warn("[AURA import-url] firecrawl failed", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const importProductFromUrl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const target = new URL(data.url);

    // 1. Try direct fetch with an 8s hard timeout.
    let html: string | null = null;
    let hardBlocked = false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const resp = await fetch(target.toString(), {
        redirect: "follow",
        signal: ctl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (resp.ok) {
        html = await resp.text();
      } else if (HARD_BLOCK_STATUSES.has(resp.status)) {
        hardBlocked = true;
      } else {
        return { ok: false as const, error: `Site returned ${resp.status}. It may be blocking scraping.` };
      }
    } catch (err) {
      console.warn("[AURA import-url] fetch failed", err);
      // fall through to Firecrawl fallback
    } finally {
      clearTimeout(timer);
    }

    // 2. Fallback to Firecrawl on block/timeout/error.
    if (!html) {
      const fc = await firecrawlScrape(target.toString());
      if (!fc) {
        return {
          ok: false as const,
          error: hardBlocked
            ? "This site blocks automated imports. Try a different URL or add the item manually."
            : "Could not reach that URL. Try a different link or add the item manually.",
        };
      }
      html = fc;
    }

    // 2. Extract metadata
    const jsonLd = parseJsonLd(html);
    const ogImage = pickMeta(html, "og:image") || pickMeta(html, "og:image:secure_url") || pickMeta(html, "twitter:image");
    const ogTitle = pickMeta(html, "og:title") || pickMeta(html, "twitter:title");
    const ldImage = Array.isArray(jsonLd?.image) ? jsonLd?.image[0] : (jsonLd?.image as string | undefined);
    const imageUrlRaw = (ldImage || ogImage || "").trim();

    if (!imageUrlRaw) {
      return { ok: false as const, error: "No product image found on that page." };
    }

    const imageUrl = new URL(imageUrlRaw, target).toString();

    // 3. Download the image
    let imageDataUrl: string;
    try {
      const imgResp = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Referer: target.origin,
        },
      });
      if (!imgResp.ok) {
        return { ok: false as const, error: `Could not download the product image (${imgResp.status}).` };
      }
      const contentType = imgResp.headers.get("content-type") || "image/jpeg";
      const buf = new Uint8Array(await imgResp.arrayBuffer());
      // Encode to base64 (Uint8Array → base64) without Node Buffer dependency.
      let binary = "";
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
      const b64 = btoa(binary);
      imageDataUrl = `data:${contentType};base64,${b64}`;
    } catch (err) {
      console.warn("[AURA import-url] image download failed", err);
      return { ok: false as const, error: "Could not download the product image." };
    }

    // 4. Assemble structured hints
    const brandFromLd =
      typeof jsonLd?.brand === "string"
        ? jsonLd.brand
        : jsonLd?.brand && typeof jsonLd.brand === "object"
        ? jsonLd.brand.name ?? ""
        : "";
    const brand = (brandFromLd || getBrandFromUrl(target.toString()) || "").trim();
    const title = (jsonLd?.name || ogTitle || "").trim();

    let price: string | null = null;
    const offer = Array.isArray(jsonLd?.offers) ? jsonLd?.offers[0] : jsonLd?.offers;
    if (offer?.price) {
      const currency = offer.priceCurrency ? ` ${offer.priceCurrency}` : "";
      price = `${offer.price}${currency}`;
    }

    return {
      ok: true as const,
      imageDataUrl,
      brand,
      title,
      price,
      sourceUrl: target.toString(),
    };
  });
