import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { WardrobeLocation } from "./wardrobe-location";

export const listLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase.from("wardrobe_locations" as never) as any)
      .select("*").eq("user_id", context.userId).order("created_at");
    if (error) throw new Error(error.message);

    const { data: profile } = await (context.supabase.from("profiles" as never) as any)
      .select("active_location_id").eq("id", context.userId).maybeSingle();

    return {
      locations: (data ?? []) as WardrobeLocation[],
      activeLocationId: (profile as { active_location_id: string | null } | null)?.active_location_id ?? null,
    };
  });

const CreateLocationSchema = z.object({
  name: z.string().trim().min(1).max(60),
  isPrimary: z.boolean().optional(),
  endDate: z.string().nullable().optional(),
});

export const createLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateLocationSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Only one primary location per person — the partial unique index
    // enforces this too, but check first for a clean error message
    // instead of a raw constraint-violation string.
    if (data.isPrimary) {
      const { error: clearErr } = await (context.supabase.from("wardrobe_locations" as never) as any)
        .update({ is_primary: false }).eq("user_id", context.userId).eq("is_primary", true);
      if (clearErr) throw new Error(clearErr.message);
    }

    const { data: row, error } = await (context.supabase.from("wardrobe_locations" as never) as any)
      .insert({ user_id: context.userId, name: data.name, is_primary: Boolean(data.isPrimary), end_date: data.endDate || null })
      .select("*").single();
    if (error) throw new Error(error.message);

    // First location a person creates becomes the active one automatically
    // — there's nothing to choose between yet.
    const { data: existing } = await (context.supabase.from("wardrobe_locations" as never) as any)
      .select("id").eq("user_id", context.userId);
    if ((existing ?? []).length === 1) {
      await (context.supabase.from("profiles" as never) as any)
        .update({ active_location_id: row.id }).eq("id", context.userId);
    }

    return { location: row as WardrobeLocation };
  });

const RenameLocationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  endDate: z.string().nullable().optional(),
});

export const renameLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RenameLocationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { name: data.name, updated_at: new Date().toISOString() };
    if (data.endDate !== undefined) patch.end_date = data.endDate || null;
    const { error } = await (context.supabase.from("wardrobe_locations" as never) as any)
      .update(patch)
      .eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const SetActiveLocationSchema = z.object({ id: z.string().uuid().nullable() });

export const setActiveLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetActiveLocationSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("profiles" as never) as any)
      .update({ active_location_id: data.id }).eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const DeleteLocationSchema = z.object({ id: z.string().uuid() });

export const deleteLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteLocationSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Items that belonged here fall back to "no location set" — never
    // silently deleted. If this was the active location, clear that too
    // so the wardrobe simply shows everything again rather than erroring.
    await (context.supabase.from("wardrobe_items" as never) as any)
      .update({ location_id: null }).eq("location_id", data.id).eq("user_id", context.userId);
    await (context.supabase.from("profiles" as never) as any)
      .update({ active_location_id: null }).eq("id", context.userId).eq("active_location_id", data.id);
    const { error } = await (context.supabase.from("wardrobe_locations" as never) as any)
      .delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const MoveItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
  locationId: z.string().uuid().nullable(),
});

export const moveItemsToLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MoveItemsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("wardrobe_items" as never) as any)
      .update({ location_id: data.locationId }).in("id", data.itemIds).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const ResolveExpirySchema = z.object({ id: z.string().uuid() });

/**
 * A location's "until" date arriving never moves anything on its own —
 * this only runs when the person explicitly confirms in the UI. Moves
 * every item currently at the expired location back to the primary one,
 * switches active location back too if it had been the expired one, and
 * clears end_date (not deleted — ready to reuse next season, e.g. the
 * same rented summer house next year).
 */
export const resolveLocationExpiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResolveExpirySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: primary } = await (context.supabase.from("wardrobe_locations" as never) as any)
      .select("id").eq("user_id", context.userId).eq("is_primary", true).maybeSingle();
    const primaryId = (primary as { id: string } | null)?.id ?? null;

    const { error: moveErr } = await (context.supabase.from("wardrobe_items" as never) as any)
      .update({ location_id: primaryId }).eq("location_id", data.id).eq("user_id", context.userId);
    if (moveErr) throw new Error(moveErr.message);

    await (context.supabase.from("profiles" as never) as any)
      .update({ active_location_id: primaryId })
      .eq("id", context.userId).eq("active_location_id", data.id);

    const { error: clearErr } = await (context.supabase.from("wardrobe_locations" as never) as any)
      .update({ end_date: null }).eq("id", data.id).eq("user_id", context.userId);
    if (clearErr) throw new Error(clearErr.message);

    return { ok: true as const };
  });
