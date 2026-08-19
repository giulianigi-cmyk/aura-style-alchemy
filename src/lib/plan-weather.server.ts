// Server-only. Hourly re-check of the forecast behind planned outfits.
//
// Why this exists: an outfit planned three days ago was chosen against the
// forecast *at that moment*. If the forecast moves before the day arrives,
// the look can be plainly wrong (satin sandals into a downpour). This
// worker re-reads the forecast shortly before each plan happens and, only
// when the change is significant, proposes an ADAPTED outfit — never a
// brand new one (see baseItemIds in ai-suggest-outfit.functions.ts).
//
// Invariants worth keeping:
//  - weather_checked_at means "when AURA last verified the forecast".
//    It is written only after a successful fetch AND a completed
//    comparison, and never when the user accepts a proposal.
//  - the stored snapshot (weather_temp / weather_code / precipitation) is
//    NOT overwritten on detection: it stays as the baseline the plan was
//    built against until the user accepts the proposal. That is what
//    makes the hourly run idempotent — it keeps finding the same change
//    and keeps updating the same open notification instead of piling up.

import { suggestOutfitCore, type SuggestOutfitItem } from "./ai-suggest-outfit.functions";
import { describeWeather, classifyTemp } from "./weather";
import {
  SIGNIFICANT_TEMP_DELTA,
  UMBRELLA_PRECIPITATION_THRESHOLD,
  isRainyCode,
  GENERAL_PLAN_HOUR,
  SEGMENT_HOURS,
} from "./weather-constants";

const WINDOW_MS = 60 * 60 * 1000; // "starts within the next hour"

type DayForecast = { tempMax: number; tempMin: number; precipitation: number; code: number };
type Forecast = { utcOffsetSeconds: number; days: Record<string, DayForecast> };

async function fetchForecast(lat: number, lon: number): Promise<Forecast | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("daily", "temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "4");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const d = j.daily ?? {};
    const days: Record<string, DayForecast> = {};
    (d.time ?? []).forEach((date: string, i: number) => {
      days[date] = {
        tempMax: Number(d.temperature_2m_max?.[i] ?? 0),
        tempMin: Number(d.temperature_2m_min?.[i] ?? 0),
        precipitation: Number(d.precipitation_probability_max?.[i] ?? 0),
        code: Number(d.weather_code?.[i] ?? 0),
      };
    });
    return { utcOffsetSeconds: Number(j.utc_offset_seconds ?? 0), days };
  } catch (err) {
    console.error("[AURA plan-weather] forecast fetch failed", err);
    return null;
  }
}

/** Local wall-clock time → epoch ms, using the location's UTC offset. */
function localToEpoch(date: string, hour: number, utcOffsetSeconds: number): number {
  return Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`) - utcOffsetSeconds * 1000;
}

export type RecheckResult = { checked: number; changed: number; skipped: number; errors: number };

export async function runPlanWeatherRecheck(limit = 200): Promise<RecheckResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const now = Date.now();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(new Date(now - 86_400_000));
  const to = iso(new Date(now + 2 * 86_400_000));

  const { data: planRows, error } = await db
    .from("outfit_plans")
    .select("id, user_id, date, item_ids, occasion, status, calendar_event_id, trip_id, trip_activity_id, day_segment, weather_temp, weather_condition, weather_code, weather_precipitation_probability")
    .eq("status", "planned")
    .gte("date", from)
    .lte("date", to)
    .limit(limit);
  if (error) throw new Error(error.message);
  const plans = (planRows ?? []) as any[];
  const result: RecheckResult = { checked: 0, changed: 0, skipped: 0, errors: 0 };
  if (!plans.length) return result;

  // ---- coordinates -------------------------------------------------
  // general / event plans follow the person (profiles), trip plans follow
  // the destination they happen at (trip_destinations).
  const userIds = Array.from(new Set(plans.map((p) => p.user_id)));
  const { data: profileRows } = await db
    .from("profiles").select("id, latitude, longitude, gender, style_boldness").in("id", userIds);
  const profiles = new Map<string, any>((profileRows ?? []).map((p: any) => [p.id, p]));

  const activityIds = plans.map((p) => p.trip_activity_id).filter(Boolean);
  const activities = new Map<string, any>();
  const destinations = new Map<string, any>();
  const tripDestinations = new Map<string, any[]>();
  if (activityIds.length) {
    const { data: actRows } = await db
      .from("trip_day_activities").select("id, trip_id, destination_id, activity_date, day_segment").in("id", activityIds);
    (actRows ?? []).forEach((a: any) => activities.set(a.id, a));
    const tripIds = Array.from(new Set((actRows ?? []).map((a: any) => a.trip_id)));
    if (tripIds.length) {
      const { data: destRows } = await db
        .from("trip_destinations").select("id, trip_id, latitude, longitude, start_date, end_date").in("trip_id", tripIds);
      (destRows ?? []).forEach((d: any) => {
        destinations.set(d.id, d);
        const arr = tripDestinations.get(d.trip_id) ?? [];
        arr.push(d);
        tripDestinations.set(d.trip_id, arr);
      });
    }
  }

  const eventIds = plans.map((p) => p.calendar_event_id).filter(Boolean);
  const events = new Map<string, any>();
  if (eventIds.length) {
    const { data: evRows } = await db
      .from("calendar_events_cache").select("id, start_time").in("id", eventIds);
    (evRows ?? []).forEach((e: any) => events.set(e.id, e));
  }

  const forecastCache = new Map<string, Forecast | null>();
  const wardrobeCache = new Map<string, SuggestOutfitItem[]>();

  for (const plan of plans) {
    // --- where is this plan happening? ---
    let lat: number | null = null;
    let lon: number | null = null;
    const activity = plan.trip_activity_id ? activities.get(plan.trip_activity_id) : null;
    if (activity) {
      const dest = activity.destination_id
        ? destinations.get(activity.destination_id)
        : (tripDestinations.get(activity.trip_id) ?? []).find(
            (d: any) => plan.date >= d.start_date && plan.date <= d.end_date,
          ) ?? (tripDestinations.get(activity.trip_id) ?? [])[0];
      lat = dest?.latitude != null ? Number(dest.latitude) : null;
      lon = dest?.longitude != null ? Number(dest.longitude) : null;
    } else {
      const prof = profiles.get(plan.user_id);
      lat = prof?.latitude != null ? Number(prof.latitude) : null;
      lon = prof?.longitude != null ? Number(prof.longitude) : null;
    }
    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) { result.skipped++; continue; }

    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (!forecastCache.has(key)) forecastCache.set(key, await fetchForecast(lat, lon));
    const forecast = forecastCache.get(key) ?? null;
    if (!forecast) { result.errors++; continue; } // no fetch → no weather_checked_at update

    // --- when does it start? ---
    // Only calendar events carry a real clock time; the other two slots
    // get a nominal local hour, used ONLY for this window check.
    let plannedAt: number;
    if (plan.calendar_event_id && events.get(plan.calendar_event_id)?.start_time) {
      plannedAt = Date.parse(events.get(plan.calendar_event_id).start_time);
    } else if (activity) {
      plannedAt = localToEpoch(plan.date, SEGMENT_HOURS[activity.day_segment ?? "day"] ?? 8, forecast.utcOffsetSeconds);
    } else {
      plannedAt = localToEpoch(plan.date, GENERAL_PLAN_HOUR, forecast.utcOffsetSeconds);
    }
    if (!Number.isFinite(plannedAt) || plannedAt <= now || plannedAt - now > WINDOW_MS) { result.skipped++; continue; }

    const day = forecast.days[plan.date];
    if (!day) { result.skipped++; continue; }

    // --- significant change? ---
    const oldTemp = plan.weather_temp != null ? Number(plan.weather_temp) : null;
    const oldCode = plan.weather_code != null ? Number(plan.weather_code) : null;
    const hasBaseline = oldTemp != null || oldCode != null;
    const tempJump = oldTemp != null && Math.abs(day.tempMax - oldTemp) >= SIGNIFICANT_TEMP_DELTA;
    const bandFlip = oldTemp != null && classifyTemp(oldTemp) !== classifyTemp(day.tempMax);
    const rainFlip = oldCode != null && isRainyCode(oldCode) !== isRainyCode(day.code);
    const significant = hasBaseline && (tempJump || bandFlip || rainFlip);

    result.checked++;
    await db.from("outfit_plans").update({ weather_checked_at: new Date().toISOString() }).eq("id", plan.id);

    if (!hasBaseline) {
      // No baseline to compare against: record one so the next run can.
      await db.from("outfit_plans").update({
        weather_temp: day.tempMax,
        weather_condition: describeWeather(day.code).label,
        weather_code: day.code,
        weather_precipitation_probability: day.precipitation,
      }).eq("id", plan.id);
      continue;
    }
    if (!significant) continue;

    // --- adapt the outfit ---
    if (!wardrobeCache.has(plan.user_id)) {
      const { data: itemRows } = await db
        .from("wardrobe_items")
        .select("id, category, subcategory, colors, style, season, brand, material, location_id")
        .eq("user_id", plan.user_id)
        .eq("archived", false);
      wardrobeCache.set(plan.user_id, (itemRows ?? []).map((it: any) => ({
        id: it.id,
        category: it.category,
        subcategory: it.subcategory,
        colors: it.colors,
        style: it.style ? [String(it.style)] : [],
        season: it.season,
        brand: it.brand,
        material: it.material,
        locationId: it.location_id,
      })));
    }
    const items = wardrobeCache.get(plan.user_id) ?? [];
    if (!items.length) { result.skipped++; continue; }

    const prof = profiles.get(plan.user_id);
    const suggestion = await suggestOutfitCore({
      supabase: db,
      userId: plan.user_id,
      temperature: day.tempMax,
      condition: describeWeather(day.code).label,
      occasion: plan.occasion ?? null,
      dressRules: null,
      gender: prof?.gender ?? null,
      styleBoldness: prof?.style_boldness ?? null,
      items,
      baseItemIds: plan.item_ids ?? [],
      // A trip plan builds from what's packed for that destination, not
      // from the home location, so don't force the active location here.
      locationIdOverride: activity ? null : undefined,
    });
    if (!suggestion.ok || !suggestion.item_ids.length) { result.errors++; continue; }

    await upsertWeatherNotification(db, {
      plan,
      day,
      newItemIds: suggestion.item_ids,
      explanation: suggestion.explanation,
      itemsById: new Map(items.map((i) => [i.id, i])),
      tripId: activity?.trip_id ?? plan.trip_id ?? null,
      activityId: plan.trip_activity_id ?? null,
    });
    result.changed++;
  }

  return result;
}

function labelFor(item: SuggestOutfitItem | undefined): string | null {
  if (!item) return null;
  const parts = [item.colors?.[0], item.brand, item.subcategory || item.category].filter(Boolean);
  return parts.length ? String(parts.join(" ")).toLowerCase() : null;
}

async function upsertWeatherNotification(
  db: any,
  args: {
    plan: any;
    day: DayForecast;
    newItemIds: string[];
    explanation: string;
    itemsById: Map<string, SuggestOutfitItem>;
    tripId: string | null;
    activityId: string | null;
  },
) {
  const { plan, day, newItemIds, explanation, itemsById } = args;
  const oldItemIds: string[] = plan.item_ids ?? [];
  const dropped = oldItemIds.filter((id) => !newItemIds.includes(id));
  const added = newItemIds.filter((id) => !oldItemIds.includes(id));

  const weekday = new Date(`${plan.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const condition = describeWeather(day.code).label;
  const title = `Weather changed for your ${weekday} outfit`;

  const lines: string[] = [];
  const droppedLabels = dropped.map((id) => labelFor(itemsById.get(id))).filter(Boolean) as string[];
  const addedLabels = added.map((id) => labelFor(itemsById.get(id))).filter(Boolean) as string[];
  if (droppedLabels.length) {
    lines.push(`${condition} expected — your ${droppedLabels.slice(0, 2).join(" and ")} may not be ideal.`);
    if (addedLabels.length) lines.push(`Suggested: ${addedLabels.slice(0, 2).join(" and ")} instead.`);
  } else {
    lines.push(`${condition} expected, around ${Math.round(day.tempMax)}°. ${explanation}`.trim());
  }
  if (day.precipitation > UMBRELLA_PRECIPITATION_THRESHOLD) {
    lines.push(`${Math.round(day.precipitation)}% chance of rain — don't forget your umbrella.`);
  }

  const data = {
    plan_id: plan.id,
    date: plan.date,
    trip_id: args.tripId,
    trip_activity_id: args.activityId,
    old_temp: plan.weather_temp != null ? Number(plan.weather_temp) : null,
    old_condition: plan.weather_condition ?? null,
    old_precipitation_probability: plan.weather_precipitation_probability != null
      ? Number(plan.weather_precipitation_probability) : null,
    old_weather_code: plan.weather_code != null ? Number(plan.weather_code) : null,
    new_temp: day.tempMax,
    new_condition: condition,
    new_precipitation_probability: day.precipitation,
    new_weather_code: day.code,
    old_item_ids: oldItemIds,
    new_item_ids: newItemIds,
  };

  // One open proposal per plan, always: an existing unresolved one is
  // refreshed with the newest forecast rather than duplicated.
  const { data: existing } = await db
    .from("notifications")
    .select("id")
    .eq("user_id", plan.user_id)
    .eq("type", "weather_change")
    .in("status", ["unread", "read"])
    .contains("data", { plan_id: plan.id })
    .maybeSingle();

  const body = lines.join("\n");
  if (existing?.id) {
    await db.from("notifications")
      .update({ title, body, data, status: "unread", read_at: null, created_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await db.from("notifications").insert({
      user_id: plan.user_id, type: "weather_change", title, body, data, status: "unread",
    });
  }
}
