import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  url: z.string().url(),
});

// Known fashion domains → brand names. Used to pre-fill brand when the domain
// is recognised, even if no logo is visible in the extracted photo.
const DOMAIN_BRANDS: Record<string, string> = {
  "zara.com": "Zara",
  "hm.com": "H&M",
  "www2.hm.com": "H&M",
  "asos.com": "ASOS",
  "mango.com": "Mango",
  "shop.mango.com": "Mango",
  "cos.com": "COS",
  "arket.com": "Arket",
  "uniqlo.com": "Uniqlo",
  "massimodutti.com": "Massimo Dutti",
  "bershka.com": "Bershka",
  "pullandbear.com": "Pull&Bear",
  "stradivarius.com": "Stradivarius",
  "shein.com": "Shein",
  "nike.com": "Nike",
  "adidas.com": "Adidas",
  "newbalance.com": "New Balance",
  "gucci.com": "Gucci",
  "prada.com": "Prada",
  "louisvuitton.com": "Louis Vuitton",
  "chanel.com": "Chanel",
  "hermes.com": "Hermès",
  "dior.com": "Dior",
  "ysl.com": "Saint Laurent",
  "saintlaurent.com": "Saint Laurent",
  "burberry.com": "Burberry",
  "loewe.com": "Loewe",
  "toteme-studio.com": "Totême",
  "acnestudios.com": "Acne Studios",
  "ganni.com": "Ganni",
  "reformation.com": "Reformation",
  "everlane.com": "Everlane",
  "aritzia.com": "Aritzia",
  "zalando.com": "Zalando",
  "farfetch.com": "Farfetch",
  "net-a-porter.com": "Net-a-Porter",
  "mytheresa.com": "Mytheresa",
  "ssense.com": "SSENSE",
};

function brandFromHost(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (DOMAIN_BRANDS[h]) return DOMAIN_BRANDS[h];
  // try suffix match (e.g. it.zara.com → zara.com)
  for (const [domain, brand] of Object.entries(DOMAIN_BRANDS)) {
    if (h === domain || h.endsWith("." + domain)) return brand;
  }
  return "";
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

export const importProductFromUrl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const target = new URL(data.url);

    // 1. Fetch the page. Impersonate a real browser to reduce trivial blocks.
    let html: string;
    try {
      const resp = await fetch(target.toString(), {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!resp.ok) {
        return { ok: false as const, error: `Site returned ${resp.status}. It may be blocking scraping.` };
      }
      html = await resp.text();
    } catch (err) {
      console.warn("[AURA import-url] fetch failed", err);
      return { ok: false as const, error: "Could not reach that URL." };
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
    const brand = (brandFromLd || brandFromHost(target.host) || "").trim();
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
