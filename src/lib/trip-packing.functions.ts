import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type TripPackingItem = {
  id: string;
  trip_id: string;
  wardrobe_item_id: string;
  category: string | null;
  quantity: number;
  source_location_id: string | null;
  status: "to_pack" | "packed" | "left_home";
  created_at: string;
};

async function assertTripOwner(supabase: any, tripId: string, userId: string) {
  const { data, error } = await supabase
    .from("trips").select("id").eq("id", tripId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Trip not found");
}

const AddSchema = z.object({
  tripId: z.string().uuid(),
  itemId: z.string().uuid(),
  category: z.string().trim().max(60).nullable().optional(),
  sourceLocationId: z.string().uuid().nullable().optional(),
});

export const addTripPackingItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertTripOwner(supabase, data.tripId, userId);

    const { data: item, error: itemErr } = await (supabase.from("wardrobe_items") as any)
      .select("id, category").eq("id", data.itemId).eq("user_id", userId).maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!item) throw new Error("Wardrobe item not found");

    const { data: inserted, error } = await (supabase.from("trip_packing_items" as never) as any)
      .insert({
        trip_id: data.tripId,
        wardrobe_item_id: data.itemId,
        category: data.category ?? item.category ?? null,
        source_location_id: data.sourceLocationId ?? null,
        status: "to_pack",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { item: inserted as TripPackingItem };
  });

const RemoveSchema = z.object({ id: z.string().uuid() });

export const removeTripPackingItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await (supabase.from("trip_packing_items" as never) as any)
      .delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["to_pack", "packed", "left_home"]).optional(),
  quantity: z.number().int().min(1).max(99).optional(),
  category: z.string().trim().max(60).nullable().optional(),
});

export const updateTripPackingItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.quantity !== undefined) patch.quantity = data.quantity;
    if (data.category !== undefined) patch.category = data.category;

    const { data: updated, error } = await (supabase.from("trip_packing_items" as never) as any)
      .update(patch).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    return { item: updated as TripPackingItem };
  });
