// Single source of truth for the weather thresholds shared between the
// client suggestion layer (weather.ts) and the server-side re-check worker.
// Nothing else in the app should hardcode these numbers.

/** Above this chance of rain (%), we tell the user to take an umbrella. */
export const UMBRELLA_PRECIPITATION_THRESHOLD = 50;

/** A forecast temperature delta (°C) at or above this is "significant". */
export const SIGNIFICANT_TEMP_DELTA = 5;

/**
 * WMO codes AURA treats as rain. Deliberately narrower than the generic
 * "51-82 + 95-99" range: 57 (freezing drizzle) and the snow codes are
 * excluded, matching what suggestOutfit() has always used, so the
 * re-check worker and the UI never disagree on what counts as rain.
 */
export const RAINY_WMO_CODES = [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];

export function isRainyCode(code: number | null | undefined): boolean {
  return code != null && RAINY_WMO_CODES.includes(code);
}

/** Nominal local start time (hour) used only to decide whether a plan
 *  falls inside the cron's "next hour" window. Plans have no real clock
 *  time of their own except calendar events. */
export const GENERAL_PLAN_HOUR = 7;
export const SEGMENT_HOURS: Record<string, number> = {
  morning: 8,
  day: 8,
  afternoon: 13,
  evening: 19,
};
