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

/** Return the current season for the Northern hemisphere. */
export function currentSeason(now = new Date()): "Spring" | "Summer" | "Autumn" | "Winter" {
  const m = now.getMonth();
  if (m <= 1 || m === 11) return "Winter";
  if (m <= 4) return "Spring";
  if (m <= 7) return "Summer";
  return "Autumn";
}

/** Does a wardrobe item match the given season? "All Seasons" always matches. */
export function itemMatchesSeason(item: WardrobeItem, season: string): boolean {
  const s = (item.season ?? "").toLowerCase();
  if (!s) return false;
  if (s.includes("all")) return true;
  return s.includes(season.toLowerCase());
}
