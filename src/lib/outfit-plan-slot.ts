import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Single source of truth for WHICH unique slot an outfit plan occupies.
 *
 * outfit_plans carries three mutually exclusive unique constraints:
 *   - outfit_plans_one_per_event        UNIQUE (calendar_event_id)
 *   - outfit_plans_one_general_per_date UNIQUE (user_id, general_date)
 *   - outfit_plans_one_per_trip_segment UNIQUE (trip_id, date, day_segment)
 *
 * `general_date` is a GENERATED column: it equals `date` only when both
 * calendar_event_id and trip_id are NULL. So a plan tied to an event does
 * NOT occupy the general slot — that's exactly what lets a "Work" outfit
 * for a calendar event coexist with a generic outfit on the same day.
 *
 * Writing with the wrong onConflict is what produced
 * "duplicate key value violates unique constraint outfit_plans_one_per_event":
 * an upsert targeting user_id,general_date can't resolve a conflict on
 * calendar_event_id, so Postgres raises instead of updating.
 *
 * TECHNICAL DEBT: calendar_events_cache rows are keyed by
 * (connection_id, external_event_id). If a calendar connection is removed and
 * re-created, the same real-world event gets a NEW id, the FK
 * (ON DELETE SET NULL) clears calendar_event_id on existing plans, and those
 * plans silently become "general" plans — which can then collide on
 * (user_id, general_date). A durable fix means keying plans on
 * (user_id, provider, external_event_id) instead of the cache row id.
 */
export type PlanSlot =
  | { kind: "event"; onConflict: "calendar_event_id" }
  | { kind: "general"; onConflict: "user_id,general_date" }
  | { kind: "trip"; onConflict: "trip_id,date,day_segment" };

export function resolvePlanSlot(input: {
  calendarEventId?: string | null;
  tripId?: string | null;
}): PlanSlot {
  if (input.calendarEventId) return { kind: "event", onConflict: "calendar_event_id" };
  if (input.tripId) return { kind: "trip", onConflict: "trip_id,date,day_segment" };
  return { kind: "general", onConflict: "user_id,general_date" };
}

/**
 * Guards an event-linked write: the event must belong to the same user and
 * fall on the plan's date. Returns an error string when the write must be
 * refused, or null when it's safe.
 *
 * Dates are compared with a one-day tolerance on purpose: start_time is a
 * timestamptz rendered in UTC, while the plan date is the person's local
 * calendar day, so a late-evening or early-morning event legitimately differs
 * by a day from its UTC rendering. Anything beyond that is a genuine mismatch.
 */
export async function validateEventSlot(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  calendarEventId: string,
  date: string,
): Promise<string | null> {
  const { data, error } = await (supabase.from("calendar_events_cache" as never) as any)
    .select("id, user_id, start_time")
    .eq("id", calendarEventId)
    .maybeSingle();

  if (error) return `Could not verify the calendar event: ${error.message}`;
  if (!data) return "That calendar event no longer exists — reconnect your calendar and try again.";
  if (data.user_id !== userId) return "That calendar event belongs to another account.";

  const eventDay = String(data.start_time).slice(0, 10);
  const diffDays = Math.abs(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${eventDay}T00:00:00Z`)) / 86_400_000,
  );
  if (!Number.isFinite(diffDays) || diffDays > 1) {
    return `The outfit date (${date}) doesn't match the calendar event date (${eventDay}).`;
  }
  return null;
}
