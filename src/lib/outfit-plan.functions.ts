import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolvePlanSlot, validateEventSlot } from "./outfit-plan-slot";

const InputSchema = z.object({
  itemIds: z.array(z.string()).min(1),
  date: z.string(), // YYYY-MM-DD
  calendarEventId: z.string().nullable().optional(),
});

/**
 * Punto unico per salvare un outfit nel planner — promemoria/sync futuri vivranno qui.
 *
 * Lo slot (evento / generale / viaggio) e il relativo onConflict arrivano da
 * resolvePlanSlot, così un piano legato a un evento non finisce mai nello slot
 * generale (e viceversa). Vedi outfit-plan-slot.ts anche per il debito tecnico
 * sugli id di calendar_events_cache che cambiano se la connessione calendario
 * viene ricreata.
 */
export const saveOutfitPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const calendarEventId = data.calendarEventId ?? null;

    if (calendarEventId) {
      const problem = await validateEventSlot(context.supabase, context.userId, calendarEventId, data.date);
      if (problem) throw new Error(problem);
    }

    const payload = {
      user_id: context.userId,
      date: data.date,
      item_ids: data.itemIds,
      calendar_event_id: calendarEventId,
    };
    const { onConflict } = resolvePlanSlot({ calendarEventId });
    const { error } = await context.supabase
      .from("outfit_plans")
      .upsert(payload, { onConflict });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
