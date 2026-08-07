// Server-only — never imported by client code. Talks to Microsoft's
// OAuth (Entra ID) and Graph endpoints; credentials come from Lovable
// Cloud secrets (OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET), never
// shipped to the browser. Same shape/contract as google-calendar.server.ts
// on purpose — both write into the same provider-agnostic
// calendar_connections / calendar_events_cache tables.

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_CALENDARVIEW_URL = "https://graph.microsoft.com/v1.0/me/calendarView";

const SCOPES = "offline_access Calendars.Read User.Read";

const REDIRECT_URI = "https://aura-wardrobe-intelligence.lovable.app/api/public/hooks/outlook-calendar-callback";

export function buildOutlookAuthUrl(state: string): string {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  if (!clientId) throw new Error("Missing OUTLOOK_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    response_mode: "query",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
  return `${MS_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Outlook OAuth credentials");
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT_URI, grant_type: "authorization_code", scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`Outlook token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<Omit<TokenResponse, "refresh_token">> {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Outlook OAuth credentials");
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
      grant_type: "refresh_token", scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`Outlook token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

type OutlookEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isAllDay?: boolean;
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
};

async function fetchUpcomingEvents(accessToken: string): Promise<OutlookEvent[]> {
  const startDateTime = new Date(Date.now() - 7 * 86400000).toISOString();
  const endDateTime = new Date(Date.now() + 92 * 86400000).toISOString();
  const params = new URLSearchParams({
    startDateTime, endDateTime,
    $top: "250",
    $select: "id,subject,bodyPreview,isAllDay,location,start,end",
    $orderby: "start/dateTime",
  });

  const events: OutlookEvent[] = [];
  let url: string | null = `${GRAPH_CALENDARVIEW_URL}?${params.toString()}`;
  for (let page = 0; page < 2 && url; page++) {
    const res: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    if (!res.ok) throw new Error(`Outlook Calendar fetch failed: ${res.status} ${await res.text()}`);
    const json: { value?: OutlookEvent[]; "@odata.nextLink"?: string } = await res.json();
    events.push(...(json.value ?? []));
    url = json["@odata.nextLink"] ?? null;
  }
  return events;
}

export async function syncOutlookCalendar(userId: string): Promise<{ ok: boolean; error?: string; imported?: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await (supabaseAdmin.from("calendar_connections" as never) as any)
    .select("*").eq("user_id", userId).eq("provider", "outlook").maybeSingle();
  if (!conn) return { ok: false, error: "Not connected" };

  let accessToken = conn.access_token as string;
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at as string) : null;

  if (expiresAt && expiresAt.getTime() < Date.now() + 60_000) {
    if (!conn.refresh_token) {
      await (supabaseAdmin.from("calendar_connections" as never) as any)
        .update({ last_sync_error: "Token expired, no refresh token — reconnect required." }).eq("id", conn.id);
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
      const msg = e instanceof Error ? e.message : "Token refresh failed";
      await (supabaseAdmin.from("calendar_connections" as never) as any).update({ last_sync_error: msg }).eq("id", conn.id);
      return { ok: false, error: "Token refresh failed — please reconnect your calendar." };
    }
  }

  try {
    const events = await fetchUpcomingEvents(accessToken);
    const rows = events
      .filter((e) => e.start?.dateTime)
      .map((e) => ({
        user_id: userId,
        connection_id: conn.id,
        external_event_id: e.id,
        title: e.subject ?? null,
        start_time: `${e.start!.dateTime}Z`,
        end_time: e.end?.dateTime ? `${e.end.dateTime}Z` : null,
        location: e.location?.displayName ?? null,
        description: e.bodyPreview ?? null,
        all_day: Boolean(e.isAllDay),
        raw: e,
      }));

    if (rows.length) {
      const { error: upsertErr } = await (supabaseAdmin.from("calendar_events_cache" as never) as any)
        .upsert(rows, { onConflict: "connection_id,external_event_id" });
      if (upsertErr) throw new Error(upsertErr.message);
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
