import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Heart, Sparkles, Calendar as CalendarIcon, Loader2, Plus, Trash2, Copy } from "lucide-react";
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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const deleteOutfit = async (id: string) => {
    if (!user) return;
    const outfit = outfits.find((o) => o.id === id);
    setDeleting(true);
    const { error } = await supabase.from("outfits").delete().eq("id", id).eq("user_id", user.id);
    if (error) {
      setDeleting(false);
      toast.error(error.message);
      return;
    }
    if (outfit?.canvas_image_url) {
      try { await supabase.storage.from("outfits").remove([outfit.canvas_image_url]); } catch { /* best-effort */ }
    }
    setOutfits((prev) => prev.filter((o) => o.id !== id));
    setConfirmDelete(null);
    setDeleting(false);
    toast.success("Outfit deleted");
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
            const open = () => openBuilder({
              itemIds: o.item_ids,
              name: o.name,
              occasion: o.occasion?.[0],
              notes: o.notes ?? undefined,
              outfitId: o.id,
            });
            const duplicate = () => openBuilder({
              itemIds: o.item_ids,
              name: `${o.name} Copy`,
              occasion: o.occasion?.[0],
              notes: o.notes ?? undefined,
            });
            return (
              <div key={o.id} className="rounded-2xl overflow-hidden border border-border/60 bg-card shadow-soft relative">
                <button onClick={open} className="block w-full text-left active:scale-[0.98]">
                  <div className="aspect-square" style={{ background: "#FFFFFF" }}>
                    {url ? (
                      <img src={url} alt={o.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">Open canvas</div>
                    )}
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); duplicate(); }}
                  aria-label="Duplicate outfit"
                  className="absolute top-2 right-20 h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft"
                ><Copy size={14} /></button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShareFor(o.id); }}
                  aria-label="Share outfit"
                  className="absolute top-2 right-11 h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft"
                ><Share2 size={14} /></button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(o.id); }}
                  aria-label="Delete outfit"
                  className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft"
                ><Trash2 size={14} /></button>
                <div className="p-3">
                  <button onClick={open} className="block w-full text-left">
                    <p className="font-serif text-base truncate">{o.name}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{o.item_ids.length} pieces</p>
                  </button>
                  <button
                    onClick={() => setAssignFor(o)}
                    className="mt-2 h-8 w-full rounded-full border border-border text-[10px] uppercase tracking-[0.25em] active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
                  ><CalendarIcon size={11} /> Plan</button>
                </div>

                {confirmDelete === o.id && (
                  <div className="absolute inset-0 z-10 bg-background/90 backdrop-blur flex flex-col items-center justify-center gap-2 p-3 text-center">
                    <p className="text-xs">Delete this outfit?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="h-8 px-4 rounded-full border border-border text-[10px] uppercase tracking-[0.2em]"
                      >Cancel</button>
                      <button
                        disabled={deleting}
                        onClick={() => void deleteOutfit(o.id)}
                        className="h-8 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] disabled:opacity-60"
                      >{deleting ? "…" : "Delete"}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {shareFor && (
        <ShareOutfitSheet outfitId={shareFor} onClose={() => setShareFor(null)} />
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
