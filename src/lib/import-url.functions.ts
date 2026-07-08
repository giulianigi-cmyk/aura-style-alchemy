import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getBrandFromUrl } from "./brand-domains";

const InputSchema = z.object({
  url: z.string().url(),
});

// Sites that block scraping or serve JS-rendered pages — go straight to Firecrawl.
const HARD_BLOCK_DOMAINS = new Set([
  "zalando.com", "zalando.it", "zara.com", "hm.com", "asos.com", "farfetch.com",
  "cos.com", "net-a-porter.com", "mytheresa.com", "gucci.com", "prada.com",
  "louisvuitton.com", "dior.com", "chanel.com", "ssense.com", "matchesfashion.com",
  "revolve.com", "shopbop.com", "nordstrom.com", "about.com",
]);

const RETRY_STATUSES = new Set([401, 403, 429, 503]);

const MODEL_KEYWORDS = /(model|look|worn|outfit|person|lifestyle|editorial|campaign|onbody|on-body)/i;
const PRODUCT_KEYWORDS = /(flat|back|detail|still|product|front|packshot|closeup|close-up)/i;
const JUNK_KEYWORDS = /(logo|sprite|placeholder|icon-|favicon|thumb|swatch|badge|banner)/i;

const FIRECRAWL_MISSING_MSG =
  "This site requires enhanced import — add your Firecrawl key in settings to enable it.";

function rootDomain(u: URL): string {
  const host = u.hostname.replace(/^www\d*\./, "");
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

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

function collectImages(html: string, base: URL, jsonLd: ProductJson | null): string[] {
  const set = new Set<string>();
  const push = (v?: string | null) => {
    if (!v) return;
    const t = decodeHtml(v.trim());
    if (!t || t.startsWith("data:")) return;
    try { set.add(new URL(t, base).toString()); } catch { /* ignore */ }
  };
  push(pickMeta(html, "og:image"));
  push(pickMeta(html, "og:image:secure_url"));
  push(pickMeta(html, "twitter:image"));
  if (jsonLd?.image) {
    if (Array.isArray(jsonLd.image)) jsonLd.image.forEach(push);
    else push(jsonLd.image);
  }
  const imgRe = /<img[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const attr = (name: string) => {
      const re = new RegExp(`\\s${name}=["']([^"']+)["']`, "i");
      return tag.match(re)?.[1] ?? null;
    };
    push(attr("src"));
    push(attr("data-src"));
    push(attr("data-lazy-src"));
    push(attr("data-original"));
    const srcset = attr("srcset") ?? attr("data-srcset");
    if (srcset) {
      srcset.split(",").forEach((part) => push(part.trim().split(/\s+/)[0]));
    }
  }
  return Array.from(set);
}

function scoreImage(url: string): number {
  const u = url.toLowerCase();
  let s = 0;
  if (JUNK_KEYWORDS.test(u)) s -= 20;
  if (MODEL_KEYWORDS.test(u)) s -= 6;
  if (PRODUCT_KEYWORDS.test(u)) s += 4;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(u)) s += 1;
  return s;
}

function pickBestImage(candidates: string[]): string | null {
  if (!candidates.length) return null;
  const scored = candidates
    .map((u) => ({ u, s: scoreImage(u) }))
    .filter((x) => x.s > -10)
    .sort((a, b) => b.s - a.s);
  return scored[0]?.u ?? null;
}

async function firecrawlScrape(url: string): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
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

async function directFetch(target: URL): Promise<{ html: string | null; blocked: boolean }> {
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
    if (resp.ok) return { html: await resp.text(), blocked: false };
    if (RETRY_STATUSES.has(resp.status)) return { html: null, blocked: true };
    return { html: null, blocked: false };
  } catch (err) {
    console.warn("[AURA import-url] fetch failed", err);
    return { html: null, blocked: true };
  } finally {
    clearTimeout(timer);
  }
}

export const importProductFromUrl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const target = new URL(data.url);
    const domain = rootDomain(target);
    const hasFirecrawl = Boolean(process.env.FIRECRAWL_API_KEY);
    const forceFirecrawl = HARD_BLOCK_DOMAINS.has(domain);

    let html: string | null = null;
    let blocked = false;

    if (forceFirecrawl) {
      if (!hasFirecrawl) return { ok: false as const, error: FIRECRAWL_MISSING_MSG };
      html = await firecrawlScrape(target.toString());
    } else {
      const direct = await directFetch(target);
      html = direct.html;
      blocked = direct.blocked;
    }

    // 2. Parse & pick the best product image; fallback to Firecrawl if nothing usable.
    let imageUrlRaw = "";
    let jsonLd: ProductJson | null = null;
    let ogTitle = "";

    const parsePick = (source: string): string => {
      const parsed: ProductJson | null = parseJsonLd(source);
      jsonLd = parsed;
      ogTitle = pickMeta(source, "og:title") || pickMeta(source, "twitter:title");
      const candidates = collectImages(source, target, parsed);
      return pickBestImage(candidates) ?? "";
    };


    if (html) imageUrlRaw = parsePick(html);

    if (!imageUrlRaw && !forceFirecrawl) {
      // Direct fetch didn't yield a usable image (blocked, empty, or only model shots) — try Firecrawl.
      if (!hasFirecrawl) {
        return {
          ok: false as const,
          error: blocked
            ? FIRECRAWL_MISSING_MSG
            : "No product image found on that page. Try a different link or add the item manually.",
        };
      }
      const fc = await firecrawlScrape(target.toString());
      if (fc) {
        html = fc;
        imageUrlRaw = parsePick(fc);
      }
    }

    if (!imageUrlRaw) {
      return {
        ok: false as const,
        error: blocked
          ? "This site blocks automated imports. Try a different URL or add the item manually."
          : "No product image found on that page.",
      };
    }

    const imageUrl = new URL(imageUrlRaw, target).toString();

    // 3. Download the image with a 12s timeout (some CDNs are slow).
    let imageDataUrl: string;
    const imgCtl = new AbortController();
    const imgTimer = setTimeout(() => imgCtl.abort(), 12000);
    try {
      const imgResp = await fetch(imageUrl, {
        signal: imgCtl.signal,
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
      let binary = "";
      for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
      const b64 = btoa(binary);
      imageDataUrl = `data:${contentType};base64,${b64}`;
    } catch (err) {
      console.warn("[AURA import-url] image download failed", err);
      return { ok: false as const, error: "Could not download the product image." };
    } finally {
      clearTimeout(imgTimer);
    }

    // 4. Structured hints
    const ld = jsonLd as ProductJson | null;
    const brandFromLd =
      typeof ld?.brand === "string"
        ? ld.brand
        : ld?.brand && typeof ld.brand === "object"
        ? ld.brand.name ?? ""
        : "";
    const brand = (brandFromLd || getBrandFromUrl(target.toString()) || "").trim();
    const title = (ld?.name || ogTitle || "").trim();

    let price: string | null = null;
    const offer = Array.isArray(ld?.offers) ? ld?.offers[0] : ld?.offers;
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
