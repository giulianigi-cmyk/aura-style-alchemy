// Server-only — never imported by client code. Talks to Google's OAuth
// and Calendar endpoints directly; credentials come from Lovable Cloud
// secrets (GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET),
// never shipped to the browser.

import { computeRemovedEventIds } from "./calendar-sync-diff";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const REDIRECT_URI = "https://aura-wardrobe-intelligence.lovable.app/api/public/hooks/google-calendar-callback";

export function buildGoogleAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!clientId) throw new Error("Missing GOOGLE_CALENDAR_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Google OAuth credentials");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<Omit<TokenResponse, "refresh_token">> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Google OAuth credentials");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

type GoogleEvent = {
  id: string; summary?: string; location?: string; description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

async function fetchUpcomingEvents(accessToken: string): Promise<GoogleEvent[]> {
  const timeMin = new Date(Date.now() - 7 * 86400000).toISOString();
  const timeMax = new Date(Date.now() + 92 * 86400000).toISOString();
  const params = new URLSearchParams({
    timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "500",
  });

  const res = await fetch(`${GOOGLE_CALENDAR_EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google Calendar fetch failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.items ?? []) as GoogleEvent[];
}

export async function syncUserCalendar(userId: string): Promise<{ ok: boolean; error?: string; imported?: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await (supabaseAdmin.from("calendar_connections" as never) as any)
    .select("*").eq("user_id", userId).eq("provider", "google").maybeSingle();
  if (!conn) return { ok: false, error: "Not connected" };

  let accessToken = conn.access_token as string;
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at as string) : null;

  if (expiresAt && expiresAt.getTime() < Date.now() + 60_000) {
    if (!conn.refresh_token) {
      const msg = "RECONNECT_REQUIRED: No refresh token on file — please reconnect your calendar.";
      await (supabaseAdmin.from("calendar_connections" as never) as any)
        .update({ last_sync_error: msg }).eq("id", conn.id);
      return { ok: false, error: "Token expired — please reconnect your calendar." };
    }
    try {
      const refreshed = await refreshAccessToken(conn.refresh_token as string);
      accessToken = refreshed.access_token;
      await (supabaseAdmin.from("calendar_connections" as never) as any).update({
        access_token: accessToken,
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      }).eq("id", conn.id);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Token refresh failed";
      // Google returns invalid_grant when the refresh token itself is
      // expired or was revoked — the only fix is a fresh OAuth consent,
      // "Sync now" retrying the same refresh token will never succeed.
      const friendly = /invalid_grant/i.test(raw)
        ? "Google Calendar access has expired or was revoked. Please reconnect."
        : raw;
      const msg = `RECONNECT_REQUIRED: ${friendly}`;
      await (supabaseAdmin.from("calendar_connections" as never) as any).update({ last_sync_error: msg }).eq("id", conn.id);
      return { ok: false, error: "Token refresh failed — please reconnect your calendar." };
    }
  }

  try {
    const events = await fetchUpcomingEvents(accessToken);
    const rows = events
      .filter((e) => e.start)
      .map((e) => {
        const isAllDay = !!e.start?.date;
        return {
          user_id: userId,
          connection_id: conn.id,
          external_event_id: e.id,
          title: e.summary ?? null,
          start_time: isAllDay ? new Date(`${e.start!.date}T00:00:00Z`).toISOString() : e.start!.dateTime,
          end_time: e.end ? (e.end.date ? new Date(`${e.end.date}T00:00:00Z`).toISOString() : e.end.dateTime) : null,
          location: e.location ?? null,
          description: e.description ?? null,
          all_day: isAllDay,
          raw: e,
          // Explicit reset: an event that was previously flagged removed
          // and has now reappeared in the source is no longer removed.
          removed_from_source: false,
        };
      });

    // Snapshot of what was cached for this connection BEFORE this sync,
    // taken before the upsert below changes anything — needed to detect
    // which of those ids the provider no longer returned. Only rows not
    // already flagged removed are considered, so a re-sync doesn't keep
    // resetting removed_detected_at on something already known gone.
    const { data: previouslyCached } = await (supabaseAdmin.from("calendar_events_cache" as never) as any)
      .select("external_event_id")
      .eq("connection_id", conn.id)
      .eq("removed_from_source", false);
    const previouslyCachedIds = ((previouslyCached ?? []) as { external_event_id: string }[]).map((r) => r.external_event_id);

    if (rows.length) {
      const { error: upsertErr } = await (supabaseAdmin.from("calendar_events_cache" as never) as any)
        .upsert(rows, { onConflict: "connection_id,external_event_id" });
      if (upsertErr) throw new Error(upsertErr.message);
    }

    const removedIds = computeRemovedEventIds(previouslyCachedIds, rows.map((r) => r.external_event_id));
    if (removedIds.length) {
      await (supabaseAdmin.from("calendar_events_cache" as never) as any)
        .update({ removed_from_source: true, removed_detected_at: new Date().toISOString() })
        .eq("connection_id", conn.id)
        .in("external_event_id", removedIds);
    }

    await (supabaseAdmin.from("calendar_connections" as never) as any)
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", conn.id);

    return { ok: true, imported: rows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    await (supabaseAdmin.from("calendar_connections" as never) as any).update({ last_sync_error: msg }).eq("id", conn.id);
    return { ok: false, error: msg };
  }
}
