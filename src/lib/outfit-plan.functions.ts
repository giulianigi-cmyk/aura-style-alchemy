import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  itemIds: z.array(z.string()).min(1),
  date: z.string(), // YYYY-MM-DD
  calendarEventId: z.string().nullable().optional(),
});

/**
 * Punto unico per salvare un outfit nel planner — promemoria/sync futuri vivranno qui.
 *
 * Ogni giorno può avere UN plan "general" (calendar_event_id IS NULL) e UN plan
 * per ciascun evento (calendar_event_id = <id>) — vincolo DB
 * outfit_plans_one_general_per_date. Gli upsert usano esattamente il vincolo
 * dello slot: calendar_event_id per gli eventi, user_id + general_date per il
 * piano generale.
 */
export const saveOutfitPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const calendarEventId = data.calendarEventId ?? null;

    const payload = {
      user_id: context.userId,
      date: data.date,
      item_ids: data.itemIds,
      calendar_event_id: calendarEventId,
    };
    const onConflict = calendarEventId ? "calendar_event_id" : "user_id,general_date";
    const { error } = await context.supabase
      .from("outfit_plans")
      .upsert(payload, { onConflict });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
