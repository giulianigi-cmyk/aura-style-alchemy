export type DestinationSearchResult = {
  name: string;
  country: string | null;
  admin1: string | null; // region/state, when present — disambiguates same-named places
  latitude: number;
  longitude: number;
};

/**
 * Photon (Komoot), built on OpenStreetMap data — free, no API key.
 * Chosen over the Open-Meteo/GeoNames geocoder used for the weather
 * fallback because GeoNames' coverage missed places like AlUla, a
 * newer/actively-developed destination; OSM data tends to catch up on
 * these faster since it's community-maintained. If this still isn't
 * enough real-world coverage, the next step up is Google Places
 * Autocomplete — free for the volumes this app would see, but requires
 * a Google Cloud project with billing enabled.
 */
export async function searchDestinations(query: string): Promise<DestinationSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`
    );
    const data = await res.json();
    const features = (data?.features ?? []) as Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: { name?: string; country?: string; state?: string; city?: string; osm_key?: string };
    }>;
    return features
      .filter((f) => f.geometry?.coordinates && f.properties?.name)
      .map((f) => ({
        name: f.properties!.name!,
        country: f.properties!.country ?? null,
        admin1: f.properties!.state ?? f.properties!.city ?? null,
        // GeoJSON order is [longitude, latitude] — easy to flip by mistake.
        longitude: Number(f.geometry!.coordinates![0]),
        latitude: Number(f.geometry!.coordinates![1]),
      }));
  } catch (e) {
    console.error("[AURA destination-search] failed", e);
    return [];
  }
}
