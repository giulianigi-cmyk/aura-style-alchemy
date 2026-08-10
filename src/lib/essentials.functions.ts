import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type EssentialPreset = { id: string; user_id: string; name: string; created_at: string };
export type EssentialPresetItem = {
  id: string; preset_id: string; category: string | null; name: string;
  quantity: number; always_include: boolean; position: number;
};
export type TripEssential = {
  id: string; trip_id: string; category: string | null; name: string;
  quantity: number; status: "to_pack" | "packed" | "left_home";
};

const ItemInput = z.object({
  category: z.string().trim().max(60).nullable().optional(),
  name: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(99).default(1),
  alwaysInclude: z.boolean().default(true),
});

export const listEssentialPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: presets, error } = await (supabase.from("essential_presets" as never) as any)
      .select("*").eq("user_id", userId).order("created_at");
    if (error) throw new Error(error.message);

    const presetIds = ((presets ?? []) as EssentialPreset[]).map((p) => p.id);
    let items: EssentialPresetItem[] = [];
    if (presetIds.length) {
      const { data } = await (supabase.from("essential_preset_items" as never) as any)
        .select("*").in("preset_id", presetIds).order("position");
      items = (data ?? []) as EssentialPresetItem[];
    }
    const itemsByPreset = new Map<string, EssentialPresetItem[]>();
    items.forEach((it) => {
      const arr = itemsByPreset.get(it.preset_id) ?? [];
      arr.push(it);
      itemsByPreset.set(it.preset_id, arr);
    });

    return {
      presets: ((presets ?? []) as EssentialPreset[]).map((p) => ({
        ...p,
        items: itemsByPreset.get(p.id) ?? [],
      })),
    };
  });

const CreatePresetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  items: z.array(ItemInput).default([]),
});

export const createEssentialPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreatePresetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: preset, error } = await (supabase.from("essential_presets" as never) as any)
      .insert({ user_id: userId, name: data.name }).select("*").single();
    if (error || !preset) throw new Error(error?.message ?? "Couldn't create preset");
    const presetId = (preset as EssentialPreset).id;

    if (data.items.length) {
      const { error: itemErr } = await (supabase.from("essential_preset_items" as never) as any)
        .insert(data.items.map((it, i) => ({
          preset_id: presetId,
          category: it.category || null,
          name: it.name,
          quantity: it.quantity,
          always_include: it.alwaysInclude,
          position: i,
        })));
      if (itemErr) throw new Error(itemErr.message);
    }
    return { preset: preset as EssentialPreset };
  });

const PresetIdSchema = z.object({ presetId: z.string().uuid() });

export const deleteEssentialPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PresetIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await (supabase.from("essential_presets" as never) as any)
      .delete().eq("id", data.presetId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const ReplaceItemsSchema = z.object({
  presetId: z.string().uuid(),
  items: z.array(ItemInput),
});

/** Simplest reliable way to edit a preset's contents from the UI: replace
 *  the whole item list in one call, rather than diffing add/remove/edit
 *  operations against a small list that's rarely more than a dozen rows. */
export const replacePresetItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReplaceItemsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: owned } = await (supabase.from("essential_presets" as never) as any)
      .select("id").eq("id", data.presetId).eq("user_id", userId).maybeSingle();
    if (!owned) throw new Error("Preset not found");

    await (supabase.from("essential_preset_items" as never) as any).delete().eq("preset_id", data.presetId);
    if (data.items.length) {
      const { error } = await (supabase.from("essential_preset_items" as never) as any)
        .insert(data.items.map((it, i) => ({
          preset_id: data.presetId,
          category: it.category || null,
          name: it.name,
          quantity: it.quantity,
          always_include: it.alwaysInclude,
          position: i,
        })));
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

const ApplyPresetSchema = z.object({
  tripId: z.string().uuid(),
  presetIds: z.array(z.string().uuid()).min(1),
});

/** Copies preset items into trip_essentials as an independent snapshot —
 *  editing "Business" later never retroactively changes a trip that
 *  already copied from it. Only items with alwaysInclude=true get
 *  auto-added; the rest exist as suggestions the person can add later
 *  (not built into this pass). */
const AddPresetItemSchema = z.object({
  presetId: z.string().uuid(),
  category: z.string().trim().max(60).nullable().optional(),
  name: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(99).default(1),
});

/** Adds one item immediately — no separate "Save" step to forget. The
 *  earlier draft-then-replace-everything flow let items get typed into
 *  the UI, look present, and then vanish silently if the person closed
 *  the section before tapping Save; this removes that failure mode. */
export const addPresetItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddPresetItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: owned } = await (supabase.from("essential_presets" as never) as any)
      .select("id").eq("id", data.presetId).eq("user_id", userId).maybeSingle();
    if (!owned) throw new Error("Preset not found");
    const { data: countRows } = await (supabase.from("essential_preset_items" as never) as any)
      .select("id").eq("preset_id", data.presetId);
    const { data: row, error } = await (supabase.from("essential_preset_items" as never) as any)
      .insert({
        preset_id: data.presetId,
        category: data.category || null,
        name: data.name,
        quantity: data.quantity,
        always_include: true,
        position: (countRows ?? []).length,
      })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { item: row as EssentialPresetItem };
  });

const RemovePresetItemSchema = z.object({ id: z.string().uuid() });

export const removePresetItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemovePresetItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await (supabase.from("essential_preset_items" as never) as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const UpdatePresetItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().int().min(1).max(99).optional(),
});

export const updatePresetItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdatePresetItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.quantity !== undefined) patch.quantity = data.quantity;
    const { error } = await (supabase.from("essential_preset_items" as never) as any).update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const applyPresetsToTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ApplyPresetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: trip } = await (supabase.from("trips" as never) as any).select("id").eq("id", data.tripId).eq("user_id", userId).maybeSingle();
    if (!trip) throw new Error("Trip not found");

    const { data: items, error: itemsErr } = await (supabase.from("essential_preset_items" as never) as any)
      .select("category, name, quantity, always_include, preset_id")
      .in("preset_id", data.presetIds);
    if (itemsErr) throw new Error(itemsErr.message);

    const toInclude = ((items ?? []) as { category: string | null; name: string; quantity: number; always_include: boolean }[])
      .filter((it) => it.always_include);
    if (!toInclude.length) return { added: 0 };

    const { error } = await (supabase.from("trip_essentials" as never) as any)
      .insert(toInclude.map((it) => ({
        trip_id: data.tripId,
        category: it.category,
        name: it.name,
        quantity: it.quantity,
        status: "to_pack",
      })));
    if (error) throw new Error(error.message);
    return { added: toInclude.length };
  });

const UpdateTripEssentialSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["to_pack", "packed", "left_home"]).optional(),
  quantity: z.number().int().min(1).max(99).optional(),
});

export const updateTripEssential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateTripEssentialSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.quantity !== undefined) patch.quantity = data.quantity;
    const { error } = await (supabase.from("trip_essentials" as never) as any).update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const AddTripEssentialSchema = z.object({
  tripId: z.string().uuid(),
  category: z.string().trim().max(60).nullable().optional(),
  name: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(99).default(1),
});

export const addTripEssential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddTripEssentialSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: trip } = await (supabase.from("trips" as never) as any).select("id").eq("id", data.tripId).eq("user_id", userId).maybeSingle();
    if (!trip) throw new Error("Trip not found");
    const { data: row, error } = await (supabase.from("trip_essentials" as never) as any)
      .insert({ trip_id: data.tripId, category: data.category || null, name: data.name, quantity: data.quantity, status: "to_pack" })
      .select("*").single();
    if (error) throw new Error(error.message);
    return { item: row as TripEssential };
  });

const RemoveTripEssentialSchema = z.object({ id: z.string().uuid() });

export const removeTripEssential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveTripEssentialSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await (supabase.from("trip_essentials" as never) as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
