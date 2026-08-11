import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type TripPackingItem = {
  id: string;
  trip_id: string;
  item_id: string;
  status: "to_pack" | "packed" | "left_home";
  created_at: string;
};

const AddTripPackingItemSchema = z.object({
  tripId: z.string().uuid(),
  itemId: z.string().uuid(),
});

/** Ownership checked via the parent trip, same pattern as the other
 *  trip child tables — trip_packing_items has no user_id of its own.
 *  The unique(trip_id, item_id) constraint makes a duplicate add a no-op
 *  error rather than a silent double row, so callers should expect that
 *  re-adding an already-packed piece can fail and treat it as harmless. */
export const addTripPackingItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddTripPackingItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: trip } = await (supabase.from("trips" as never) as any)
      .select("id").eq("id", data.tripId).eq("user_id", userId).maybeSingle();
    if (!trip) throw new Error("Trip not found");

    const { data: row, error } = await (supabase.from("trip_packing_items" as never) as any)
      .insert({ trip_id: data.tripId, item_id: data.itemId, status: "to_pack" })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { item: row as TripPackingItem };
  });

const UpdateTripPackingItemSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["to_pack", "packed", "left_home"]),
});

export const updateTripPackingItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateTripPackingItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await (supabase.from("trip_packing_items" as never) as any)
      .update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const RemoveTripPackingItemSchema = z.object({ id: z.string().uuid() });

export const removeTripPackingItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveTripPackingItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await (supabase.from("trip_packing_items" as never) as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
