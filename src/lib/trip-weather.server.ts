// Server-only. Gives the trip capsule generator a real temperature to work
// with instead of null — see docs/roadmap/trip-capsule-packing.md.
//
// Two sources, chosen per date:
//  - Within Open-Meteo's real forecast horizon (~15 days) → an actual
//    forecast, via the same fetchWeather() Home/Today already uses.
//  - Beyond that (the common case — trips are usually planned months
//    ahead) → a 5-year historical average for that calendar date at that
//    location, from Open-Meteo's free archive API. This is an ESTIMATE,
//    never presented as measured fact — per the project-wide "false
//    precision is worse than honest approximation" principle, any caller
//    surfacing this in the UI must label it "Estimated".

import { fetchWeather } from "./weather";

export type TripDayWeather = {
  tempMin: number;
  tempMax: number;
  weatherCode: number;
  /** true = 5-year historical average (date is beyond real forecast range).
   *  false = actual forecast. UI must label estimated=true as "Estimated". */
  estimated: boolean;
};

const HISTORICAL_YEARS = 5;
// Matches fetchWeather()'s own forecast_days=15 in weather.ts — a date past
// this genuinely has no real forecast yet, not a shorter/lazier lookup.
const FORECAST_HORIZON_DAYS = 15;

type ArchiveDayResult = { tempMin: number; tempMax: number; weatherCode: number };

async function fetchArchiveDay(lat: number, lon: number, dateStr: string): Promise<ArchiveDayResult | null> {
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date", dateStr);
  url.searchParams.set("daily", "temperature_2m_min,temperature_2m_max,weather_code");
  url.searchParams.set("timezone", "auto");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    const tempMin = j.daily?.temperature_2m_min?.[0];
    const tempMax = j.daily?.temperature_2m_max?.[0];
    const weatherCode = j.daily?.weather_code?.[0];
    if (typeof tempMin !== "number" || typeof tempMax !== "number") return null;
    return { tempMin, tempMax, weatherCode: typeof weatherCode === "number" ? weatherCode : 0 };
  } catch {
    return null;
  }
}

/** Averages the same calendar date (MM-DD) across the last N years at this
 *  location. Years with no data (archive lag, station gaps) are just
 *  dropped from the average rather than failing the whole lookup. */
async function fetchHistoricalAverage(lat: number, lon: number, monthDay: string): Promise<TripDayWeather | null> {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: HISTORICAL_YEARS }, (_, i) => currentYear - 1 - i);
  const results = await Promise.all(years.map((year) => fetchArchiveDay(lat, lon, `${year}-${monthDay}`)));
  const valid = results.filter((r): r is ArchiveDayResult => r !== null);
  if (!valid.length) return null;

  const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;
  return {
    tempMin: avg(valid.map((v) => v.tempMin)),
    tempMax: avg(valid.map((v) => v.tempMax)),
    // A mean of WMO codes isn't meaningful as a code, but rounding it lands
    // on a reasonable middle-ground condition (e.g. averaging "clear" and
    // "overcast" days lands near "partly cloudy") — good enough for a
    // rough label, not used for anything more precise than that.
    weatherCode: Math.round(avg(valid.map((v) => v.weatherCode))),
    estimated: true,
  };
}

export async function getTripDayWeather(lat: number, lon: number, dateISO: string): Promise<TripDayWeather | null> {
  const target = new Date(`${dateISO}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (diffDays >= 0 && diffDays <= FORECAST_HORIZON_DAYS) {
    try {
      const bundle = await fetchWeather(lat, lon);
      const day = bundle.daily.find((d) => d.date === dateISO);
      if (day) {
        return { tempMin: day.tempMin, tempMax: day.tempMax, weatherCode: day.weatherCode, estimated: false };
      }
    } catch {
      // Falls through to the historical estimate below.
    }
  }

  return fetchHistoricalAverage(lat, lon, dateISO.slice(5));
}

/**
 * Batches getTripDayWeather across several (lat, lon, date) triples,
 * deduped by rounded coordinates + date so multiple activities on the same
 * day/destination share one lookup instead of one each.
 */
export async function getTripWeatherMap(
  requests: Array<{ lat: number; lon: number; date: string }>,
): Promise<Map<string, TripDayWeather>> {
  const unique = new Map<string, { lat: number; lon: number; date: string }>();
  for (const r of requests) {
    const key = weatherKey(r.lat, r.lon, r.date);
    if (!unique.has(key)) unique.set(key, r);
  }

  const resolved = await Promise.all(
    Array.from(unique.entries()).map(async ([key, r]) => [key, await getTripDayWeather(r.lat, r.lon, r.date)] as const),
  );

  const map = new Map<string, TripDayWeather>();
  for (const [key, weather] of resolved) {
    if (weather) map.set(key, weather);
  }
  return map;
}

export function weatherKey(lat: number, lon: number, date: string): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)},${date}`;
}
