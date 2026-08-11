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
 * outfit_plans_one_general_per_date. Un semplice insert quindi fallisce non
 * appena esiste già un plan per quello slot: bisogna prima cercarlo e fare
 * update, esattamente come fa Planner.tsx.
 */
export const saveOutfitPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const calendarEventId = data.calendarEventId ?? null;

    let existingQuery = context.supabase
      .from("outfit_plans")
      .select("id")
      .eq("user_id", context.userId)
      .eq("date", data.date);

    existingQuery = calendarEventId
      ? existingQuery.eq("calendar_event_id", calendarEventId)
      : existingQuery.is("calendar_event_id", null);

    const { data: existing, error: findError } = await existingQuery.maybeSingle();
    if (findError) throw new Error(findError.message);

    if (existing) {
      const { error } = await context.supabase
        .from("outfit_plans")
        .update({ item_ids: data.itemIds })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true as const };
    }

    const { error } = await context.supabase.from("outfit_plans").insert({
      user_id: context.userId,
      date: data.date,
      item_ids: data.itemIds,
      calendar_event_id: calendarEventId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
