import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type TripType = "work" | "leisure" | "mixed";
export type DaySegment = "day" | "evening";
export type PackingStatus = "to_pack" | "packed" | "left_home";

export type Trip = {
  id: string;
  user_id: string;
  name: string | null;
  trip_type: TripType;
  laundry_available: boolean;
  status: "planning" | "confirmed" | "completed";
  created_at: string;
  updated_at: string;
};

export type TripDestination = {
  id: string;
  trip_id: string;
  position: number;
  destination_name: string;
  latitude: number | null;
  longitude: number | null;
  start_date: string;
  end_date: string;
};

const DestinationInput = z.object({
  destinationName: z.string().trim().min(1).max(100),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),
});

const CreateTripSchema = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  tripType: z.enum(["work", "leisure", "mixed"]),
  laundryAvailable: z.boolean(),
  sourceLocationIds: z.array(z.string().uuid()).min(1),
  destinations: z.array(DestinationInput).min(1),
});

export const createTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateTripSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Trip name defaults to the first destination if not given — "Parigi
    // 12-18 settembre" reads better than an empty title in a list.
    const fallbackName = data.destinations[0]?.destinationName ?? null;

    const { data: trip, error: tripErr } = await (supabase.from("trips" as never) as any).insert({
      user_id: userId,
      name: data.name?.trim() || fallbackName,
      trip_type: data.tripType,
      laundry_available: data.laundryAvailable,
      status: "planning",
    } as never).select("*").single();
    if (tripErr || !trip) throw new Error(tripErr?.message ?? "Couldn't create trip");
    const tripId = (trip as Trip).id;

    const { error: locErr } = await (supabase.from("trip_source_locations" as never) as any)
      .insert(data.sourceLocationIds.map((location_id) => ({ trip_id: tripId, location_id })));
    if (locErr) throw new Error(locErr.message);

    const { error: destErr } = await (supabase.from("trip_destinations" as never) as any)
      .insert(data.destinations.map((d, i) => ({
        trip_id: tripId,
        position: i,
        destination_name: d.destinationName,
        latitude: d.latitude ?? null,
        longitude: d.longitude ?? null,
        start_date: d.startDate,
        end_date: d.endDate,
      })));
    if (destErr) throw new Error(destErr.message);

    return { trip: trip as Trip };
  });

export const listTrips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: trips, error } = await (supabase.from("trips" as never) as any)
      .select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const tripIds = ((trips ?? []) as Trip[]).map((t) => t.id);
    let destinations: TripDestination[] = [];
    if (tripIds.length) {
      const { data: destRows } = await (supabase.from("trip_destinations" as never) as any)
        .select("*").in("trip_id", tripIds).order("position");
      destinations = (destRows ?? []) as TripDestination[];
    }
    const destByTrip = new Map<string, TripDestination[]>();
    destinations.forEach((d) => {
      const arr = destByTrip.get(d.trip_id) ?? [];
      arr.push(d);
      destByTrip.set(d.trip_id, arr);
    });

    return {
      trips: ((trips ?? []) as Trip[]).map((t) => ({
        ...t,
        destinations: destByTrip.get(t.id) ?? [],
      })),
    };
  });

const TripIdSchema = z.object({ tripId: z.string().uuid() });

export const getTrip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TripIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: trip, error } = await (supabase.from("trips" as never) as any)
      .select("*").eq("id", data.tripId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!trip) throw new Error("Trip not found");

    const [{ data: destinations }, { data: sourceLocations }, { data: activities }, { data: essentials }] = await Promise.all([
      (supabase.from("trip_destinations" as never) as any).select("*").eq("trip_id", data.tripId).order("position"),
      (supabase.from("trip_source_locations" as never) as any).select("location_id").eq("trip_id", data.tripId),
      (supabase.from("trip_day_activities" as never) as any).select("*").eq("trip_id", data.tripId).order("activity_date"),
      (supabase.from("trip_essentials" as never) as any).select("*").eq("trip_id", data.tripId).order("category"),
    ]);

    return {
      trip: trip as Trip,
      destinations: (destinations ?? []) as TripDestination[],
      sourceLocationIds: ((sourceLocations ?? []) as { location_id: string }[]).map((r) => r.location_id),
      activities: activities ?? [],
      essentials: essentials ?? [],
    };
  });

const UpdateTripSchema = z.object({
  tripId: z.string().uuid(),
  name: z.string().trim().max(100).nullable().optional(),
  tripType: z.enum(["work", "leisure", "mixed"]).optional(),
  laundryAvailable: z.boolean().optional(),
  status: z.enum(["planning", "confirmed", "completed"]).optional(),
});

export const updateTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateTripSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) patch.name = data.name?.trim() || null;
    if (data.tripType !== undefined) patch.trip_type = data.tripType;
    if (data.laundryAvailable !== undefined) patch.laundry_available = data.laundryAvailable;
    if (data.status !== undefined) patch.status = data.status;

    const { error } = await (supabase.from("trips" as never) as any).update(patch as never)
      .eq("id", data.tripId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TripIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // outfit_plans linked via trip_id use ON DELETE CASCADE too, so a
    // deleted trip cleanly takes its planned outfits with it — never
    // leaves orphaned rows pointing at a trip that no longer exists.
    const { error } = await (supabase.from("trips" as never) as any).delete()
      .eq("id", data.tripId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const UpdateSourceLocationsSchema = z.object({
  tripId: z.string().uuid(),
  locationIds: z.array(z.string().uuid()).min(1),
});

export const updateTripSourceLocations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSourceLocationsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: owned } = await (supabase.from("trips" as never) as any).select("id").eq("id", data.tripId).eq("user_id", userId).maybeSingle();
    if (!owned) throw new Error("Trip not found");
    await (supabase.from("trip_source_locations" as never) as any).delete().eq("trip_id", data.tripId);
    const { error } = await (supabase.from("trip_source_locations" as never) as any)
      .insert(data.locationIds.map((location_id) => ({ trip_id: data.tripId, location_id })));
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
