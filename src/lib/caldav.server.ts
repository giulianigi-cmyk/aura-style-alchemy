// Apple/iCloud CalDAV client — server-only. Unlike Google, there's no
// OAuth redirect: the person enters their Apple ID email + an
// app-specific password (generated at appleid.apple.com) directly, and
// we authenticate every request with HTTP Basic Auth over those
// credentials. iCloud's CalDAV server is caldav.icloud.com; discovery
// follows RFC 4791 (PROPFIND for current-user-principal, then
// calendar-home-set) — the actual calendar data lands on a per-account
// numbered host iCloud tells us about, never guessed.

import { computeRemovedEventIds } from "./calendar-sync-diff";

const ICLOUD_BASE = "https://caldav.icloud.com";

function basicAuthHeader(email: string, password: string): string {
  return `Basic ${btoa(`${email}:${password}`)}`;
}

async function caldavRequest(
  url: string,
  method: "PROPFIND" | "REPORT",
  email: string,
  password: string,
  body: string,
  depth: "0" | "1",
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuthHeader(email, password),
      "Content-Type": "application/xml; charset=utf-8",
      Depth: depth,
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, text };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function discoverPrincipal(email: string, password: string): Promise<{ principal: string | null; status: number; snippet: string }> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`;
  const { status, text } = await caldavRequest(`${ICLOUD_BASE}/`, "PROPFIND", email, password, body, "0");
    if (status !== 207) return { principal: null, status, snippet: text.slice(0, 900) };
    const m = text.match(/<[a-zA-Z]*:?current-user-principal[^>]*>\s*<[a-zA-Z]*:?href[^>]*>([^<]+)<\/[a-zA-Z]*:?href>/i);
    return { principal: m ? m[1] : null, status, snippet: text.slice(0, 900) };
}


async function discoverCalendarHome(principalPath: string, email: string, password: string): Promise<string | null> {
  const url = new URL(principalPath, ICLOUD_BASE).toString();
  const body = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><C:calendar-home-set/></prop></propfind>`;
  const { status, text } = await caldavRequest(url, "PROPFIND", email, password, body, "0");
  if (status !== 207) return null;
    const m = text.match(/<[a-zA-Z]*:?calendar-home-set[^>]*>\s*<[a-zA-Z]*:?href[^>]*>([^<]+)<\/[a-zA-Z]*:?href>/i);
  return m ? m[1] : null;
}

async function listCalendars(homeUrl: string, email: string, password: string): Promise<string[]> {
  const url = new URL(homeUrl, ICLOUD_BASE).toString();
  const body = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/></prop></propfind>`;
  const { status, text } = await caldavRequest(url, "PROPFIND", email, password, body, "1");
  if (status !== 207) return [];
  const blocks = text.match(/<[a-zA-Z]*:?response>[\s\S]*?<\/[a-zA-Z]*:?response>/gi) ?? [];
  const hrefs: string[] = [];
  for (const block of blocks) {
        const isCalendar = /<[a-zA-Z]*:?calendar[^>]*\/>/i.test(block);
    const isInboxOutbox = /schedule-inbox|schedule-outbox/i.test(block);
    if (isCalendar && !isInboxOutbox) {
            const hrefMatch = block.match(/<[a-zA-Z]*:?href[^>]*>([^<]+)<\/[a-zA-Z]*:?href>/i);
      if (hrefMatch) hrefs.push(hrefMatch[1]);
    }
  }
  return hrefs;
}

async function fetchEventsFromCalendar(calendarHref: string, email: string, password: string, timeMin: Date, timeMax: Date): Promise<string[]> {
  const url = new URL(calendarHref, ICLOUD_BASE).toString();
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const body = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${fmt(timeMin)}" end="${fmt(timeMax)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
  const { status, text } = await caldavRequest(url, "REPORT", email, password, body, "1");
  if (status !== 207) return [];
  const matches = text.match(/<[a-zA-Z]*:?calendar-data[^>]*>([\s\S]*?)<\/[a-zA-Z]*:?calendar-data>/gi) ?? [];
  return matches.map((m) => decodeXmlEntities(m.replace(/^<[^>]+>/, "").replace(/<\/[^>]+>$/, "")));
}

type ParsedEvent = { uid: string; summary: string; location: string; description: string; dtstart: string; dtend: string | null; allDay: boolean };

function unfoldICSLines(ics: string): string[] {
  const raw = ics.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeICSText(s: string): string {
  return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function icsDateToIso(raw: string, allDay: boolean): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return new Date().toISOString();
  const [, y, mo, d, h, mi, s, z] = m;
  if (allDay || !h) return new Date(`${y}-${mo}-${d}T00:00:00Z`).toISOString();
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`).toISOString();
}

function parseVEvents(ics: string): ParsedEvent[] {
  const lines = unfoldICSLines(ics);
  const events: ParsedEvent[] = [];
  let cur: { uid?: string; summary?: string; location?: string; description?: string; dtstartRaw?: string; dtendRaw?: string; allDay?: boolean } | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur?.dtstartRaw) {
        events.push({
          uid: cur.uid ?? `${cur.dtstartRaw}-${cur.summary ?? ""}`,
          summary: cur.summary ?? "",
          location: cur.location ?? "",
          description: cur.description ?? "",
          dtstart: icsDateToIso(cur.dtstartRaw, cur.allDay ?? false),
          dtend: cur.dtendRaw ? icsDateToIso(cur.dtendRaw, cur.allDay ?? false) : null,
          allDay: cur.allDay ?? false,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawKey = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = rawKey.split(";")[0].toUpperCase();
    if (key === "UID") cur.uid = value;
    else if (key === "SUMMARY") cur.summary = unescapeICSText(value);
    else if (key === "LOCATION") cur.location = unescapeICSText(value);
    else if (key === "DESCRIPTION") cur.description = unescapeICSText(value);
    else if (key === "DTSTART") { cur.dtstartRaw = value; cur.allDay = /VALUE=DATE(?!-TIME)/i.test(rawKey); }
    else if (key === "DTEND") { cur.dtendRaw = value; }
  }
  return events;
}

export async function verifyAppleCredentials(email: string, appPassword: string): Promise<{ ok: true; homeUrl: string } | { ok: false; error: string }> {
  const { principal, status, snippet } = await discoverPrincipal(email, appPassword);
  if (!principal) {
    return { ok: false, error: `[DEBUG] principal discovery failed — HTTP ${status} — response: ${snippet}` };
  }
  const homeUrl = await discoverCalendarHome(principal, email, appPassword);
  if (!homeUrl) return { ok: false, error: "Connected, but couldn't find your calendars." };
  return { ok: true, homeUrl };
}


export async function fetchAppleEvents(homeUrl: string, email: string, appPassword: string): Promise<ParsedEvent[]> {
  const timeMin = new Date(Date.now() - 7 * 86400000);
  const timeMax = new Date(Date.now() + 92 * 86400000);
  const calendarHrefs = await listCalendars(homeUrl, email, appPassword);
  const all: ParsedEvent[] = [];
  for (const href of calendarHrefs) {
    const icsBlobs = await fetchEventsFromCalendar(href, email, appPassword, timeMin, timeMax);
    for (const ics of icsBlobs) all.push(...parseVEvents(ics));
  }
  return all;
}

export async function syncAppleCalendar(userId: string): Promise<{ ok: boolean; error?: string; imported?: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conn } = await (supabaseAdmin.from("calendar_connections" as never) as any)
    .select("*").eq("user_id", userId).eq("provider", "apple").maybeSingle();
  if (!conn) return { ok: false, error: "Not connected" };

  try {
    const events = await fetchAppleEvents(conn.calendar_id as string, conn.account_email as string, conn.access_token as string);
    const rows = events.map((e) => ({
      user_id: userId,
      connection_id: conn.id,
      external_event_id: e.uid,
      title: e.summary || null,
      start_time: e.dtstart,
      end_time: e.dtend,
      location: e.location || null,
      description: e.description || null,
      all_day: e.allDay,
      raw: e,
      removed_from_source: false,
    }));

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
