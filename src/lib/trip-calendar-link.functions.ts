import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolvePlanSlot } from "./outfit-plan-slot";

export type CalendarEventForTrip = {
  id: string;
  title: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
};

const ListSchema = z.object({ tripId: z.string().uuid() });

/**
 * Real calendar events (Apple/Yahoo/Google/Outlook, already synced into
 * calendar_events_cache) that fall within this trip's date span — the
 * pool "Choose from calendar" picks from. Deliberately NEVER auto-added
 * to a trip: a person's calendar during a trip's dates is full of things
 * that have nothing to do with the trip itself (a friend's birthday, a
 * recurring reminder) — surfacing them here as a pick list, not
 * importing them, is what keeps those out of trip activities and
 * capsule generation entirely unless explicitly chosen.
 *
 * Also excludes events the person already dismissed elsewhere (Planner —
 * dismissed_by_user) and events no longer in the source calendar
 * (removed_from_source): neither belongs in a "pick one to import" list.
 */
export const listCalendarEventsForTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: trip } = await (supabase.from("trips" as never) as any)
      .select("id").eq("id", data.tripId).eq("user_id", userId).maybeSingle();
    if (!trip) throw new Error("Trip not found");

    const { data: destinations } = await (supabase.from("trip_destinations" as never) as any)
      .select("start_date, end_date").eq("trip_id", data.tripId);
    const rows = (destinations ?? []) as { start_date: string; end_date: string }[];
    if (!rows.length) return { events: [] as CalendarEventForTrip[] };

    const minDate = rows.map((d) => d.start_date).sort()[0];
    const maxDate = rows.map((d) => d.end_date).sort().slice(-1)[0];

    // Already-linked events (to this trip specifically) are excluded —
    // no point offering to re-import something already sitting in the
    // activity list below.
    const { data: linked } = await (supabase.from("trip_day_activities" as never) as any)
      .select("calendar_event_id").eq("trip_id", data.tripId).not("calendar_event_id", "is", null);
    const linkedIds = new Set(((linked ?? []) as { calendar_event_id: string }[]).map((r) => r.calendar_event_id));

    const { data: events, error } = await (supabase.from("calendar_events_cache" as never) as any)
      .select("id, title, start_time, end_time, all_day")
      .eq("user_id", userId)
      .eq("dismissed_by_user", false)
      .eq("removed_from_source", false)
      .gte("start_time", `${minDate}T00:00:00Z`)
      .lte("start_time", `${maxDate}T23:59:59Z`)
      .order("start_time");
    if (error) throw new Error(error.message);

    const filtered = ((events ?? []) as CalendarEventForTrip[]).filter((e) => !linkedIds.has(e.id));
    return { events: filtered };
  });

const ImportSchema = z.object({
  tripId: z.string().uuid(),
  calendarEventId: z.string().uuid(),
});

/**
 * Turns a real calendar event into a trip activity, prefilled from the
 * event itself (title → activity type, local date, day/evening guessed
 * from the hour). If that event already has an outfit attached (saved
 * via the Stylist chat's "add to calendar" action, or the Planner —
 * anything that wrote to outfit_plans with this calendar_event_id),
 * that outfit's item_ids come back too, so the caller can offer to
 * reuse it instead of generating a fresh one from scratch.
 */
export const importCalendarEventToTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ImportSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: trip } = await (supabase.from("trips" as never) as any)
      .select("id").eq("id", data.tripId).eq("user_id", userId).maybeSingle();
    if (!trip) throw new Error("Trip not found");

    const { data: event, error: eventErr } = await (supabase.from("calendar_events_cache" as never) as any)
      .select("id, title, start_time, end_time, all_day")
      .eq("id", data.calendarEventId).eq("user_id", userId).maybeSingle();
    if (eventErr) throw new Error(eventErr.message);
    if (!event) throw new Error("That calendar event no longer exists — reconnect your calendar and try again.");

    const startDate = new Date(event.start_time);
    const activityDate = startDate.toISOString().slice(0, 10);
    // Simple, deliberately coarse day/evening split — a person can
    // always correct it by hand afterward like any other activity.
    const daySegment = startDate.getUTCHours() >= 17 ? "evening" : "day";

    const { data: activityRow, error: insErr } = await (supabase.from("trip_day_activities" as never) as any)
      .insert({
        trip_id: data.tripId,
        activity_date: activityDate,
        activity_type: event.title || "Untitled event",
        day_segment: daySegment,
        calendar_event_id: event.id,
      })
      .select("*").single();
    if (insErr) throw new Error(insErr.message);

    const { data: existingPlan } = await (supabase.from("outfit_plans" as never) as any)
      .select("item_ids, occasion")
      .eq("calendar_event_id", event.id)
      .eq("user_id", userId)
      .maybeSingle();

    return {
      activity: activityRow,
      existingOutfit: existingPlan ? { itemIds: existingPlan.item_ids as string[], occasion: existingPlan.occasion as string | null } : null,
    };
  });

const LinkOutfitSchema = z.object({
  tripId: z.string().uuid(),
  tripActivityId: z.string().uuid(),
  itemIds: z.array(z.string()).min(1),
  occasion: z.string().nullable().optional(),
  date: z.string(),
});

/**
 * Copies an already-planned outfit's pieces into a NEW plan for this
 * trip activity, rather than mutating the original event-linked plan —
 * outfit_plans keeps event/general/trip-activity as separate, mutually
 * exclusive slots (see outfit-plan-slot.ts), so the two stay independent:
 * editing the trip version later never touches the original calendar
 * event's own plan, and vice versa.
 */
export const linkExistingOutfitToTripActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LinkOutfitSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const payload = {
      user_id: userId,
      trip_id: data.tripId,
      trip_activity_id: data.tripActivityId,
      date: data.date,
      item_ids: data.itemIds,
      occasion: data.occasion ?? null,
    };
    const { onConflict } = resolvePlanSlot({ tripActivityId: data.tripActivityId });
    const { error } = await supabase.from("outfit_plans").upsert(payload, { onConflict });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
