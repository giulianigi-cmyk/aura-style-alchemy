import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Heart, Sparkles, Calendar as CalendarIcon, Loader2, Plus } from "lucide-react";
import type { BuilderInit, Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

type Outfit = Tables<"outfits">;

export function SavedOutfits({ go, openBuilder }: { go: (s: Screen) => void; openBuilder: (init: BuilderInit) => void }) {

  const { user } = useAuth();
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [assignFor, setAssignFor] = useState<Outfit | null>(null);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("outfits")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    const list = (data ?? []) as Outfit[];
    setOutfits(list);
    const paths = list.map((o) => o.canvas_image_url).filter(Boolean) as string[];
    if (paths.length) {
      const { data: urls } = await supabase.storage.from("outfits").createSignedUrls(paths, 60 * 60);
      const map: Record<string, string> = {};
      urls?.forEach((r, i) => { if (r.signedUrl) map[paths[i]] = r.signedUrl; });
      setSigned(map);
    } else {
      setSigned({});
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const assignToDay = async () => {
    if (!assignFor || !user) return;
    await supabase.from("outfit_plans").delete().eq("user_id", user.id).eq("date", date);
    const { error } = await supabase.from("outfit_plans").insert({
      user_id: user.id,
      date,
      item_ids: assignFor.item_ids,
      occasion: assignFor.occasion?.[0] ?? null,
      notes: assignFor.notes ?? assignFor.name ?? null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Added to calendar");
    setAssignFor(null);
    go("planner");
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("profile")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">My outfits</p>
        <button
          onClick={() => go("builder")}
          className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
          aria-label="Create outfit"
        ><Plus size={15} /></button>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div>
      ) : outfits.length === 0 ? (
        <section className="mx-6 mt-6 rounded-3xl bg-card border border-border/60 p-8 text-center shadow-soft animate-fade-up">
          <div className="mx-auto h-14 w-14 rounded-full bg-secondary/60 flex items-center justify-center mb-4">
            <Heart size={20} />
          </div>
          <h2 className="font-serif text-2xl italic">Your edits live here</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Compose outfits from your wardrobe and they&apos;ll appear here as a beautifully curated gallery.
          </p>
          <button
            onClick={() => go("builder")}
            className="mt-6 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center gap-2"
          ><Sparkles size={12} /> Open the builder</button>
        </section>
      ) : (
        <div className="mx-4 mt-4 grid grid-cols-2 gap-3">
          {outfits.map((o) => {
            const url = o.canvas_image_url ? signed[o.canvas_image_url] : null;
            return (
              <div key={o.id} className="rounded-2xl overflow-hidden border border-border/60 bg-card shadow-soft">
                <div className="aspect-square" style={{ background: "#F5F5F5" }}>
                  {url ? (
                    <img src={url} alt={o.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">No preview</div>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <p className="font-serif italic text-sm truncate">{o.name}</p>
                  {o.occasion?.length ? (
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground truncate">{o.occasion.join(" · ")}</p>
                  ) : null}
                  <button
                    onClick={() => setAssignFor(o)}
                    className="w-full h-8 rounded-full bg-foreground text-background text-[9px] uppercase tracking-[0.25em] inline-flex items-center justify-center gap-1 active:scale-95"
                  ><CalendarIcon size={10} /> Add to day</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {assignFor && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end" onClick={() => setAssignFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full bg-card rounded-t-3xl border-t border-border p-5 space-y-3">
            <p className="font-serif italic text-lg">Assign to a date</p>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
            />
            <button
              onClick={assignToDay}
              className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98]"
            >Save to calendar</button>
          </div>
        </div>
      )}
    </div>
  );
}
