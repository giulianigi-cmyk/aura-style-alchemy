import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { getBrandFromUrl } from "./brand-domains";
import { fetchImageAsDataUrl } from "./fetch-image";
import { checkPublicUrl, safeFetch } from "./safe-url";
import { parseAiJson } from "./ai-json";

const InputSchema = z.object({
  url: z.string().url().refine((v) => checkPublicUrl(v) === null, "That address is not allowed."),
  accessToken: z.string().optional(),
});

const FIRECRAWL_DAILY_LIMIT = 10;

const RATE_LIMIT_MSG =
  "You've reached today's limit for enhanced imports. Try again tomorrow, or add the item manually.";
const SIGNIN_FOR_FALLBACK_MSG =
  "Sign in to use enhanced import on this site.";
const FIRECRAWL_FAILED_MSG =
  "Enhanced import couldn't read this site right now. Try again in a minute or add the item manually.";
const UNSCRAPABLE_MSG =
  "This site's protection is too strong for automatic import — add this piece's photo and details manually.";

const TRACKING_PARAM_RE =
  /^(utm_|gclid$|gbraid$|wbraid$|gad_|fbclid$|msclkid$|mc_|dplink$|chn$|cmp$|slink_id$|src$|tarea$|tar$|ag$|ptyp$|feed_num$)/i;

function stripTrackingParams(u: URL): URL {
  const clean = new URL(u.toString());
  const toDelete: string[] = [];
  clean.searchParams.forEach((_v, k) => {
    if (TRACKING_PARAM_RE.test(k)) toDelete.push(k);
  });
  toDelete.forEach((k) => clean.searchParams.delete(k));
  clean.hash = "";
  return clean;
}

const HARD_BLOCK_DOMAINS = new Set([
  "zalando.com", "zalando.it", "zara.com", "hm.com", "asos.com", "farfetch.com",
  "cos.com", "net-a-porter.com", "mytheresa.com", "gucci.com", "prada.com",
  "louisvuitton.com", "dior.com", "chanel.com", "ssense.com", "matchesfashion.com",
  "revolve.com", "shopbop.com", "nordstrom.com", "victoriabeckham.com",
  "sezane.com", "luisaviaroma.com",
]);

// This seed list is intentionally small — it exists only to skip a known-wasted
// first attempt for domains we've already confirmed are protected (perf, not
// correctness). Everything else is caught by looksLikeBlockedPage() below and
// self-learned into `scrape_domain_hints`, so this array never needs to be
// "complete".

const RETRY_STATUSES = new Set([401, 403, 429, 503]);

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

function pickTitleTag(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return decodeHtml(m[1]).trim().split(/\s*[|–—·]\s*/)[0].trim();
}

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

  for (const kw of EXCLUDED_SECTION_KEYWORDS) {
    const re = new RegExp(
      `<(section|div|aside|ul|ol)[^>]*(?:class|id|data-[a-z-]+|aria-label)=["'][^"']*${kw}[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
      "gi",
    );
    let prev = "";
    while (prev !== out) {
      prev = out;
      out = out.replace(re, "");
    }
  }
  return out;
}

const FIBER_MAP: Array<[RegExp, string]> = [
  [/\b(cotton|cotone|coton|baumwolle|algod[oó]n)\b/i, "Cotton"],
  [/\b(linen|lino|leinen|lin)\b/i, "Linen"],
  [/\b(silk|seta|soie|seide|seda)\b/i, "Silk"],
  [/\b(cashmere|kaschmir|cachemire)\b/i, "Cashmere"],
  [/\b(merino)\b/i, "Merino"],
  [/\b(mohair)\b/i, "Mohair"],
  [/\b(alpaca)\b/i, "Alpaca"],
  [/\b(wool|lana|laine|wolle)\b/i, "Wool"],
  [/\b(viscose|viscosa|rayon)\b/i, "Viscose"],
  [/\b(modal)\b/i, "Modal"],
  [/\b(lyocell|tencel)\b/i, "Lyocell"],
  [/\b(cupro)\b/i, "Cupro"],
  [/\b(polyester|poliestere|poliéster)\b/i, "Polyester"],
  [/\b(polyamide|poliammide|nylon)\b/i, "Polyamide"],
  [/\b(elastane|elastan|elastanne|spandex|lycra)\b/i, "Elastane"],
  [/\b(acrylic|acrilico|acrylique)\b/i, "Acrylic"],
  [/\b(denim)\b/i, "Denim"],
  [/\b(leather|pelle|cuir|leder|cuero)\b/i, "Leather"],
  [/\b(suede|camoscio|daim|wildleder|ante)\b/i, "Suede"],
  [/\b(shearling|montone)\b/i, "Shearling"],
  [/\b(down|piuma|piumino|daunen)\b/i, "Down"],
  [/\b(gold|oro|doré|dorée|vergoldet)\b/i, "Gold"],
  [/\b(silver|argento|argent|silber|plata)\b/i, "Silver"],
  [/\b(steel|acciaio|acier|stahl|inox|stainless)\b/i, "Steel"],
  [/\b(brass|ottone|laiton|messing)\b/i, "Brass"],
  [/\b(metal|metallo|métal|metall)\b/i, "Metal"],
  [/\b(pearl|perla|perle)\b/i, "Pearl"],
  [/\b(rubber|gomma|caoutchouc|caucciù)\b/i, "Rubber"],
  [/\b(canvas|tela|toile)\b/i, "Canvas"],
  [/\b(polyurethane|poliuretano|pvc|vinyl)\b/i, "Synthetic"],
];

function canonicalFiber(word: string): string | null {
  for (const [re, canon] of FIBER_MAP) if (re.test(word)) return canon;
  return null;
}

export type CompositionEntry = { material: string; pct: number | null };

function extractMaterials(html: string | null, productNode: ProductJson | null): {
  materials: string[];
  composition: CompositionEntry[];
} {
  const found: Array<{ canon: string; pct: number | null }> = [];
  const push = (canon: string | null, pct: number | null) => {
    if (!canon) return;
    const existing = found.find((f) => f.canon === canon);
    if (existing) {
      if (pct != null) existing.pct = Math.max(existing.pct ?? 0, pct);
    } else {
      found.push({ canon, pct });
    }
  };

  const ldMat = productNode?.material;
  for (const m of Array.isArray(ldMat) ? ldMat : ldMat ? [ldMat] : []) {
    push(canonicalFiber(String(m)), null);
  }

  const sources = [productNode?.description ?? "", html ? decodeHtml(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")) : ""];
  const pairRe = /(\d{1,3})\s*%\s*([a-zA-Zà-üÀ-Ü]{3,20})/g;
  for (const text of sources) {
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(text)) !== null) {
      const pct = parseInt(m[1], 10);
      if (pct < 1 || pct > 100) continue;
      push(canonicalFiber(m[2]), pct);
    }
    if (found.some((f) => f.pct != null)) break;
  }

  const sorted = found
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
    .slice(0, 5);
  return {
    materials: sorted.map((f) => f.canon),
    composition: sorted.map((f) => ({ material: f.canon, pct: f.pct })),
  };
}

type PriceSpec = { price?: string | number; priceCurrency?: string };
type OfferLike = {
  price?: string | number;
  lowPrice?: string | number;
  priceCurrency?: string;
  url?: string;
  priceSpecification?: PriceSpec | PriceSpec[];
};

type ProductJson = {
  "@type"?: string | string[];
  name?: string;
  sku?: string;
  productID?: string;
  url?: string;
  brand?: string | { name?: string };
  image?: string | string[] | { url?: string } | Array<{ url?: string }>;
  offers?: OfferLike | OfferLike[];
  material?: string | string[];
  description?: string;
};

function isProductType(t: unknown): boolean {
  if (typeof t === "string") return t.toLowerCase().includes("product");
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && x.toLowerCase().includes("product"));
  return false;
}

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
    if (obj.mainEntity) walk(obj.mainEntity);
    if (obj.hasVariant) walk(obj.hasVariant);
  };
  while ((m = re.exec(html)) !== null) {
    try { walk(JSON.parse(m[1].trim())); }
    catch { /* ignore malformed JSON-LD */ }
  }
  return nodes;
}

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

function selectProductNode(nodes: ProductJson[], target: URL): ProductJson | null {
  if (!nodes.length) return null;
  if (nodes.length === 1) return nodes[0];
  const matched = nodes.find((n) => nodeMatchesUrl(n, target));
  return matched ?? nodes[0];
}

const MODEL_KEYWORDS = /(model|worn|lifestyle|editorial|campaign|onbody|on-body|lookbook|-(?:fi|bi|m|dt\d*w?)\.(?:jpe?g|png|webp)(?:\?|$))/i;
const PRODUCT_KEYWORDS = /(product|packshot|flat|still|front|back|detail|closeup|close-up|main-image|main_image|primary|-[fb]\.(?:jpe?g|png|webp)(?:\?|$))/i;
const JUNK_KEYWORDS = /(logo|sprite|placeholder|icon-|favicon|thumbnail|swatch|badge|banner|arrow|chevron|pixel\.gif|tracking)/i;
const RELATED_URL_KEYWORDS = /(related|recommend|similar|cross-sell|upsell|editorial|carousel|thumbnail|swatch)/i;
// Lazy-loaded image tags on many sites (Calzedonia included) carry a tiny
// SVG placeholder in `src` while the real photo sits in data-src/srcset.
// A product photo is never actually an SVG, so we reject the extension
// outright — otherwise the placeholder can win by default and break
// background removal downstream, which only accepts raster formats.
const SVG_URL_RE = /\.svg(\?|#|$)/i;
// A second, sneakier version of the same trick (Shopify themes, Bluebella
// included): the placeholder is a REAL raster file, just a 1x1-pixel one,
// swapped for the real photo by client-side JS we never execute. It passes
// both the SVG filter and a content-type check, since it genuinely is a
// valid JPEG — only its filename gives it away.
const LQIP_PLACEHOLDER_RE = /(^|[_-])1x1([_.-]|$)|_lqip|blank\.(?:jpe?g|png|gif)(?:\?|$)|transparent\.(?:jpe?g|png|gif)(?:\?|$)|spacer\.(?:jpe?g|png|gif)(?:\?|$)/i;



function collectDomImages(html: string, base: URL): Array<{ url: string; alt: string }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; alt: string }> = [];
  const push = (v: string | null | undefined, alt: string) => {
    if (!v) return;
    const t = decodeHtml(v.trim());
        if (!t || t.startsWith("data:") || SVG_URL_RE.test(t) || LQIP_PLACEHOLDER_RE.test(t)) return;

    try {
      const abs = new URL(t, base).toString();
      if (seen.has(abs)) return;
      seen.add(abs);
      out.push({ url: abs, alt });
    } catch { /* ignore */ }
  };
  const imgRe = /<img[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const attr = (name: string) => {
      const re = new RegExp(`\\s${name}=["']([^"']+)["']`, "i");
      return tag.match(re)?.[1] ?? null;
    };
    // Many CDNs (Zara/Inditex included) serve purely numeric image URLs with
    // no descriptive words at all — the alt text is often the only place a
    // "front"/"back"/"detail"/"model" style hint survives, so we carry it
    // alongside every URL variant instead of scoring the URL alone.
    const alt = decodeHtml(attr("alt") ?? "");
    push(attr("src"), alt);
    push(attr("data-src"), alt);
    push(attr("data-lazy-src"), alt);
    push(attr("data-original"), alt);
    push(attr("data-zoom-image"), alt);
    const srcset = attr("srcset") ?? attr("data-srcset");
    if (srcset) {
      const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
      let bestUrl: string | null = null;
      let bestW = -1;
      for (const p of parts) {
        const [u, w] = p.split(/\s+/);
        const width = w?.endsWith("w") ? parseInt(w) : 0;
        if (width > bestW) { bestW = width; bestUrl = u; }
      }
      push(bestUrl, alt);
    }
  }
  return out;
}

function scoreImage(url: string, alt: string, productTokens: string[]): number {
  const u = url.toLowerCase();
  const a = alt.toLowerCase();
  const combined = `${u} ${a}`;
  let s = 0;
  if (JUNK_KEYWORDS.test(combined)) s -= 30;
  if (RELATED_URL_KEYWORDS.test(combined)) s -= 15;
  if (PRODUCT_KEYWORDS.test(combined)) s += 8;
  if (MODEL_KEYWORDS.test(combined)) s -= 12;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(u)) s += 1;
  for (const tok of productTokens) {
    if (tok.length >= 4 && combined.includes(tok)) { s += 4; break; }
  }
  const wMatch = u.match(/[_?&](?:w|width)[=_]?(\d{3,4})/);
  if (wMatch) {
    const w = parseInt(wMatch[1]);
    if (w >= 1000) s += 3;
    else if (w >= 600) s += 1;
  }
  return s;
}

function pickBestImage(candidates: Array<{ url: string; alt: string }>, productTokens: string[]): string | null {
  if (!candidates.length) return null;
  const scored = candidates
    .map((c, i) => ({ u: c.url, s: scoreImage(c.url, c.alt, productTokens), i }))
    .filter((x) => x.s > -20)
    .sort((a, b) => (b.s - a.s) || (a.i === 0 ? 1 : b.i === 0 ? -1 : a.i - b.i));
  return scored[0]?.u ?? null;
}

type FallbackResult = { html: string | null; errored: boolean; debug?: string; pageBlocked?: boolean };
type FallbackScraper = (url: string) => Promise<FallbackResult>;

// A real product page is typically tens to hundreds of KB. A page this
// short returned alongside a 401/403/429/503 status is almost always an
// anti-bot challenge or "access denied" page, not real content — no
// amount of extraction (pattern-based or AI) can find a product in a
// page that was never actually served.
const SUSPICIOUSLY_SHORT_HTML = 15000;

// Domain-agnostic signatures of common anti-bot challenge pages (Akamai,
// PerimeterX/HUMAN, Cloudflare, DataDome, Imperva Incapsula, Distil). We
// don't try to maintain a list of every protected retailer — we detect the
// symptom instead, on whatever page actually comes back.
const CHALLENGE_SIGNATURES: RegExp[] = [
  /pardon our interruption/i,
  /access denied/i,
  /attention required/i,
  /just a moment\.\.\./i,
  /verify you are human/i,
  /checking your browser/i,
  /enable javascript and cookies to continue/i,
  /cf-chl/i,
  /px-captcha/i,
  /_incapsula_resource/i,
  /distil_r_captcha/i,
  /geo\.captcha-delivery\.com/i,
  /perimeterx/i,
];

/** Applied to whatever HTML actually comes back from a fetch (direct or
 *  Firecrawl) to decide whether it's a real product page or an anti-bot
 *  challenge — independent of which domain served it. */
function looksLikeBlockedPage(html: string): { blocked: boolean; signal?: string } {
  for (const re of CHALLENGE_SIGNATURES) {
    if (re.test(html)) return { blocked: true, signal: re.source };
  }
  if (html.length < SUSPICIOUSLY_SHORT_HTML) {
    const hasProductSignal = /application\/ld\+json/i.test(html) || /<meta[^>]+property=["']og:image["']/i.test(html);
    if (!hasProductSignal) return { blocked: true, signal: "short-no-product-markers" };
  }
  return { blocked: false };
}

/** Self-learned list of domains that need the Firecrawl fallback, built from
 *  looksLikeBlockedPage() detections instead of a hand-maintained array.
 *  Read-only lookup; never throws — a lookup failure just means we try the
 *  (cheap) direct fetch first, same as an unknown domain. */
async function getDomainHint(domain: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("scrape_domain_hints")
      .select("needs_fallback")
      .eq("domain", domain)
      .maybeSingle();
    return Boolean(data?.needs_fallback);
  } catch (err) {
    console.warn("[AURA import-url] domain hint lookup failed", err);
    return false;
  }
}

/** Records (or reinforces) that a domain needed the fallback scraper. Never
 *  throws — this is a self-learning side effect, not something that should
 *  ever fail the actual import. */
async function recordDomainHint(domain: string, signal: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("record_scrape_domain_hint", { p_domain: domain, p_signal: signal });
  } catch (err) {
    console.warn("[AURA import-url] could not record domain hint", err);
  }
}

const firecrawlScrape: FallbackScraper = async (url) => {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { html: null, errored: true, debug: "no-api-key" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50000);
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        url,
        formats: ["rawHtml", "html"],
        onlyMainContent: false,
        timeout: 45000,
        waitFor: 5000,
        location: { country: "IT", languages: ["it-IT"] },
        blockAds: true,
        proxy: "auto",
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.warn("[AURA import-url] firecrawl non-ok", r.status, body.slice(0, 300));
      return { html: null, errored: true, debug: `http-${r.status}:${body.slice(0, 150)}`, pageBlocked: RETRY_STATUSES.has(r.status) };
    }
    const data = await r.json() as {
      success?: boolean;
      error?: string;
      data?: { rawHtml?: string; html?: string; metadata?: { statusCode?: number } };
    };
    const html = data.data?.rawHtml || data.data?.html || null;
    const pageStatus = data.data?.metadata?.statusCode;
    const pageBlocked = (pageStatus != null && RETRY_STATUSES.has(pageStatus)) || (html != null && html.length < SUSPICIOUSLY_SHORT_HTML);
    const debug = `success=${data.success} error=${data.error ?? "none"} pageStatus=${pageStatus ?? "n/a"} htmlLen=${html?.length ?? 0}`;
    console.log("[AURA import-url] firecrawl response", debug);
    if (data.success === false) {
      return { html: null, errored: true, debug, pageBlocked };
    }
    return { html, errored: false, debug, pageBlocked };
  } catch (e) {
    const debug = `exception:${String(e).slice(0, 150)}`;
    console.warn("[AURA import-url] firecrawl failed", e);
    return { html: null, errored: true, debug };
  } finally {
    clearTimeout(timer);
  }
};

const fallbackScraper: FallbackScraper = firecrawlScrape;

type CreditResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "auth" | "limit" };

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
      return { ok: true, remaining: -1 };
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
  console.log("[AURA import-url] FIRECRAWL_API_KEY present:", Boolean(key), "length:", key?.length ?? 0);
  return Boolean(key);
};

async function directFetch(target: URL): Promise<{ html: string | null; blocked: boolean; signal?: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const urlErr = checkPublicUrl(target.toString());
    if (urlErr) return { html: null, blocked: false };
    const resp = await safeFetch(target.toString(), {
      signal: ctl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (resp.ok) {
      const rawHtml = await resp.text();
      // A 200 status doesn't mean a real page — anti-bot challenges often
      // return 200 with a fake/short body. Treat a detected challenge the
      // same as a hard block: no html, so the caller falls through to
      // Firecrawl instead of extracting an image from a fake page.
      const check = looksLikeBlockedPage(rawHtml);
      if (check.blocked) return { html: null, blocked: true, signal: check.signal };
      return { html: rawHtml, blocked: false };
    }
    if (RETRY_STATUSES.has(resp.status)) return { html: null, blocked: true, signal: `http-${resp.status}` };
    return { html: null, blocked: false };
  } catch (err) {
    console.warn("[AURA import-url] fetch failed", err);
    return { html: null, blocked: true, signal: "fetch-error" };
  } finally {
    clearTimeout(timer);
  }
}

type ExtractionMethod = "json-ld" | "og-image" | "dom" | "none";
export type ImportConfidence = "high" | "medium" | "low";
type Extracted = {
  imageUrl: string;
  method: ExtractionMethod;
  confidence: ImportConfidence;
  productNode: ProductJson | null;
  ogTitle: string;
  candidates: string[];
};

// Was 6 — too aggressive a cut when a gallery alternates model/still shots
// and the still images happen to sit later in page order; a wider pool
// gives the "wrong photo? pick another" picker a real chance to include them.
const MAX_CANDIDATES = 12;

const SHOPIFY_SIGNATURE_RE = /cdn\.shopify\.com|shopify-checkout-api-token|\/cdn\/shop\/|Shopify\.shop\s*=/i;

/**
 * Shopify's lazy-load themes (Bluebella included) only put a placeholder
 * in the HTML gallery — the real images exist, but only get swapped in by
 * client-side JS we never run. Rather than chase every theme's specific
 * placeholder trick, Shopify stores all expose a stable public JSON
 * endpoint (`/products/<handle>.json`) with the complete, already-resolved
 * image list — no lazy-load, no JS required. When a page is detected as
 * Shopify, this supersedes whatever the DOM scraper found.
 */
async function fetchShopifyProductImages(target: URL): Promise<Array<{ url: string; alt: string }>> {
  try {
    const path = target.pathname.replace(/\/$/, "");
    if (!/\/products\//i.test(path)) return [];
    const jsonUrl = new URL(`${path}.json`, target.origin).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await safeFetch(jsonUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          Accept: "application/json",
        },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { product?: { images?: Array<{ src?: string; alt?: string | null }> } };
      const images = data.product?.images ?? [];
      return images
        .map((img) => ({ url: img.src ?? "", alt: img.alt ?? "" }))
        .filter((img) => img.url && !SVG_URL_RE.test(img.url) && !LQIP_PLACEHOLDER_RE.test(img.url) && !JUNK_KEYWORDS.test(img.url.toLowerCase()));
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

async function extractFromHtml(html: string, target: URL): Promise<Extracted> {
  const tokens = urlSlugTokens(target);
  const ogTitle = pickMeta(html, "og:title") || pickMeta(html, "twitter:title");

  const productNodes = collectProductNodes(html);
  const productNode = selectProductNode(productNodes, target);

  const ldImgs = productNode
    ? jsonLdImages(productNode)
        .map((u) => { try { return new URL(u, target).toString(); } catch { return null; } })
        .filter((u): u is string => u !== null && !JUNK_KEYWORDS.test(u.toLowerCase()) && !SVG_URL_RE.test(u) && !LQIP_PLACEHOLDER_RE.test(u))
    : [];
  const ldImgsScored = ldImgs.map((url) => ({ url, alt: "" }));

  let domImgs = collectDomImages(stripExcludedSections(html), target)
    .filter((img) => !JUNK_KEYWORDS.test(`${img.url.toLowerCase()} ${img.alt.toLowerCase()}`) && !SVG_URL_RE.test(img.url) && !LQIP_PLACEHOLDER_RE.test(img.url));

  if (SHOPIFY_SIGNATURE_RE.test(html)) {
    const shopifyImgs = await fetchShopifyProductImages(target);
    // Canonical and complete — replaces the scraped DOM gallery outright
    // rather than merging with it, since a lazy-load theme's DOM images
    // are placeholders we've already had to filter down to nothing useful.
    if (shopifyImgs.length) domImgs = shopifyImgs;
  }

  const rankDom = (arr: Array<{ url: string; alt: string }>) =>

    arr.map((img, i) => ({ u: img.url, s: scoreImage(img.url, img.alt, tokens), i }))
       .sort((a, b) => (b.s - a.s) || (a.i - b.i))
       .map((x) => x.u);
  const candidates = Array.from(new Set([...ldImgs, ...rankDom(domImgs)])).slice(0, MAX_CANDIDATES);

  if (ldImgs.length) {
    const best = pickBestImage(ldImgsScored, tokens) ?? ldImgs[0];
    return { imageUrl: best, method: "json-ld", confidence: "high", productNode, ogTitle, candidates };
  }

  const og = pickMeta(html, "og:image") || pickMeta(html, "og:image:secure_url") || pickMeta(html, "twitter:image");
  if (og) {
    try {
      const abs = new URL(og, target).toString();
            const junky = JUNK_KEYWORDS.test(abs.toLowerCase()) || RELATED_URL_KEYWORDS.test(abs.toLowerCase()) || SVG_URL_RE.test(abs) || LQIP_PLACEHOLDER_RE.test(abs);
      const looksLikeProduct = productNodes.length > 0 ||
        tokens.some((t) => t.length >= 4 && abs.toLowerCase().includes(t));
      if (!junky && looksLikeProduct) {
        const withOg = Array.from(new Set([abs, ...candidates])).slice(0, MAX_CANDIDATES);
        return { imageUrl: abs, method: "og-image", confidence: "medium", productNode, ogTitle, candidates: withOg };
      }
    } catch { /* ignore */ }
  }

  const best = pickBestImage(domImgs, tokens);
  if (best) return { imageUrl: best, method: "dom", confidence: "low", productNode, ogTitle, candidates };

  return { imageUrl: "", method: "none", confidence: "low", productNode, ogTitle, candidates: [] };
}

/** Structured hints (brand/title/price/materials) from a fetched product
 *  page — factored out of the single-item handler below so batch URL
 *  import can get the exact same metadata, not just the image. */
function extractProductMeta(html: string | null, target: URL, extracted: Extracted) {
  const ld = extracted.productNode;
  const brandFromLd =
    typeof ld?.brand === "string"
      ? ld.brand
      : ld?.brand && typeof ld.brand === "object"
      ? ld.brand.name ?? ""
      : "";
  const brand = (brandFromLd || getBrandFromUrl(target.toString()) || "").trim();
  const title = (
    ld?.name ||
    extracted.ogTitle ||
    pickTitleTag(html ?? "") ||
    humanizeSlug(target) ||
    ""
  ).trim();

  const parsePriceNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "string") return null;
    const cleaned = v.replace(/[^\d.,]/g, "");
    if (!cleaned) return null;
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const norm = lastComma >= 0 && lastDot >= 0
      ? (lastComma > lastDot
          ? cleaned.replace(/\./g, "").replace(",", ".")
          : cleaned.replace(/,/g, ""))
      : cleaned.replace(",", ".");
    const n = parseFloat(norm);
    return Number.isFinite(n) ? n : null;
  };

  let price: string | null = null;
  let priceValue: number | null = null;
  let priceCurrency: string | null = null;
  const offerList: OfferLike[] = Array.isArray(ld?.offers) ? ld?.offers ?? [] : ld?.offers ? [ld.offers] : [];
  for (const offer of offerList) {
    const spec = Array.isArray(offer.priceSpecification) ? offer.priceSpecification[0] : offer.priceSpecification;
    const candidate = parsePriceNum(offer.price) ?? parsePriceNum(offer.lowPrice) ?? parsePriceNum(spec?.price);
    if (candidate != null) {
      priceValue = candidate;
      priceCurrency = String(offer.priceCurrency || spec?.priceCurrency || "").toUpperCase() || null;
      break;
    }
  }
  if (priceValue == null && html) {
    const metaPrice =
      pickMeta(html, "product:price:amount") ||
      pickMeta(html, "og:price:amount") ||
      (html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i)?.[1] ?? "");
    const metaCur =
      pickMeta(html, "product:price:currency") ||
      pickMeta(html, "og:price:currency") ||
      (html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([A-Za-z]{3})["']/i)?.[1] ?? "");
    const n = parsePriceNum(metaPrice);
    if (n != null) {
      priceValue = n;
      priceCurrency = metaCur ? metaCur.toUpperCase() : null;
    }
  }
  if (priceValue == null && html) {
    const text = decodeHtml(stripExcludedSections(html).replace(/<[^>]+>/g, " "));
    const m =
      text.match(/(?:€|\bEUR\b)\s{0,2}(\d{1,4}(?:[.,]\d{2})?)/) ||
      text.match(/(\d{1,4}(?:[.,]\d{2}))\s{0,2}(?:€|\bEUR\b)/);
    const n = parsePriceNum(m?.[1] ?? "");
    if (n != null && n >= 1 && n <= 20000) {
      priceValue = n;
      priceCurrency = "EUR";
    }
  }
  if (priceValue != null) {
    price = priceCurrency ? `${priceValue} ${priceCurrency}` : String(priceValue);
  }

  return { brand, title, price, priceValue, priceCurrency, ...extractMaterials(html, extracted.productNode) };
}
const AiExtractionSchema = z.object({
  imageUrl: z.string(),
  brand: z.string(),
  title: z.string(),
  priceValue: z.number().nullable(),
  priceCurrency: z.string().nullable(),
});

/**
 * Strips a page down to the parts an AI extraction actually needs —
 * image URLs, meta tags and visible text — dropping scripts, styles and
 * inline SVGs, which are pure token cost with zero extraction value.
 * Keeps the request cheap and predictable regardless of page size.
 */
function reduceHtmlForAi(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return stripped.slice(0, 60000);
}

/**
 * Last-resort extraction step: only runs when the fixed JSON-LD / og-image
 * / DOM-heuristic extraction above already failed on a page we DID manage
 * to fetch (directly or via Firecrawl). Instead of hand-writing yet
 * another site-specific pattern, this asks a model to read the page like
 * a person would — which generalizes to any site's markup, not just the
 * one that happened to fail today. Cheap (page text in, a few fields out)
 * and only runs on the failure path, never on a normal successful import.
 */
async function extractViaAi(
  html: string,
  target: URL,
): Promise<{ imageUrl: string; brand: string; title: string; priceValue: number | null; priceCurrency: string | null } | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const reduced = reduceHtmlForAi(html);
    const prompt = [
      `This is the HTML of a fashion e-commerce product page (${target.toString()}). Find the single MAIN product photo — not a related/recommended item, not a logo, not an icon. Prefer a large, high-resolution image over a thumbnail.`,
      "Also extract, if present on the page: brand name, product title, and price (as a plain number, plus its ISO currency code, e.g. EUR/USD/GBP).",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
      '{"imageUrl": "", "brand": "", "title": "", "priceValue": null, "priceCurrency": null}',
      "imageUrl must be copied verbatim from an actual src/srcset/data-src attribute in the HTML below — never invent or guess a URL. If genuinely no product image can be found, return an empty string for imageUrl.",
      "",
      "HTML:",
      reduced,
    ].join("\n");

    const { text } = await generateText({
      model,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = parseAiJson(text, AiExtractionSchema);
    if (!parsed.imageUrl) return null;
    return parsed;
  } catch (e) {
    console.warn("[AURA import-url] AI extraction fallback failed", e);
    return null;
  }
}


export type ResolvedProductImage =
  | ({ ok: true; imageUrl: string; candidates: string[] } & ReturnType<typeof extractProductMeta>)
  | { ok: false; error: string; rateLimited?: boolean };

const USABLE_IMAGE_CONTENT_TYPE_RE = /^image\/(jpeg|jpg|png|webp|gif|avif)/i;
const IMAGE_VALIDATION_TIMEOUT_MS = 4000;
const IMAGE_VALIDATION_CONCURRENCY = 5;
// A real product photo is never this small — this is sized to comfortably
// clear a 1x1-pixel lazy-load placeholder (typically a few hundred bytes)
// while never rejecting a legitimate, if heavily compressed, product shot.
const MIN_USABLE_IMAGE_BYTES = 3000;

/**
 * Many fashion sites (Bluebella included) reject bare cross-origin <img>
 * requests from our own domain — the browser's Referer header gives it
 * away as hotlinking, so the thumbnail just shows a broken-image icon to
 * the person picking a photo. We validate each candidate server-side
 * instead: a plain fetch with no browser-identifying Referer (or one set
 * to the product page itself, which most sites accept) confirms the URL
 * actually resolves to a real image before it's ever shown to the user.
 * This also catches anything that slipped past the SVG filter above.
 */
async function isUsableImageUrl(url: string, refererUrl: string): Promise<boolean> {
  if (SVG_URL_RE.test(url) || LQIP_PLACEHOLDER_RE.test(url)) return false;
  if (checkPublicUrl(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_VALIDATION_TIMEOUT_MS);
  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    Referer: refererUrl,
  };
  try {
    const head = await safeFetch(url, { method: "HEAD", headers, signal: controller.signal });
    const headContentType = head.headers.get("content-type") ?? "";
    const headLen = Number(head.headers.get("content-length") ?? "");
    if (head.ok && Number.isFinite(headLen) && headLen > 0) {
      // A 1x1-pixel "lazy load" placeholder (Bluebella's trick, and others
      // like it) is a genuinely valid image file — same content-type, same
      // 200 status — just a few hundred bytes because there's almost
      // nothing to encode. A real product photo is always tens of KB at
      // minimum, so file size catches this even when the filename doesn't
      // give it away.
      return USABLE_IMAGE_CONTENT_TYPE_RE.test(headContentType) && headLen >= MIN_USABLE_IMAGE_BYTES;
    }
    // No usable Content-Length from HEAD (some CDNs omit it, or reject
    // HEAD outright) — fall back to a real GET and measure the bytes.
    const res = await safeFetch(url, { method: "GET", headers, signal: controller.signal });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !USABLE_IMAGE_CONTENT_TYPE_RE.test(contentType)) {
      try { await res.body?.cancel?.(); } catch { /* ignore */ }
      return false;
    }
    const bytes = await res.arrayBuffer();
    return bytes.byteLength >= MIN_USABLE_IMAGE_BYTES;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}


/** Runs isUsableImageUrl over the list with bounded concurrency and
 *  returns only the URLs that passed, preserving original order. */
async function filterUsableImageUrls(urls: string[], refererUrl: string): Promise<string[]> {
  const keep = new Array<boolean>(urls.length).fill(false);
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      keep[i] = await isUsableImageUrl(urls[i], refererUrl);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(IMAGE_VALIDATION_CONCURRENCY, urls.length) }, worker),
  );
  return urls.filter((_, i) => keep[i]);
}

/**
 * Given a product PAGE url (not a direct image link), finds its best
 * product image url AND the same brand/price/material metadata the
 * single-item "Import from URL" flow below extracts — factored out here
 * so batch URL import (createBatchScanFromUrls in batch-scan.functions.ts)
 * gets full parity with single-item import instead of only the photo.
 */
export async function resolveProductImageUrl(rawUrl: string, accessToken?: string): Promise<ResolvedProductImage> {
  let target: URL;
  try {
    target = stripTrackingParams(new URL(rawUrl));
  } catch {
    return { ok: false, error: "Not a valid URL." };
  }
  const domain = rootDomain(target);
  const hasFallback = fallbackScraperAvailable();
  const hardBlocked = HARD_BLOCK_DOMAINS.has(domain);
  const forceFallback = hardBlocked || (!hardBlocked && (await getDomainHint(domain)));

  let html: string | null = null;
  let blocked = false;
  let usedFallback = false;
  let pageBlocked = false;

  if (forceFallback) {
    if (!hasFallback) return { ok: false, error: FIRECRAWL_MISSING_MSG };
    const credit = await consumeFirecrawlCredit(accessToken);
    if (!credit.ok) {
      return { ok: false, error: credit.reason === "limit" ? RATE_LIMIT_MSG : SIGNIN_FOR_FALLBACK_MSG, rateLimited: credit.reason === "limit" };
    }
    const fb = await fallbackScraper(target.toString());
    if (fb.errored && !fb.html) return { ok: false, error: FIRECRAWL_FAILED_MSG };
    html = fb.html;
    usedFallback = true;
    pageBlocked = Boolean(fb.pageBlocked);
  } else {
    const direct = await directFetch(target);
    html = direct.html;
    blocked = direct.blocked;
    if (blocked) void recordDomainHint(domain, direct.signal ?? "unknown");
  }

  let extracted: Extracted = { imageUrl: "", method: "none", confidence: "low", productNode: null, ogTitle: "", candidates: [] };
  if (html) extracted = await extractFromHtml(html, target);

  if (!extracted.imageUrl && !usedFallback) {
    if (!hasFallback) {
      return { ok: false, error: blocked ? FIRECRAWL_MISSING_MSG : "No product image found on that page." };
    }
    const credit = await consumeFirecrawlCredit(accessToken);
    if (!credit.ok) {
      return { ok: false, error: credit.reason === "limit" ? RATE_LIMIT_MSG : SIGNIN_FOR_FALLBACK_MSG, rateLimited: credit.reason === "limit" };
    }
    const fc = await fallbackScraper(target.toString());
    if (fc.errored && !fc.html) return { ok: false, error: FIRECRAWL_FAILED_MSG };
    if (fc.html) extracted = await extractFromHtml(fc.html, target);
    pageBlocked = Boolean(fc.pageBlocked);
  }

    if (!extracted.imageUrl && html) {
    const ai = await extractViaAi(html, target);
    if (ai?.imageUrl) {
      extracted = {
        imageUrl: ai.imageUrl,
        method: "none",
        confidence: "medium",
        productNode: null,
        ogTitle: ai.title,
        candidates: [ai.imageUrl],
      };
    }
  }

  if (!extracted.imageUrl) {
    return { ok: false, error: pageBlocked ? UNSCRAPABLE_MSG : "No product image found on that page." };
  }
  const imageUrl = new URL(extracted.imageUrl, target).toString();
  const rawCandidates = Array.from(new Set([
    imageUrl,
    ...extracted.candidates.map((c) => { try { return new URL(c, target).toString(); } catch { return null; } }).filter((c): c is string => c !== null),
  ])).slice(0, MAX_CANDIDATES);

  const candidates = await filterUsableImageUrls(rawCandidates, target.toString());
  if (!candidates.length) {
    return { ok: false, error: "Found this page but couldn't load its product photo — the site may be blocking image access." };
  }
  const primaryImageUrl = candidates.includes(imageUrl) ? imageUrl : candidates[0];
  return { ok: true, imageUrl: primaryImageUrl, candidates, ...extractProductMeta(html, target, extracted) };
}

export const importProductFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const target = stripTrackingParams(new URL(data.url));
    const domain = rootDomain(target);
    const hasFallback = fallbackScraperAvailable();
    const hardBlocked = HARD_BLOCK_DOMAINS.has(domain);
    const forceFallback = hardBlocked || (!hardBlocked && (await getDomainHint(domain)));

    let html: string | null = null;
    let blocked = false;
    let usedFallback = false;
    let fbDebugMsg: string | undefined; // TEMP diagnostica — rimuovere una volta trovata la causa
    let pageBlocked = false;

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
      const fb = await fallbackScraper(target.toString());
      if (fb.errored && !fb.html) {
        return { ok: false as const, error: `${FIRECRAWL_FAILED_MSG} [DEBUG: ${fb.debug ?? "none"}]` };
      }
      html = fb.html;
      usedFallback = true;
      fbDebugMsg = fb.debug;
      pageBlocked = Boolean(fb.pageBlocked);
    } else {
      const direct = await directFetch(target);
      html = direct.html;
      blocked = direct.blocked;
      if (blocked) void recordDomainHint(domain, direct.signal ?? "unknown");
    }

    let extracted: Extracted = { imageUrl: "", method: "none", confidence: "low", productNode: null, ogTitle: "", candidates: [] };
            if (fc.html) extracted = await extractFromHtml(fc.html, target);

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
      if (fc.errored && !fc.html) {
        return { ok: false as const, error: `${FIRECRAWL_FAILED_MSG} [DEBUG: ${fc.debug ?? "none"}]` };
      }
      if (fc.html) {
        html = fc.html;
        usedFallback = true;
                extracted = await extractFromHtml(fc.html, target);
      }
      fbDebugMsg = fc.debug;
      pageBlocked = Boolean(fc.pageBlocked);
    }

        let aiMeta: { brand: string; title: string; priceValue: number | null; priceCurrency: string | null } | null = null;

    if (!extracted.imageUrl && html) {
      const ai = await extractViaAi(html, target);
      if (ai?.imageUrl) {
        extracted = {
          imageUrl: ai.imageUrl,
          method: "none",
          confidence: "medium",
          productNode: null,
          ogTitle: ai.title,
          candidates: [ai.imageUrl],
        };
        aiMeta = { brand: ai.brand, title: ai.title, priceValue: ai.priceValue, priceCurrency: ai.priceCurrency };
      }
    }

    if (!extracted.imageUrl) {
      return {
        ok: false as const,
        error: pageBlocked
          ? UNSCRAPABLE_MSG
          : `No product image found on that page. [DEBUG: ${fbDebugMsg ?? "n/a"}]`,
      };
    }

    const imageUrl = new URL(extracted.imageUrl, target).toString();
    console.log(
      "[AURA import-url] extraction",
      JSON.stringify({
        domain,
        method: aiMeta ? "ai-fallback" : extracted.method,
        fallback: usedFallback,
        picked: imageUrl,
      }),
    );

    // The top-ranked candidate can occasionally 404 (e.g. an ephemeral asset
    // picked up from a challenge/interstitial page) even when extraction
    // otherwise looked confident. Fall through to the remaining ranked
    // candidates before giving up, instead of failing on the first miss.
    const downloadOrder = Array.from(new Set([imageUrl, ...extracted.candidates.map((c) => {
      try { return new URL(c, target).toString(); } catch { return null; }
    }).filter((c): c is string => c !== null)]));

    let dl: Awaited<ReturnType<typeof fetchImageAsDataUrl>> | null = null;
    let lastError = "No product image found on that page.";
    for (const candidateUrl of downloadOrder) {
      const attempt = await fetchImageAsDataUrl(candidateUrl, target.origin);
      if (attempt.ok) { dl = attempt; break; }
      lastError = attempt.error;
      console.warn("[AURA import-url] candidate image download failed:", candidateUrl, attempt.error);
    }
    if (!dl) {
      return { ok: false as const, error: lastError };
    }
    const imageDataUrl = dl.dataUrl;

        const meta = extractProductMeta(html, target, extracted);
    const brand = aiMeta?.brand || meta.brand;
    const title = aiMeta?.title || meta.title;
    const priceValue = meta.priceValue ?? aiMeta?.priceValue ?? null;
    const priceCurrency = meta.priceCurrency ?? aiMeta?.priceCurrency ?? null;
    const price = priceValue != null ? (priceCurrency ? `${priceValue} ${priceCurrency}` : String(priceValue)) : meta.price;

    // The "wrong photo? pick another" strip renders these as bare <img>
    // tags with no server-side download step, so an un-validated candidate
    // shows as a broken thumbnail and 404s if tapped. Same validation the
    // batch-URL picker already gets, applied here too.
    const validatedAltCandidates = await filterUsableImageUrls(downloadOrder, target.toString());

    return {
      ok: true as const,
      imageDataUrl,
      brand,
      title,
      price,
      priceValue,
      priceCurrency,
      sourceUrl: target.toString(),
      extractionMethod: aiMeta ? "ai-fallback" : extracted.method,
      confidence: aiMeta ? "medium" as const : extracted.confidence,
      imageCandidates: validatedAltCandidates.length ? validatedAltCandidates : [imageUrl],
      materials: meta.materials,
      composition: meta.composition,
      usedFallback,
    };
  });

