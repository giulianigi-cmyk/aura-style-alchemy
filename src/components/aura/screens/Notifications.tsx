import { useEffect, useState } from "react";
import { ArrowLeft, Bell, Loader2 } from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

export function Notifications({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setLoading(false); return; }
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, body, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) console.error("[AURA notifications] load failed", error);
      if (!cancelled) {
        setItems((data ?? []) as Notification[]);
        setLoading(false);
      }
      const unread = (data ?? []).filter((n) => !n.read_at).map((n) => n.id);
      if (unread.length) {
        await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unread);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("home")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">Notifications</p>
        <span className="w-10" />
      </header>

      {loading && (
        <div className="mt-16 text-center text-muted-foreground">
          <Loader2 size={18} className="mx-auto animate-spin" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="mx-6 mt-10 text-sm text-muted-foreground text-center">
          Nothing here yet. Start by adding a few wardrobe pieces.
        </p>
      )}

      {!loading && items.length > 0 && (
        <section className="mx-6 mt-6 divide-y divide-border/60 rounded-2xl bg-card border border-border/60 overflow-hidden animate-fade-up">
          {items.map((n) => (
            <div key={n.id} className="px-5 py-4 flex gap-3">
              <div className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center shrink-0">
                <Bell size={14} />
              </div>
              <div className="flex-1">
                <p className="text-sm">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-2">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}

      {!loading && (
        <p className="text-center mt-8 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">You're all caught up</p>
      )}
    </div>
  );
}
