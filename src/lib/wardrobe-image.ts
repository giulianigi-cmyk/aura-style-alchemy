import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";

/** Extract the storage-relative path from either a raw storage path
 *  or a legacy full public URL for the private wardrobe bucket. */
export function toStoragePath(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (!imageUrl.startsWith("http")) return imageUrl;
  const marker = "/wardrobe/";
  const idx = imageUrl.indexOf(marker);
  return idx >= 0 ? imageUrl.slice(idx + marker.length) : null;
}

/** Sign a batch of wardrobe items' images and return a { path: signedUrl } map.
 *  Includes thumbnails when items have one — grid views should prefer
 *  those (see thumbPath below); the detail view still uses the full
 *  image_url path, which is always signed regardless. */
export async function resolveWardrobeUrls(items: WardrobeItem[]): Promise<Record<string, string>> {
  const thumbPaths = items
    .map((i) => (i as unknown as { thumbnail_path?: string | null }).thumbnail_path)
    .filter(Boolean) as string[];
  const paths = Array.from(new Set([
    ...items.map((i) => toStoragePath(i.image_url)).filter(Boolean) as string[],
    ...thumbPaths,
  ]));
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from("wardrobe").createSignedUrls(paths, 60 * 60);
  if (error || !data) {
    console.error("[AURA] sign wardrobe urls", error);
    return {};
  }
  const map: Record<string, string> = {};
  data.forEach((row, i) => {
    if (row.signedUrl) map[paths[i]] = row.signedUrl;
  });
  return map;
}

/** Picks the thumbnail signed URL for a grid view when the item has one,
 *  falling back to the full image otherwise (older items that predate
 *  thumbnail generation, or anything not yet re-saved). */
export function thumbSrc(item: WardrobeItem, signed: Record<string, string>): string {
  const thumbPath = (item as unknown as { thumbnail_path?: string | null }).thumbnail_path;
  if (thumbPath && signed[thumbPath]) return signed[thumbPath];
  const fullPath = toStoragePath(item.image_url);
  return fullPath ? (signed[fullPath] ?? "") : "";
}

// Astronomical seasons (equinox/solstice boundaries), not meteorological
// ones (which would put all of September in Autumn). The exact
// equinox/solstice moment shifts by a day year to year, but a fixed
// Mar 20 / Jun 21 / Sep 22 / Dec 21 approximation is well within the
// one-day margin that matters for "what should the wardrobe suggest
// today" — this is a styling app, not an almanac.
export function currentSeason(now = new Date()): "Spring" | "Summer" | "Autumn" | "Winter" {
  const m = now.getMonth(); // 0-indexed: 0=Jan
  const d = now.getDate();
  if (m === 11 && d >= 21) return "Winter";
  if (m === 0 || m === 1) return "Winter";
  if (m === 2 && d < 20) return "Winter";
  if (m === 2 || m === 3 || (m === 4) || (m === 5 && d < 21)) return "Spring";
  if (m === 5 || m === 6 || m === 7 || (m === 8 && d < 22)) return "Summer";
  if (m === 8 || m === 9 || (m === 10) || (m === 11 && d < 21)) return "Autumn";
  return "Winter";
}

/** Does a wardrobe item match the given season? "All Seasons" always matches. */
export function itemMatchesSeason(item: WardrobeItem, season: string): boolean {
  const s = (item.season ?? "").toLowerCase();
  if (!s) return false;
  if (s.includes("all")) return true;
  return s.includes(season.toLowerCase());
}
