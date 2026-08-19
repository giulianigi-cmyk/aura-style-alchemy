import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Resolution of a weather_change proposal.
 *
 * "Keep original" is deliberately NOT a no-op: the hourly worker looks for
 * an unresolved (unread/read) notification per plan, so a proposal the
 * user rejected must be marked `dismissed` or it would be regenerated on
 * the next run forever.
 *
 * Note what these do NOT touch: `weather_checked_at`. That column means
 * "when AURA last verified the forecast" — accepting a proposal at 09:17
 * must leave a 09:00 check at 09:00. The acceptance moment is `updated_at`
 * on the plan (maintained by its trigger).
 */

const Schema = z.object({ notificationId: z.string().uuid() });

type WeatherChangeData = {
  plan_id?: string;
  new_item_ids?: string[];
  new_temp?: number | null;
  new_condition?: string | null;
  new_precipitation_probability?: number | null;
  new_weather_code?: number | null;
};

export const acceptWeatherProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: notif, error } = await (supabase.from("notifications" as never) as any)
      .select("id, type, status, data")
      .eq("id", data.notificationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!notif || notif.type !== "weather_change") throw new Error("Proposal not found");

    const payload = (notif.data ?? {}) as WeatherChangeData;
    if (!payload.plan_id || !payload.new_item_ids?.length) throw new Error("Proposal has no alternative outfit");

    const { error: planErr } = await (supabase.from("outfit_plans" as never) as any)
      .update({
        item_ids: payload.new_item_ids,
        weather_temp: payload.new_temp ?? null,
        weather_condition: payload.new_condition ?? null,
        weather_code: payload.new_weather_code ?? null,
        weather_precipitation_probability: payload.new_precipitation_probability ?? null,
      })
      .eq("id", payload.plan_id)
      .eq("user_id", userId);
    if (planErr) throw new Error(planErr.message);

    const { error: notifErr } = await (supabase.from("notifications" as never) as any)
      .update({ status: "accepted", read_at: new Date().toISOString() })
      .eq("id", notif.id);
    if (notifErr) throw new Error(notifErr.message);

    return { ok: true as const, itemIds: payload.new_item_ids };
  });

const ResolveSchema = z.object({
  notificationId: z.string().uuid(),
  status: z.enum(["dismissed", "accepted", "read"]),
});

/** Used by "Keep original" (dismissed) and by "Customize" once the user
 *  has finished editing the plan by hand. */
export const resolveWeatherProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResolveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.from("notifications" as never) as any)
      .update({ status: data.status, read_at: new Date().toISOString() })
      .eq("id", data.notificationId)
      .eq("type", "weather_change");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Open (unresolved) weather proposals for the current user, keyed by plan. */
export const listOpenWeatherProposals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase.from("notifications" as never) as any)
      .select("id, title, body, data, created_at, status")
      .eq("type", "weather_change")
      .in("status", ["unread", "read"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string; title: string; body: string | null; created_at: string; status: string;
      data: WeatherChangeData & { date?: string; old_item_ids?: string[]; trip_id?: string | null; trip_activity_id?: string | null };
    }>;
  });
