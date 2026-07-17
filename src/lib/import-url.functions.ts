import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getBrandFromUrl } from "./brand-domains";

const InputSchema = z.object({
  url: z.string().url(),
  // Supabase session token — required only for Firecrawl-powered imports,
  // where we enforce a per-user daily quota.
  accessToken: z.string().optional(),
});

// Firecrawl is a paid, metered API: cap per-user usage. Direct fetches
// (no Firecrawl involved) are never counted.
const FIRECRAWL_DAILY_LIMIT = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

const RATE_LIMIT_MSG =
  "You've reached today's limit for enhanced imports. Try again tomorrow, or add the item manually.";
const SIGNIN_FOR_FALLBACK_MSG =
  "Sign in to use enhanced import on this site.";

// Sites that block scraping or serve JS-rendered pages — go straight to Firecrawl.
const HARD_BLOCK_DOMAINS = new Set([
  "zalando.com", "zalando.it", "zara.com", "hm.com", "asos.com", "farfetch.com",
  "cos.com", "net-a-porter.com", "mytheresa.com", "gucci.com", "prada.com",
  "louisvuitton.com", "dior.com", "chanel.com", "ssense.com", "matchesfashion.com",
  "revolve.com", "shopbop.com", "nordstrom.com", "victoriabeckham.com",
]);

const RETRY_STATUSES = new Set([401, 403, 429, 503]);

// Section identifiers we always strip from HTML before DOM-scanning for images.
// These regexes match class, id, data-testid, aria-label — any attribute that
// hints the block is unrelated to the current product.
const EXCLUDED_SECTION_KEYWORDS = [
  "related", "recommend", "similar", "complete-the-look", "complete_the_look",
  "you-may-also", "you-might-also", "recently-viewed", "recently_viewed",
  "cross-sell", "cross_sell", "upsell", "up-sell", "also-bought", "also_bought",
  "shop-the-look", "shop_the_look", "editorial", "carousel-recommend",
  "product-recommendations", "product_recommendations", "suggestions",
  "footer", "site-header", "site_header", "site-nav", "site_nav",
];

const FIRECRAWL_MISSING_MSG =
  "This site requires enhanced import — add your Firecrawl key in settings to enable it.";

// ---------- helpers ---------------------------------------------------------

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

/** <title> tag content, with the site-name suffix stripped
 *  ("Linen midi skirt | COS" → "Linen midi skirt"). */
function pickTitleTag(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return decodeHtml(m[1]).trim().split(/\s*[|–—·]\s*/)[0].trim();
}

/** Last resort: humanise the URL slug ("/linen-midi-skirt-p12345.html"
 *  → "Linen Midi Skirt"). Skips numeric/product-code tokens. */
function humanizeSlug(u: URL): string {
  const segs = u.pathname.split("/").filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const clean = segs[i].replace(/\.(html?|php|aspx?)$/i, "");
    const words = clean
      .split(/[-_]+/)
      .filter((w) => w && !/^\d+$/.test(w) && !/^p\d{4,}$/i.test(w) && w.length <= 20);
    if (words.length >= 2) {
      return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    }
  }
  return "";
}

/** Remove script/style/noscript/template/svg and any element whose
 *  opening tag contains an excluded keyword in class, id, data-* or aria-label. */
function stripExcludedSections(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<template[\s\S]*?<\/template>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "");

  // Aggressive: for each excluded keyword, drop the containing element
  // (best-effort — matches simple, non-nested cases; a related block that
  // survives still gets penalised in scoring below).
  for (const kw of EXCLUDED_SECTION_KEYWORDS) {
    const re = new RegExp(
      `<(section|div|aside|ul|ol)[^>]*(?:class|id|data-[a-z-]+|aria-label)=["'][^"']*${kw}[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
      "gi",
    );
    // Repeat until stable — some sites have nested wrappers.
    let prev = "";
    while (prev !== out) {
      prev = out;
      out = out.replace(re, "");
    }
  }
  return out;
}

// ---------- JSON-LD ---------------------------------------------------------

type ProductJson = {
  "@type"?: string | string[];
  name?: string;
  sku?: string;
  productID?: string;
  url?: string;
  brand?: string | { name?: string };
  image?: string | string[] | { url?: string } | Array<{ url?: string }>;
  offers?:
    | { price?: string | number; priceCurrency?: string; url?: string }
    | Array<{ price?: string | number; priceCurrency?: string; url?: string }>;
};

function isProductType(t: unknown): boolean {
  if (typeof t === "string") return t.toLowerCase().includes("product");
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && x.toLowerCase().includes("product"));
  return false;
}

/** Collect every JSON-LD Product node in document order. Includes @graph and
 *  nested arrays. Ignores non-Product entities. */
function collectProductNodes(html: string): ProductJson[] {
  const nodes: ProductJson[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (isProductType(obj["@type"])) nodes.push(obj as ProductJson);
    if (Array.isArray(obj["@graph"])) obj["@graph"].forEach(walk);
    // Some sites nest a Product inside "mainEntity" / "hasVariant".
    if (obj.mainEntity) walk(obj.mainEntity);
    if (obj.hasVariant) walk(obj.hasVariant);
  };
  while ((m = re.exec(html)) !== null) {
    try { walk(JSON.parse(m[1].trim())); }
    catch { /* ignore malformed JSON-LD */ }
  }
  return nodes;
}

/** Slug tokens from the URL path — used to match the Product node that
 *  corresponds to the URL when the page ships multiple Product nodes. */
function urlSlugTokens(u: URL): string[] {
  const parts = u.pathname.toLowerCase().split(/[/_-]+/).filter(Boolean);
  return parts.filter((p) => p.length >= 3 && !/^\d+$/.test(p));
}

function nodeMatchesUrl(node: ProductJson, target: URL): boolean {
  const canonicals: string[] = [];
  if (typeof node.url === "string") canonicals.push(node.url);
  const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [];
  offers.forEach((o) => { if (o?.url) canonicals.push(o.url); });
  for (const c of canonicals) {
    try {
      const cu = new URL(c, target);
      if (cu.pathname === target.pathname) return true;
    } catch { /* ignore */ }
  }
  const slug = urlSlugTokens(target);
  if (!slug.length) return false;
  const name = (node.name ?? "").toLowerCase();
  if (!name) return false;
  const overlap = slug.filter((tok) => name.includes(tok)).length;
  return overlap >= Math.min(2, slug.length);
}

function jsonLdImages(node: ProductJson): string[] {
  const img = node.image;
  if (!img) return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && typeof (v as { url?: string }).url === "string") {
      out.push((v as { url: string }).url);
    }
  };
  if (Array.isArray(img)) img.forEach(push);
  else push(img);
  return out;
}

/** Pick the Product node most likely to represent the URL. */
function selectProductNode(nodes: ProductJson[], target: URL): ProductJson | null {
  if (!nodes.length) return null;
  if (nodes.length === 1) return nodes[0];
  const matched = nodes.find((n) => nodeMatchesUrl(n, target));
  return matched ?? nodes[0];
}

// ---------- DOM image fallback ---------------------------------------------

const MODEL_KEYWORDS = /(model|worn|lifestyle|editorial|campaign|onbody|on-body|lookbook)/i;
const PRODUCT_KEYWORDS = /(product|packshot|flat|still|front|back|detail|closeup|close-up|main-image|main_image|primary)/i;
const JUNK_KEYWORDS = /(logo|sprite|placeholder|icon-|favicon|thumbnail|swatch|badge|banner|arrow|chevron|pixel\.gif|tracking)/i;
const RELATED_URL_KEYWORDS = /(related|recommend|similar|cross-sell|upsell|editorial|carousel|thumbnail|swatch)/i;

function collectDomImages(html: string, base: URL): string[] {
  const set = new Set<string>();
  const push = (v?: string | null) => {
    if (!v) return;
    const t = decodeHtml(v.trim());
    if (!t || t.startsWith("data:")) return;
    try { set.add(new URL(t, base).toString()); } catch { /* ignore */ }
  };
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
    push(attr("data-zoom-image"));
    const srcset = attr("srcset") ?? attr("data-srcset");
    if (srcset) {
      // Pick the widest candidate in the srcset.
      const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
      let bestUrl: string | null = null;
      let bestW = -1;
      for (const p of parts) {
        const [u, w] = p.split(/\s+/);
        const width = w?.endsWith("w") ? parseInt(w) : 0;
        if (width > bestW) { bestW = width; bestUrl = u; }
      }
      push(bestUrl);
    }
  }
  return Array.from(set);
}

function scoreImage(url: string, productTokens: string[]): number {
  const u = url.toLowerCase();
  let s = 0;
  if (JUNK_KEYWORDS.test(u)) s -= 30;
  if (RELATED_URL_KEYWORDS.test(u)) s -= 15;
  if (PRODUCT_KEYWORDS.test(u)) s += 5;
  if (MODEL_KEYWORDS.test(u)) s -= 2;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(u)) s += 1;
  // Boost if URL references the product slug.
  for (const tok of productTokens) {
    if (tok.length >= 4 && u.includes(tok)) { s += 4; break; }
  }
  // Prefer larger declared widths (query params like ?w=1200 or _1200_).
  const wMatch = u.match(/[_?&](?:w|width)[=_]?(\d{3,4})/);
  if (wMatch) {
    const w = parseInt(wMatch[1]);
    if (w >= 1000) s += 3;
    else if (w >= 600) s += 1;
  }
  return s;
}

function pickBestImage(candidates: string[], productTokens: string[]): string | null {
  if (!candidates.length) return null;
  const scored = candidates
    .map((u, i) => ({ u, s: scoreImage(u, productTokens), i }))
    .filter((x) => x.s > -20)
    // On sites with no descriptive filenames (e.g. Zara), everything ties
    // near 0 and the gallery's FIRST image is usually the on-model hero
    // shot, not the flat product photo — which tends to appear a little
    // further into the gallery. So on ties, prefer images that appear
    // slightly later rather than defaulting to the very first one.
    .sort((a, b) => (b.s - a.s) || (a.i === 0 ? 1 : b.i === 0 ? -1 : a.i - b.i));
  return scored[0]?.u ?? null;
}

// ---------- Fallback scraper (pluggable) -----------------------------------

type FallbackScraper = (url: string) => Promise<string | null>;

const firecrawlScrape: FallbackScraper = async (url) => {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
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
};

const fallbackScraper: FallbackScraper = firecrawlScrape;

// ---------- Per-user Firecrawl quota ----------------------------------------

type CreditResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "auth" | "limit" };

/** Verify the user via their Supabase session token and atomically consume
 *  one Firecrawl credit through the consume_firecrawl_credit RPC.
 *  Fails open (allows) only on infrastructure errors — never on auth/limit. */
async function consumeFirecrawlCredit(accessToken?: string): Promise<CreditResult> {
  if (!accessToken) return { ok: false, reason: "auth" };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.warn("[AURA import-url] Supabase env missing — skipping rate limit");
    return { ok: true, remaining: -1 };
  }
  try {
    const r = await fetch(`${url}/rest/v1/rpc/consume_firecrawl_credit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ p_daily_limit: FIRECRAWL_DAILY_LIMIT }),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "auth" };
    if (!r.ok) {
      console.warn("[AURA import-url] credit RPC failed", r.status);
      return { ok: true, remaining: -1 }; // fail open on infra errors
    }
    const rows = (await r.json()) as Array<{ allowed: boolean; remaining: number }>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return { ok: true, remaining: -1 };
    return row.allowed
      ? { ok: true, remaining: row.remaining }
      : { ok: false, reason: "limit" };
  } catch (err) {
    console.warn("[AURA import-url] credit RPC error", err);
    return { ok: true, remaining: -1 };
  }
}
const fallbackScraperAvailable = () => {
  const key = process.env.FIRECRAWL_API_KEY;
  // Temporary diagnostic — tells us whether the key is truly missing from
  // this runtime, or present but somehow rejected downstream. Safe to log:
  // only the length is printed, never the key itself. Remove once confirmed.
  console.log("[AURA import-url] FIRECRAWL_API_KEY present:", Boolean(key), "length:", key?.length ?? 0);
  return Boolean(key);
};

// ---------- Direct fetch ----------------------------------------------------

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

// ---------- Extraction orchestrator ----------------------------------------

type ExtractionMethod = "json-ld" | "og-image" | "dom" | "none";
export type ImportConfidence = "high" | "medium" | "low";
type Extracted = {
  imageUrl: string;
  method: ExtractionMethod;
  confidence: ImportConfidence;
  productNode: ProductJson | null;
  ogTitle: string;
};

function extractFromHtml(html: string, target: URL): Extracted {
  // Step 1 — JSON-LD Product entity. This is the highest-fidelity signal
  // because it explicitly binds an image to a specific Product.
  const productNodes = collectProductNodes(html);
  const productNode = selectProductNode(productNodes, target);

  if (productNode) {
    const imgs = jsonLdImages(productNode)
      .map((u) => { try { return new URL(u, target).toString(); } catch { return null; } })
      .filter((u): u is string => u !== null && !JUNK_KEYWORDS.test(u.toLowerCase()));
    if (imgs.length) {
      return { imageUrl: imgs[0], method: "json-ld", confidence: "high", productNode, ogTitle: pickMeta(html, "og:title") };
    }
  }

  const ogTitle = pickMeta(html, "og:title") || pickMeta(html, "twitter:title");

  // Step 2 — OG image, but only if it looks like a product image (not a
  // generic site OG). We validate by checking it isn't obviously junk and
  // that a Product entity exists on the page (or the URL slug matches).
  const og = pickMeta(html, "og:image") || pickMeta(html, "og:image:secure_url") || pickMeta(html, "twitter:image");
  if (og) {
    try {
      const abs = new URL(og, target).toString();
      const junky = JUNK_KEYWORDS.test(abs.toLowerCase()) || RELATED_URL_KEYWORDS.test(abs.toLowerCase());
      const looksLikeProduct = productNodes.length > 0 ||
        urlSlugTokens(target).some((t) => t.length >= 4 && abs.toLowerCase().includes(t));
      if (!junky && looksLikeProduct) {
        return { imageUrl: abs, method: "og-image", confidence: "medium", productNode, ogTitle };
      }
    } catch { /* ignore */ }
  }

  // Step 3 — DOM scan, after stripping related/recommendation/nav sections.
  const cleaned = stripExcludedSections(html);
  const candidates = collectDomImages(cleaned, target);
  const tokens = urlSlugTokens(target);
  const best = pickBestImage(candidates, tokens);
  if (best) return { imageUrl: best, method: "dom", confidence: "low", productNode, ogTitle };

  return { imageUrl: "", method: "none", confidence: "low", productNode, ogTitle };
}

// ---------- Main handler ---------------------------------------------------

export const importProductFromUrl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const target = new URL(data.url);
    const domain = rootDomain(target);
    const hasFallback = fallbackScraperAvailable();
    const forceFallback = HARD_BLOCK_DOMAINS.has(domain);

    let html: string | null = null;
    let blocked = false;
    let usedFallback = false;

    if (forceFallback) {
      if (!hasFallback) return { ok: false as const, error: FIRECRAWL_MISSING_MSG };
      const credit = await consumeFirecrawlCredit(data.accessToken);
      if (!credit.ok) {
        return {
          ok: false as const,
          error: credit.reason === "limit" ? RATE_LIMIT_MSG : SIGNIN_FOR_FALLBACK_MSG,
          rateLimited: credit.reason === "limit",
        };
      }
      html = await fallbackScraper(target.toString());
      usedFallback = true;
    } else {
      const direct = await directFetch(target);
      html = direct.html;
      blocked = direct.blocked;
    }

    let extracted: Extracted = { imageUrl: "", method: "none", confidence: "low", productNode: null, ogTitle: "" };
    if (html) extracted = extractFromHtml(html, target);

    // If direct fetch yielded nothing usable and we haven't tried the
    // fallback yet, try it now — never stop after failing OG.
    if (!extracted.imageUrl && !usedFallback) {
      if (!hasFallback) {
        return {
          ok: false as const,
          error: blocked
            ? FIRECRAWL_MISSING_MSG
            : "No product image found on that page. Try a different link or add the item manually.",
        };
      }
      const credit = await consumeFirecrawlCredit(data.accessToken);
      if (!credit.ok) {
        return {
          ok: false as const,
          error: credit.reason === "limit" ? RATE_LIMIT_MSG : SIGNIN_FOR_FALLBACK_MSG,
          rateLimited: credit.reason === "limit",
        };
      }
      const fc = await fallbackScraper(target.toString());
      if (fc) {
        html = fc;
        usedFallback = true;
        extracted = extractFromHtml(fc, target);
      }
    }

    if (!extracted.imageUrl) {
      return {
        ok: false as const,
        error: blocked
          ? "This site blocks automated imports. Try a different URL or add the item manually."
          : "No product image found on that page.",
      };
    }

    const imageUrl = new URL(extracted.imageUrl, target).toString();
    console.log(
      "[AURA import-url] extraction",
      JSON.stringify({
        domain,
        method: extracted.method,
        fallback: usedFallback,
        picked: imageUrl,
      }),
    );

    // Download the image (12s timeout for slow CDNs, 8 MB hard cap).
    // Some CDNs hotlink-protect and reject cross-site Referers — on 401/403
    // we retry once without the Referer header before giving up.
    const fetchImage = async (withReferer: boolean): Promise<Response> => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      try {
        return await fetch(imageUrl, {
          signal: ctl.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
            ...(withReferer ? { Referer: target.origin } : {}),
          },
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let imageDataUrl: string;
    try {
      let imgResp = await fetchImage(true);
      if (imgResp.status === 401 || imgResp.status === 403) {
        imgResp = await fetchImage(false);
      }
      if (!imgResp.ok) {
        return { ok: false as const, error: `Could not download the product image (${imgResp.status}).` };
      }

      const declared = parseInt(imgResp.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
        return { ok: false as const, error: "That image is too large to import (max 8 MB)." };
      }

      // Stream with a running byte cap — content-length can lie or be absent.
      const chunks: Uint8Array[] = [];
      let received = 0;
      const reader = imgResp.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > MAX_IMAGE_BYTES) {
            await reader.cancel();
            return { ok: false as const, error: "That image is too large to import (max 8 MB)." };
          }
          chunks.push(value);
        }
      } else {
        const whole = new Uint8Array(await imgResp.arrayBuffer());
        if (whole.byteLength > MAX_IMAGE_BYTES) {
          return { ok: false as const, error: "That image is too large to import (max 8 MB)." };
        }
        chunks.push(whole);
        received = whole.byteLength;
      }

      const buf = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }

      // Chunked base64 — the old byte-by-byte loop was O(n²) on string concat.
      let binary = "";
      const STEP = 0x8000;
      for (let i = 0; i < buf.length; i += STEP) {
        binary += String.fromCharCode(...buf.subarray(i, i + STEP));
      }
      const contentType = imgResp.headers.get("content-type") || "image/jpeg";
      imageDataUrl = `data:${contentType};base64,${btoa(binary)}`;
    } catch (err) {
      console.warn("[AURA import-url] image download failed", err);
      return { ok: false as const, error: "Could not download the product image." };
    }

    // Structured hints (brand/title/price) — from Product node when available.
    const ld = extracted.productNode;
    const brandFromLd =
      typeof ld?.brand === "string"
        ? ld.brand
        : ld?.brand && typeof ld.brand === "object"
        ? ld.brand.name ?? ""
        : "";
    const brand = (brandFromLd || getBrandFromUrl(target.toString()) || "").trim();
    // Title cascade: JSON-LD name → og:title → <title> tag → humanised slug.
    const title = (
      ld?.name ||
      extracted.ogTitle ||
      pickTitleTag(html ?? "") ||
      humanizeSlug(target) ||
      ""
    ).trim();

    let price: string | null = null;
    let priceValue: number | null = null;
    let priceCurrency: string | null = null;
    const offer = Array.isArray(ld?.offers) ? ld?.offers[0] : ld?.offers;
    if (offer?.price) {
      const parsed = typeof offer.price === "number" ? offer.price : parseFloat(String(offer.price).replace(",", "."));
      if (Number.isFinite(parsed)) priceValue = parsed;
      priceCurrency = offer.priceCurrency ? String(offer.priceCurrency).toUpperCase() : null;
      const currencySuffix = priceCurrency ? ` ${priceCurrency}` : "";
      price = `${offer.price}${currencySuffix}`;
    }

    return {
      ok: true as const,
      imageDataUrl,
      brand,
      title,
      price,
      priceValue,
      priceCurrency,
      sourceUrl: target.toString(),
      extractionMethod: extracted.method,
      confidence: extracted.confidence,
      usedFallback,
    };
  });
