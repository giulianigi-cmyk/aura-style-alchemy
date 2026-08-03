import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  itemIds: z.array(z.string()).min(1),
  date: z.string(), // YYYY-MM-DD
});

/** Punto unico per salvare un outfit nel planner — promemoria/sync futuri vivranno qui. */
export const saveOutfitPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("outfit_plans").insert({
      user_id: context.userId,
      date: data.date,
      item_ids: data.itemIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
