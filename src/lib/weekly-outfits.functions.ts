import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { suggestOutfitCore, type SuggestOutfitItem } from "./ai-suggest-outfit.functions";
import { dressPreferencesToPrompt, type DressPreferences } from "./dress-preferences";

const DailyWeatherSchema = z.object({
  date: z.string(),
  tempMin: z.number(),
  tempMax: z.number(),
  weatherCode: z.number(),
});

const InputSchema = z.object({
  startDate: z.string(), // YYYY-MM-DD
  numDays: z.union([z.literal(7), z.literal(14)]),
  locationId: z.string().nullable(),
  dailyWeather: z.array(DailyWeatherSchema).default([]),
});

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Pure string slicing on purpose — an ISO timestamp like
// "2026-08-15T20:30:00+02:00" already carries the intended wall-clock
// time before the offset. Going through Date object math instead would
// silently convert to the server's own runtime timezone, which is wrong
// for a person anywhere else in the world.
function clockTime(iso: string): string {
  return iso.slice(11, 16);
}

function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Fills in the General outfit slot (see calendar_event_id on outfit_plans)
 * for each work day in the range that doesn't already have one — never
 * touches a day that's already planned, and never touches event-specific
 * slots (a dinner or gym outfit already set for that day stays exactly
 * as it is). An event-linked plan only blocks the General slot if that
 * event actually falls within the person's work hours; an evening plan
 * outside those hours doesn't stop the work outfit from being generated
 * too. Weather comes from the client's own forecast data since the
 * server has no location fix of its own; the wardrobe location is an
 * explicit per-run choice, not silently assumed from whatever's active
 * right now.
 */
export const generateWeeklyOutfits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profileRow } = await (supabase.from("profiles" as never) as any)
      .select("work_days, work_start_time, work_end_time, dress_preferences, gender, style_boldness").eq("id", userId).maybeSingle();
    const profile = profileRow as {
      work_days?: string[]; work_start_time?: string; work_end_time?: string;
      dress_preferences?: DressPreferences; gender?: string | null; style_boldness?: string | null;
    } | null;
    const workDays = profile?.work_days ?? ["MO", "TU", "WE", "TH", "FR"];
    const workStart = profile?.work_start_time ?? "09:00";
    const workEnd = profile?.work_end_time ?? "18:00";
    const dressRules = dressPreferencesToPrompt(profile?.dress_preferences ?? null);
    const gender = profile?.gender ?? null;
    const styleBoldness = profile?.style_boldness ?? null;

    const endDateExclusive = addDaysIso(data.startDate, data.numDays);

    const [{ data: itemsRaw }, { data: existingPlans }, { data: calEvents }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", userId),
      (supabase.from("outfit_plans" as never) as any)
        .select("date, calendar_event_id").eq("user_id", userId)
        .gte("date", data.startDate).lt("date", endDateExclusive),
      (supabase.from("calendar_events_cache" as never) as any)
        .select("id, title, start_time, end_time, all_day").eq("user_id", userId)
        .gte("start_time", `${data.startDate}T00:00:00`).lt("start_time", `${endDateExclusive}T00:00:00`),
    ]);

    const items: SuggestOutfitItem[] = ((itemsRaw ?? []) as any[]).map((it) => ({
      id: it.id,
      category: it.category,
      subcategory: it.subcategory,
      colors: it.colors,
      style: it.style ? [it.style] : [],
      season: it.season,
      brand: it.brand,
      material: it.material ?? [],
      locationId: it.location_id ?? null,
    }));

    const eventById = new Map(
      ((calEvents ?? []) as { id: string; title: string | null; start_time: string; end_time: string | null; all_day: boolean }[])
        .map((e) => [e.id, e]),
    );

    const plansByDate = new Map<string, { date: string; calendar_event_id: string | null }[]>();
    ((existingPlans ?? []) as { date: string; calendar_event_id: string | null }[]).forEach((p) => {
      const arr = plansByDate.get(p.date) ?? [];
      arr.push(p);
      plansByDate.set(p.date, arr);
    });

    const isWorkHoursEvent = (ev: { all_day: boolean; start_time: string; end_time: string | null }): boolean => {
      if (ev.all_day) return true;
      const evStart = clockTime(ev.start_time);
      const evEnd = ev.end_time ? clockTime(ev.end_time) : evStart;
      return timeRangesOverlap(evStart, evEnd, workStart, workEnd);
    };

    // The real work event for a day, if there is one. When it exists the
    // work outfit is written into THAT event's slot (unique on
    // calendar_event_id) rather than the day's general slot — which is what
    // lets a work outfit and a generic/evening outfit coexist on one date.
    const workEventByDate = new Map<string, { id: string; title: string | null }>();
    eventById.forEach((e) => {
      const d = e.start_time.slice(0, 10);
      if (!workEventByDate.has(d) && isWorkHoursEvent(e)) workEventByDate.set(d, { id: e.id, title: e.title });
    });

    // A day is "already handled" only if its target slot is taken: the
    // event slot when there's a work event, otherwise the general slot.
    // An evening dinner plan never blocks the work outfit.
    const isSlotTaken = (date: string, eventId: string | null): boolean => {
      const dayPlans = plansByDate.get(date) ?? [];
      return eventId
        ? dayPlans.some((p) => p.calendar_event_id === eventId)
        : dayPlans.some((p) => !p.calendar_event_id);
    };

    const eventTitleByDate = new Map<string, string>();
    eventById.forEach((e) => {
      const d = e.start_time.slice(0, 10);
      if (!eventTitleByDate.has(d) && e.title) eventTitleByDate.set(d, e.title);
    });

    const weatherByDate = new Map(data.dailyWeather.map((d) => [d.date, d]));

    const usedThisBatch: string[] = [];
    const created: { date: string }[] = [];
    const skippedExisting: string[] = [];
    const failed: { date: string; error: string }[] = [];

    for (let i = 0; i < data.numDays; i++) {
      const date = addDaysIso(data.startDate, i);
      const dow = WEEKDAY_CODES[new Date(`${date}T00:00:00`).getDay()];
      if (!workDays.includes(dow)) continue;

      const workEvent = workEventByDate.get(date) ?? null;
      const calendarEventId = workEvent?.id ?? null;
      if (isSlotTaken(date, calendarEventId)) { skippedExisting.push(date); continue; }

      // Event-linked writes are validated first: same owner, matching day.
      if (calendarEventId) {
        const problem = await validateEventSlot(supabase, userId, calendarEventId, date);
        if (problem) { failed.push({ date, error: problem }); continue; }
      }

      const w = weatherByDate.get(date);
      const occasionHint = eventTitleByDate.get(date) ? `Work · ${eventTitleByDate.get(date)}` : "Work";

      const result = await suggestOutfitCore({
        supabase, userId,
        temperature: w ? (w.tempMin + w.tempMax) / 2 : null,
        condition: null,
        occasion: occasionHint,
        dressRules,
        gender,
        styleBoldness,
        items,
        avoidItemIds: usedThisBatch,
        locationIdOverride: data.locationId,
      });

      if (!result.ok || !result.item_ids.length) {
        failed.push({ date, error: !result.ok ? result.error : "No matching pieces" });
        continue;
      }

      usedThisBatch.push(...result.item_ids);

      const { onConflict } = resolvePlanSlot({ calendarEventId });
      const { data: planRow, error: insErr } = await supabase.from("outfit_plans").upsert({
        user_id: userId,
        date,
        item_ids: result.item_ids,
        occasion: "Work",
        notes: result.explanation || null,
        weather_temp: w ? Math.round((w.tempMin + w.tempMax) / 2) : null,
        status: "planned",
        calendar_event_id: calendarEventId,
      } as never, { onConflict }).select("id").single();


      if (insErr || !planRow) {
        failed.push({ date, error: insErr?.message ?? "Could not save" });
        continue;
      }

      const { data: eventRow, error: evErr } = await (supabase.from("wardrobe_events" as never) as any)
        .insert({
          user_id: userId,
          event_type: "planned",
          event_date: date,
          outfit_plan_id: (planRow as { id: string }).id,
          occasion: "Work",
        })
        .select("id")
        .single();
      if (!evErr && eventRow) {
        const rows = result.item_ids.map((item_id) => ({ event_id: (eventRow as { id: string }).id, item_id }));
        await (supabase.from("wardrobe_event_items" as never) as any).insert(rows);
      }

      created.push({ date });
    }

    return { created: created.length, skippedExisting: skippedExisting.length, failed };
  });
