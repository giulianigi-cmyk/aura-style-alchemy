import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { Outfit, WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { suggestOutfitAI } from "@/lib/ai-suggest-outfit.functions";

const OCCASIONS = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"];

export function AIStylist({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const { latitude, longitude } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [outfitCovers, setOutfitCovers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [occasion, setOccasion] = useState<string>("Everyday");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string>("");

  const load = async () => {
    if (!user) return;
    const [{ data: i }, { data: o }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("outfits").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    const list = (i ?? []) as WardrobeItem[];
    setItems(list);
    setSigned(await resolveWardrobeUrls(list));
    const olist = (o ?? []) as Outfit[];
    setOutfits(olist);
    // Sign cover images (may be storage paths on the outfits or wardrobe buckets)
    const covers: Record<string, string> = {};
    for (const outfit of olist) {
      if (!outfit.cover_url) continue;
      if (/^https?:\/\//i.test(outfit.cover_url)) { covers[outfit.id] = outfit.cover_url; continue; }
      const { data: signedData } = await supabase.storage.from("wardrobe").createSignedUrl(outfit.cover_url, 60 * 60);
      if (signedData?.signedUrl) covers[outfit.id] = signedData.signedUrl;
    }
    setOutfitCovers(covers);
  };
  useEffect(() => { load(); }, [user]);

  const toggle = (id: string) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const aiPick = async () => {
    if (items.length < 2) { toast.error("Add more items to your closet first"); return; }
    setAiBusy(true);
    setAiExplanation("");
    try {
      const desc = weather ? describeWeather(weather.current.weatherCode, weather.current.isDay).label : null;
      const res = await suggestOutfitAI({
        data: {
          temperature: weather?.current.temperature ?? null,
          condition: desc,
          occasion,
          items: items.map((it) => ({
            id: it.id,
            category: it.category,
            colors: it.colors ?? (it.color ? [it.color] : []),
            style: it.style ? (Array.isArray(it.style) ? it.style : [it.style]) : [],
            season: it.season,
            brand: it.brand,
          })),
        },
      });
      if (!res.ok || !res.item_ids.length) {
        toast.error("AI couldn't compose a look — try again");
        return;
      }
      setSelected(res.item_ids);
      setName("AI styled look");
      setAiExplanation(res.explanation);
      setCreating(true);
    } catch (e) {
      console.error(e);
      toast.error("AI suggest failed");
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!user || selected.length === 0) return;
    setSaving(true);
    const first = items.find(i => i.id === selected[0]);
    const cover = first ? toStoragePath(first.image_url) ?? first.image_url : null;
    await supabase.from("outfits").insert({
      user_id: user.id,
      name: name || "Untitled look",
      item_ids: selected,
      cover_url: cover,
      occasion: occasion ? [occasion] : [],
      notes: aiExplanation || null,
    });
    setSelected([]); setName(""); setCreating(false); setSaving(false); setAiExplanation("");
    load();
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
          onClick={() => { setSelected([]); setAiExplanation(""); setCreating(true); }}
          className="flex-1 h-12 rounded-full border border-foreground text-foreground text-xs uppercase tracking-[0.3em] active:scale-[0.98]"
        >Build manually</button>
      </div>
      {aiExplanation && (
        <p className="mx-6 mt-2 text-xs text-muted-foreground italic leading-relaxed">
          {aiExplanation}
        </p>
      )}

      {creating && (
        <div className="mx-6 mt-6 rounded-2xl border border-border bg-card p-4 animate-fade-up">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Composing</p>
            <button onClick={() => { setCreating(false); setSelected([]); setAiExplanation(""); }}><X size={16} /></button>
          </div>
          <input
            value={name} onChange={e => setName(e.target.value)} placeholder="Name this look"
            className="mt-2 w-full bg-transparent font-serif text-xl outline-none placeholder:text-muted-foreground/50"
          />
          <p className="text-xs text-muted-foreground mt-1">{selected.length} pieces selected</p>

          <div className="mt-4 grid grid-cols-3 gap-2 max-h-72 overflow-y-auto">
            {items.map(it => {
              const on = selected.includes(it.id);
              const path = toStoragePath(it.image_url);
              const src = path ? signed[path] : null;
              const label = it.brand ?? it.color ?? it.category ?? "piece";
              return (
                <button
                  key={it.id}
                  onClick={() => toggle(it.id)}
                  className={`relative rounded-xl overflow-hidden aspect-square transition ${on ? "ring-2 ring-foreground" : ""}`}
                  style={{ background: "#FFFFFF" }}
                >
                  {src ? (
                    <img src={src} alt={label} className="h-full w-full object-contain p-1.5" loading="lazy" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">No image</div>
                  )}
                  {on && (
                    <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center">
                      <Check size={11} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={save} disabled={saving || selected.length === 0}
            className="mt-5 w-full h-12 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save outfit
          </button>
        </div>
      )}

      <section className="px-6 mt-10">
        <h2 className="font-serif text-2xl italic mb-3">Saved looks</h2>
        {outfits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outfits yet. Compose your first.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {outfits.map(o => {
              const cover = outfitCovers[o.id];
              return (
                <div key={o.id} className="animate-fade-up">
                  <div className="rounded-2xl overflow-hidden aspect-[3/4] shadow-soft" style={{ background: "#FFFFFF" }}>
                    {cover && <img src={cover} alt={o.name} className="h-full w-full object-contain p-2" />}
                  </div>
                  <p className="mt-2 font-serif text-base">{o.name}</p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{o.item_ids.length} pieces</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
