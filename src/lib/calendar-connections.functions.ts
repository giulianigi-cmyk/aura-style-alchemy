import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const startCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin.from("oauth_pending_connections" as never) as any)
      .insert({ user_id: context.userId, provider: "google" })
      .select("state")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not start connection");
    const { buildGoogleAuthUrl } = await import("@/lib/google-calendar.server");
    return { url: buildGoogleAuthUrl((data as { state: string }).state) };
  });

export const getCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin.from("calendar_connections" as never) as any)
      .select("provider, connected_at, last_synced_at, last_sync_error")
      .eq("user_id", context.userId)
      .eq("provider", "google")
      .maybeSingle();
    if (!data) return { connected: false as const };
    return {
      connected: true as const,
      connectedAt: (data as { connected_at: string }).connected_at,
      lastSyncedAt: (data as { last_synced_at: string | null }).last_synced_at,
      lastSyncError: (data as { last_sync_error: string | null }).last_sync_error,
    };
  });

export const disconnectCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin.from("calendar_connections" as never) as any)
      .delete().eq("user_id", context.userId).eq("provider", "google");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const syncCalendarNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { syncUserCalendar } = await import("@/lib/google-calendar.server");
    return await syncUserCalendar(context.userId);
  });
