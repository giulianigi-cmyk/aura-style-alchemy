import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, Check, Loader2, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";
import { startCalendarConnect, getCalendarStatus, disconnectCalendar, syncCalendarNow } from "@/lib/calendar-connections.functions";

export function CalendarConnectionSection() {
  const start = useServerFn(startCalendarConnect);
  const status = useServerFn(getCalendarStatus);
  const disconnect = useServerFn(disconnectCalendar);
  const sync = useServerFn(syncCalendarNow);

  const [connected, setConnected] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = async () => {
    try {
      const res = await status();
      setConnected(res.connected);
      if (res.connected) {
        setLastSyncedAt(res.lastSyncedAt ?? null);
        setLastSyncError(res.lastSyncError ?? null);
      }
    } catch (e) {
      console.error("[AURA calendar] status failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    if (result === "connected") { toast.success("Google Calendar connected"); void load(); }
    else if (result === "denied") toast.message("Calendar connection cancelled");
    else if (result === "error") toast.error("Couldn't connect Google Calendar — please try again.");
    params.delete("calendar");
    const clean = params.toString();
    window.history.replaceState({}, "", clean ? `${window.location.pathname}?${clean}` : window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await start();
      window.location.href = res.url;
    } catch (e) {
      console.error("[AURA calendar] connect failed", e);
      toast.error("Couldn't start the connection");
      setConnecting(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await sync();
      if (res.ok) toast.success(`Synced — ${res.imported ?? 0} event${res.imported === 1 ? "" : "s"}`);
      else toast.error(res.error ?? "Sync failed");
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const runDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect();
      setConnected(false);
      toast.success("Disconnected");
    } catch (e) {
      console.error("[AURA calendar] disconnect failed", e);
      toast.error("Couldn't disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="mx-6 mt-4 rounded-3xl gradient-warm border border-border/60 p-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Calendar</p>
          <p className="font-serif text-lg mt-0.5">Google Calendar</p>
        </div>
        <Calendar size={18} className="text-muted-foreground" />
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
        </div>
      ) : connected ? (
        <>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Check size={12} className="text-foreground" />
            Connected
            {lastSyncedAt ? ` · synced ${new Date(lastSyncedAt).toLocaleString("en-US")}` : ""}
          </div>
          {lastSyncError && (
            <p className="mt-1 text-[11px] text-red-700">{lastSyncError}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void runSync()}
              disabled={syncing}
              className="flex-1 h-10 rounded-full border border-border text-[10px] uppercase tracking-[0.25em] flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />} Sync now
            </button>
            <button
              onClick={() => void runDisconnect()}
              disabled={disconnecting}
              className="h-10 w-10 rounded-full border border-border flex items-center justify-center disabled:opacity-50"
              aria-label="Disconnect Google Calendar"
            ><X size={14} /></button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            Connect your Google Calendar so AURA can understand your day — work, dinners, travel — and suggest outfits accordingly.
          </p>
          <button
            onClick={() => void connect()}
            disabled={connecting}
            className="mt-3 w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {connecting ? <Loader2 size={12} className="animate-spin" /> : null}
            Connect Google Calendar
          </button>
        </>
      )}
    </section>
  );
}
