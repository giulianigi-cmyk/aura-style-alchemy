import { WardrobeItem } from "./aura-types";
import { supabase } from "@/integrations/supabase/client";

export function toStoragePath(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http")) return null;
  return imageUrl;
}

/** Prefer the small thumbnail for grid views; fall back to the full
 *  image for items saved before the thumbnail pipeline existed. */
export function thumbSrc(item: WardrobeItem, signed: Record<string, string>): string | null {
  const thumbPath = (item as unknown as { thumbnail_path?: string | null }).thumbnail_path;
  if (thumbPath && signed[thumbPath]) return signed[thumbPath];
  const path = toStoragePath(item.image_url);
  return path ? signed[path] ?? null : null;
}

export async function resolveWardrobeUrls(items: WardrobeItem[]): Promise<Record<string, string>> {
  const paths = new Set<string>();
  for (const it of items) {
    const p = toStoragePath(it.image_url);
    if (p) paths.add(p);
    const thumbPath = (it as unknown as { thumbnail_path?: string | null }).thumbnail_path;
    if (thumbPath) paths.add(thumbPath);
  }
  if (paths.size === 0) return {};
  const pathArray = Array.from(paths);
  const { data, error } = await supabase.storage.from("wardrobe").createSignedUrls(pathArray, 60 * 60);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  data.forEach((row, i) => {
    if (row.signedUrl) map[pathArray[i]] = row.signedUrl;
  });
  return map;
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
