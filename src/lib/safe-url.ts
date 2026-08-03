/** SSRF guards for server-side fetches of user-supplied URLs.
 *  The Worker runtime has no DNS resolver, so we block literal private/
 *  loopback/link-local IPs and internal-looking hostnames, and re-check
 *  every redirect hop (redirect: "manual"). */

const BLOCKED_HOSTNAME_RE =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|metadata|metadata\.google\.internal)$/i;

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("::ffff:")) return isPrivateIPv4(h.slice(7));
  return false;
}

/** Returns null when the URL is safe to fetch, or an error message. */
export function checkPublicUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Invalid URL.";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Unsupported URL scheme.";
  if (u.username || u.password) return "URLs with credentials are not allowed.";
  const host = u.hostname.toLowerCase();
  if (!host) return "Invalid URL.";
  if (BLOCKED_HOSTNAME_RE.test(host)) return "That address is not allowed.";
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) return "That address is not allowed.";
  return null;
}

export function isPublicUrl(raw: string): boolean {
  return checkPublicUrl(raw) === null;
}

export class BlockedUrlError extends Error {}

/** fetch() that validates the target and every redirect hop. */
export async function safeFetch(
  url: string,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<Response> {
  const { maxRedirects = 5, ...rest } = init;
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const err = checkPublicUrl(current);
    if (err) throw new BlockedUrlError(err);
    const resp = await fetch(current, { ...rest, redirect: "manual" });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      current = new URL(loc, current).toString();
      continue;
    }
    return resp;
  }
  throw new BlockedUrlError("Too many redirects.");
}
