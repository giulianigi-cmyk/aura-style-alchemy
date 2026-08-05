import { Copy, Loader2, Share2, Sparkles, Search, Calendar as CalendarIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { BuilderInit, Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { Outfit, WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { ShareOutfitSheet } from "../ShareOutfitSheet";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { suggestOutfitAI } from "@/lib/ai-suggest-outfit.functions";
import { loadDressRules } from "@/lib/dress-preferences";
import { logWardrobeEvent } from "@/lib/wardrobe-events";

const OCCASIONS = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"];

/**
 * The Stylist tab: everything to do with outfits in one place — create
 * (AI suggest, build manually, ask the chat stylist), search your saved
 * ones, and plan/duplicate/share/delete them. Previously this was split
 * across this screen (a thin "Saved looks" grid) and a separate
 * "saved-outfits" screen with the fuller feature set — Home's "Today's
 * edit" / "Curated for you" already covers daily suggestions, so this
 * screen no longer needs to duplicate that; it's purely the outfit
 * library + creation entry points.
 */
export function AIStylist({ go, openBuilder }: { go: (s: Screen) => void; openBuilder: (init: BuilderInit) => void }) {
  const { user } = useAuth();
  const { latitude, longitude } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [occasion, setOccasion] = useState<string>("Everyday");
  const [aiBusy, setAiBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<Outfit | null>(null);
  const [assignDate, setAssignDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: i }, { data: o }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("outfits").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    setItems((i ?? []) as WardrobeItem[]);
    const olist = (o ?? []) as Outfit[];
    setOutfits(olist);
    const paths = olist.map((x) => x.canvas_image_url).filter(Boolean) as string[];
    if (paths.length) {
      const { data: urls } = await supabase.storage.from("outfits").createSignedUrls(paths, 60 * 60);
      const map: Record<string, string> = {};
      urls?.forEach((r, idx) => { if (r.signedUrl) map[paths[idx]] = r.signedUrl; });
      setSigned(map);
    } else {
      setSigned({});
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const aiPick = async () => {
    if (items.length < 3) {
      toast.error(`You have ${items.length} piece${items.length === 1 ? "" : "s"} in your wardrobe — add at least 3 to generate an AI outfit.`);
      return;
    }
    const categories = Array.from(new Set(items.map((it) => it.category).filter(Boolean)));
    if (categories.length < 2) {
      toast.error(
        categories.length === 0
          ? "None of your pieces have a category set. Edit your items and assign a category (Tops, Bottoms, Shoes…) so AURA can compose an outfit."
          : `All your pieces are tagged "${categories[0]}". Add at least one item from another category (e.g. Bottoms or Shoes) to unlock AI suggestions.`
      );
      return;
    }
    setAiBusy(true);
    try {
      const desc = weather ? describeWeather(weather.current.weatherCode, weather.current.isDay).label : null;
      const dressRules = await loadDressRules(user?.id);
      const res = await suggestOutfitAI({
        data: {
          dressRules,
          temperature: weather?.current.temperature ?? null,
          condition: desc,
          occasion,
          items: items.map((it) => ({
            id: it.id,
            category: it.category,
            subcategory: it.subcategory,
            colors: it.colors ?? (it.color ? [it.color] : []),
            style: it.style ? (Array.isArray(it.style) ? it.style : [it.style]) : [],
            season: it.season,
            brand: it.brand,
          })),
        },
      });
      if (!res.ok) {
        toast.error(res.error || "AI suggestion failed — please try again.");
        return;
      }
      if (!res.item_ids.length) {
        toast.error("Not enough matching pieces in your wardrobe yet for a complete outfit — try adding more items.");
        return;
      }
      openBuilder({
        itemIds: res.item_ids,
        name: "AI styled look",
        occasion,
        notes: res.explanation || undefined,
      });
    } catch (e) {
      console.error(e);
      toast.error("AI suggest failed");
    } finally {
      setAiBusy(false);
    }
  };

  const filteredOutfits = outfits.filter((o) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    const hay = `${o.name} ${(o.occasion ?? []).join(" ")} ${(o.season ?? []).join(" ")} ${o.notes ?? ""}`.toLowerCase();
    return hay.includes(q);
  });

  const openOutfit = (o: Outfit) => openBuilder({
    itemIds: o.item_ids, name: o.name, occasion: o.occasion?.[0],
    notes: o.notes ?? undefined, outfitId: o.id,
  });
  const duplicateOutfit = (o: Outfit) => openBuilder({
    itemIds: o.item_ids, name: `${o.name} Copy`, occasion: o.occasion?.[0],
    notes: o.notes ?? undefined,
  });

  const assignToDay = async () => {
    if (!assignFor || !user) return;
    await supabase.from("outfit_plans").delete().eq("user_id", user.id).eq("date", assignDate);
    const { data, error } = await supabase.from("outfit_plans").insert({
      user_id: user.id,
      date: assignDate,
      item_ids: assignFor.item_ids,
      occasion: assignFor.occasion?.[0] ?? null,
      notes: assignFor.notes ?? assignFor.name ?? null,
      status: "planned",
    } as never).select("id").single();
    if (error) { toast.error(error.message); return; }
    const { error: eventErr } = await logWardrobeEvent({
      userId: user.id,
      eventType: "planned",
      date: assignDate,
      itemIds: assignFor.item_ids,
      outfitPlanId: (data as { id: string }).id,
      outfitId: assignFor.id,
      occasion: assignFor.occasion?.[0] ?? null,
      notes: assignFor.notes ?? assignFor.name ?? null,
    });
    if (eventErr) console.error("[AURA wardrobe-events] log failed", eventErr);
    toast.success("Added to calendar");
    setAssignFor(null);
    go("planner");
  };

  const deleteOutfit = async (id: string) => {
    if (!user) return;
    const outfit = outfits.find((o) => o.id === id);
    setDeleting(true);
    const { error } = await supabase.from("outfits").delete().eq("id", id).eq("user_id", user.id);
    if (error) { setDeleting(false); toast.error(error.message); return; }
    if (outfit?.canvas_image_url) {
      try { await supabase.storage.from("outfits").remove([outfit.canvas_image_url]); } catch { /* best-effort */ }
    }
    setOutfits((prev) => prev.filter((o) => o.id !== id));
    setConfirmDelete(null);
    setDeleting(false);
    toast.success("Outfit deleted");
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Atelier</p>
        <h1 className="font-serif text-4xl mt-1 italic">Stylist</h1>
      </header>

      <div className="mx-6 mt-4">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Occasion</p>
        <div className="flex flex-wrap gap-1.5">
          {OCCASIONS.map((o) => (
            <button
              key={o}
              onClick={() => setOccasion(o)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${occasion === o ? "bg-foreground text-background" : "bg-secondary/60"}`}
            >{o}</button>
          ))}
        </div>
      </div>

      <div className="mx-6 mt-4 flex gap-2">
        <button
          onClick={aiPick}
          disabled={aiBusy}
          className="flex-1 h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] shadow-luxe disabled:opacity-60"
        >
          {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          <span className="text-xs uppercase tracking-[0.3em]">AI suggest</span>
        </button>
        <button
          onClick={() => go("builder")}
          className="flex-1 h-12 rounded-full border border-foreground text-foreground text-xs uppercase tracking-[0.3em] active:scale-[0.98]"
        >Build manually</button>
      </div>
      <button
        onClick={() => go("stylist-chat")}
        className="mx-6 mt-2 w-[calc(100%-3rem)] h-12 rounded-full border border-border text-xs uppercase tracking-[0.3em] active:scale-[0.98] flex items-center justify-center gap-2"
      ><Sparkles size={13} /> Ask your stylist</button>

      <section className="px-6 mt-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-serif text-2xl italic">Outfit library</h2>
          {outfits.length > 0 && <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{outfits.length}</span>}
        </div>

        {outfits.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
            <Search size={15} className="text-muted-foreground" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, occasion, season…"
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
            />
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : outfits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outfits yet. Compose your first with AI suggest or build manually above.</p>
        ) : filteredOutfits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outfits match "{query}".</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredOutfits.map((o) => {
              const url = o.canvas_image_url ? signed[o.canvas_image_url] : null;
              return (
                <div key={o.id} className="animate-fade-up relative rounded-2xl overflow-hidden border border-border/60 bg-card shadow-soft">
                  <button onClick={() => openOutfit(o)} className="block w-full text-left active:scale-[0.98]">
                    <div className="aspect-square" style={{ background: "#FFFFFF" }}>
                      {url ? (
                        <img src={url} alt={o.name} className="w-full h-full object-contain p-2" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">Open canvas</div>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); duplicateOutfit(o); }}
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
                    <button onClick={() => openOutfit(o)} className="block w-full text-left">
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
      </section>

      {shareFor && <ShareOutfitSheet outfitId={shareFor} onClose={() => setShareFor(null)} />}

      {assignFor && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end" onClick={() => setAssignFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full bg-card rounded-t-3xl border-t border-border p-5 space-y-3">
            <p className="font-serif italic text-lg">Assign to a date</p>
            <input
              type="date"
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              className="w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
            />
            <button
              onClick={() => void assignToDay()}
              className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98]"
            >Save to calendar</button>
          </div>
        </div>
      )}
    </div>
  );
}
