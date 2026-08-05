// Google redirects the browser here after the user approves (or denies)
// calendar access. Public route — no Supabase session is required or
// expected; the `state` value (created in startCalendarConnect, see
// calendar-connections.functions.ts) is what links this callback back to
// the AURA user who started the flow.
import { createFileRoute } from "@tanstack/react-router";

const APP_URL = "https://aura-wardrobe-intelligence.lovable.app";

export const Route = createFileRoute("/api/public/hooks/google-calendar-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const deniedByUser = url.searchParams.get("error");

        if (deniedByUser) {
          return Response.redirect(`${APP_URL}/?calendar=denied`, 302);
        }
        if (!code || !state) {
          return Response.redirect(`${APP_URL}/?calendar=error`, 302);
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: pending, error: pendingErr } = await (supabaseAdmin.from("oauth_pending_connections" as never) as any)
            .select("user_id")
            .eq("state", state)
            .maybeSingle();
          if (pendingErr || !pending) {
            return Response.redirect(`${APP_URL}/?calendar=error`, 302);
          }
          const userId = (pending as { user_id: string }).user_id;

          const { exchangeCodeForTokens, syncUserCalendar } = await import("@/lib/google-calendar.server");
          const tokens = await exchangeCodeForTokens(code);

          await (supabaseAdmin.from("calendar_connections" as never) as any).upsert(
            {
              user_id: userId,
              provider: "google",
              access_token: tokens.access_token,
              ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
              token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
              connected_at: new Date().toISOString(),
              last_sync_error: null,
            },
            { onConflict: "user_id,provider" },
          );

          await (supabaseAdmin.from("oauth_pending_connections" as never) as any).delete().eq("state", state);

          await syncUserCalendar(userId);

          return Response.redirect(`${APP_URL}/?calendar=connected`, 302);
        } catch (err) {
          console.error("[AURA google-calendar] callback failed", err);
          return Response.redirect(`${APP_URL}/?calendar=error`, 302);
        }
      },
    },
  },
});
