import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bell, CloudRain, Loader2, MessageCircle, X } from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { markNotificationsRead } from "@/lib/notifications.functions";
import i18n from "@/i18n/config";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  data: {
    conversation_id?: string;
    plan_id?: string;
    date?: string;
    trip_id?: string | null;
    trip_activity_id?: string | null;
  } | null;
};

export function Notifications({ go, openThread, openPlanner, openTripActivity }: {
  go: (s: Screen) => void;
  openThread?: (id: string) => void;
  /** weather_change on a general/event plan → Planner day sheet. */
  openPlanner?: (date: string, planId?: string | null) => void;
  /** weather_change on a trip plan → TripDetail, focused on the activity. */
  openTripActivity?: (tripId: string, activityId: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const markRead = useServerFn(markNotificationsRead);

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setLoading(false); return; }
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, body, read_at, created_at, data")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) console.error("[AURA notifications] load failed", error);
      if (!cancelled) {
        setItems((data ?? []) as Notification[]);
        setLoading(false);
      }
            const unread = (data ?? []).filter((n) => !n.read_at).map((n) => n.id);
      if (unread.length) {
        try {
          await markRead({ data: { ids: unread } });
          window.dispatchEvent(new Event("aura:notifications-read"));
        } catch (e) { console.error("[AURA notifications] mark read failed", e); }
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const deleteNotification = async (id: string) => {
    // Optimistic: remove immediately, put it back if the delete fails.
    const prev = items;
    setItems((cur) => cur.filter((n) => n.id !== id));
    const { error } = await supabase.from("notifications").delete().eq("id", id);
    window.dispatchEvent(new Event("aura:notifications-read"));
    if (error) {
      console.error("[AURA notifications] delete failed", error);
      setItems(prev);
    }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("home")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("notifications.title")}</p>
        <span className="w-10" />
      </header>

      {loading && (
        <div className="mt-16 text-center text-muted-foreground">
          <Loader2 size={18} className="mx-auto animate-spin" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="mx-6 mt-10 text-sm text-muted-foreground text-center">
          {t("notifications.empty")}
        </p>
      )}

      {!loading && items.length > 0 && (
        <section className="mx-6 mt-6 divide-y divide-border/60 rounded-2xl bg-card border border-border/60 overflow-hidden animate-fade-up">
          {items.map((n) => {
            const conversationId = n.data?.conversation_id;
            // A weather proposal points at either the Planner day sheet or,
            // for a trip plan, the activity it dresses inside TripDetail.
            const isWeather = n.type === "weather_change";
            const tripId = n.data?.trip_id ?? null;
            const activityId = n.data?.trip_activity_id ?? null;
            const weatherTarget = isWeather
              ? (tripId && activityId && openTripActivity)
                ? () => openTripActivity(tripId, activityId)
                : (n.data?.date && openPlanner)
                  ? () => openPlanner(n.data!.date!, n.data?.plan_id ?? null)
                  : null
              : null;
            const open = conversationId && openThread
              ? () => openThread(conversationId)
              : weatherTarget;
            const clickable = Boolean(open);
            return (
            <div key={n.id} className="px-5 py-4 flex gap-3">
              <div className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center shrink-0">
                {isWeather ? <CloudRain size={14} /> : clickable ? <MessageCircle size={14} /> : <Bell size={14} />}
              </div>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => open?.()}
                className={`flex-1 min-w-0 text-left ${clickable ? "active:opacity-70" : "cursor-default"}`}
              >
                <p className="text-sm">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{n.body}</p>}

                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-2">
                  {new Date(n.created_at).toLocaleString(i18n.language)}
                </p>
              </button>
              <button
                onClick={() => void deleteNotification(n.id)}
                aria-label={t("notifications.deleteAria")}
                className="h-7 w-7 rounded-full bg-secondary/60 flex items-center justify-center shrink-0 active:scale-90 self-start"
              ><X size={12} /></button>
            </div>
            );
          })}
        </section>
      )}

      {!loading && (
        <p className="text-center mt-8 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("notifications.allCaughtUp")}</p>
      )}
    </div>
  );
}
