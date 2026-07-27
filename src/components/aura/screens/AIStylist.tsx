import { Copy, Loader2, Share2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
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

const OCCASIONS = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"];

export function AIStylist({ go, openBuilder }: { go: (s: Screen) => void; openBuilder: (init: BuilderInit) => void }) {
  const { user } = useAuth();
  const { latitude, longitude } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [outfitCovers, setOutfitCovers] = useState<Record<string, string>>({});
  const [occasion, setOccasion] = useState<string>("Everyday");
  const [aiBusy, setAiBusy] = useState(false);
  const [shareFor, setShareFor] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const [{ data: i }, { data: o }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("outfits").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    const list = (i ?? []) as WardrobeItem[];
    setItems(list);
    const olist = (o ?? []) as Outfit[];
    setOutfits(olist);
    // Sign cover images (stored in the "outfits" bucket as canvas_image_url,
    // the composed export from the builder — not a raw wardrobe photo).
    const covers: Record<string, string> = {};
    for (const outfit of olist) {
      if (!outfit.canvas_image_url) continue;
      if (/^https?:\/\//i.test(outfit.canvas_image_url)) { covers[outfit.id] = outfit.canvas_image_url; continue; }
      const { data: signedData } = await supabase.storage.from("outfits").createSignedUrl(outfit.canvas_image_url, 60 * 60);
      if (signedData?.signedUrl) covers[outfit.id] = signedData.signedUrl;
    }
    setOutfitCovers(covers);
  };
  useEffect(() => { load(); }, [user]);

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
      // Hand off straight to the drag-and-arrange canvas, pre-loaded with
      // the AI's picks — the user can move pieces around and save from there.
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
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Atelier</p>
        <h1 className="font-serif text-4xl mt-1 italic">Style a look</h1>
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
        <h2 className="font-serif text-2xl italic mb-3">Saved looks</h2>
        {outfits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outfits yet. Compose your first.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {outfits.map(o => {
              const cover = outfitCovers[o.id];
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
                <div key={o.id} className="animate-fade-up relative">
                  <button onClick={open} className="block w-full text-left active:scale-[0.98]">
                    <div className="rounded-2xl overflow-hidden aspect-[3/4] shadow-soft" style={{ background: "#FFFFFF" }}>
                      {cover ? (
                        <img src={cover} alt={o.name} className="h-full w-full object-contain p-2" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">Open canvas</div>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); duplicate(); }}
                    aria-label="Duplicate outfit"
                    className="absolute top-2 right-11 h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft"
                  ><Copy size={14} /></button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShareFor(o.id); }}
                    aria-label="Share outfit"
                    className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft"
                  ><Share2 size={14} /></button>
                  <button onClick={open} className="block w-full text-left">
                    <p className="mt-2 font-serif text-base">{o.name}</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{o.item_ids.length} pieces</p>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {shareFor && <ShareOutfitSheet outfitId={shareFor} onClose={() => setShareFor(null)} />}
    </div>
  );
}
