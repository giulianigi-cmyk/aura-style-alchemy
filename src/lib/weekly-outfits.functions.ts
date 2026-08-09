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

/**
 * Fills in the General outfit slot (see calendar_event_id on outfit_plans)
 * for each work day in the range that doesn't already have one — never
 * touches a day that's already planned, and never touches event-specific
 * slots (a dinner or gym outfit already set for that day stays exactly
 * as it is). Weather comes from the client's own forecast data since the
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
      .select("work_days, dress_preferences").eq("id", userId).maybeSingle();
    const workDays = (profileRow as { work_days?: string[] } | null)?.work_days ?? ["MO", "TU", "WE", "TH", "FR"];
    const dressRules = dressPreferencesToPrompt(
      (profileRow as { dress_preferences?: DressPreferences } | null)?.dress_preferences ?? null,
    );

    const endDateExclusive = addDaysIso(data.startDate, data.numDays);

    const [{ data: itemsRaw }, { data: existingPlans }, { data: calEvents }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", userId),
      (supabase.from("outfit_plans" as never) as any)
        .select("date, calendar_event_id").eq("user_id", userId)
        .gte("date", data.startDate).lt("date", endDateExclusive),
      (supabase.from("calendar_events_cache" as never) as any)
        .select("title, start_time").eq("user_id", userId)
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
      locationId: it.location_id ?? null,
    }));

    const datesWithGeneralPlan = new Set(
      ((existingPlans ?? []) as { date: string; calendar_event_id: string | null }[])
        .filter((p) => !p.calendar_event_id)
        .map((p) => p.date),
    );

    const eventTitleByDate = new Map<string, string>();
    ((calEvents ?? []) as { title: string | null; start_time: string }[]).forEach((e) => {
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
      if (datesWithGeneralPlan.has(date)) { skippedExisting.push(date); continue; }

      const w = weatherByDate.get(date);
      const occasionHint = eventTitleByDate.get(date) ? `Work · ${eventTitleByDate.get(date)}` : "Work";

      const result = await suggestOutfitCore({
        supabase, userId,
        temperature: w ? (w.tempMin + w.tempMax) / 2 : null,
        condition: null,
        occasion: occasionHint,
        dressRules,
        items,
        avoidItemIds: usedThisBatch,
        locationIdOverride: data.locationId,
      });

      if (!result.ok || !result.item_ids.length) {
        failed.push({ date, error: !result.ok ? result.error : "No matching pieces" });
        continue;
      }

      usedThisBatch.push(...result.item_ids);

      const { data: planRow, error: insErr } = await supabase.from("outfit_plans").insert({
        user_id: userId,
        date,
        item_ids: result.item_ids,
        occasion: "Work",
        notes: result.explanation || null,
        weather_temp: w ? Math.round((w.tempMin + w.tempMax) / 2) : null,
        status: "planned",
        calendar_event_id: null,
      } as never).select("id").single();

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
