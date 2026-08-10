export type DestinationSearchResult = {
  name: string;
  country: string | null;
  admin1: string | null; // region/state, when present — disambiguates same-named places
  latitude: number;
  longitude: number;
};

/**
 * Free, no-key geocoding — same provider already used for the manual
 * city fallback in useLocation(). Returns several candidates rather than
 * just the top hit, since place names are often ambiguous (there's more
 * than one "Alula").
 */
export async function searchDestinations(query: string): Promise<DestinationSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(q)}`
    );
    const data = await res.json();
    const results = (data?.results ?? []) as Array<{
      name: string; country?: string; admin1?: string; latitude: number; longitude: number;
    }>;
    return results.map((r) => ({
      name: r.name,
      country: r.country ?? null,
      admin1: r.admin1 ?? null,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    }));
  } catch (e) {
    console.error("[AURA destination-search] failed", e);
    return [];
  }
}
