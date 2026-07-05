import { Plus, Filter, Search, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { currentSeason, itemMatchesSeason, resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";

const categories = ["All", "Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories"];

export function Wardrobe({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const { latitude, longitude, city } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [seasonOnly, setSeasonOnly] = useState(true);

  const season = useMemo(() => currentSeason(), []);

  // Sign whenever items change
  useEffect(() => {
    if (!items.length) { setSigned({}); return; }
    let cancelled = false;
    void resolveWardrobeUrls(items).then(map => { if (!cancelled) setSigned(prev => ({ ...prev, ...map })); });
    return () => { cancelled = true; };
  }, [items]);

  useEffect(() => {
    const addCreatedItem = (item: WardrobeItem) => {
      if (!item?.id || (user?.id && item.user_id !== user.id)) return;
      setItems((current) => current.some((existing) => existing.id === item.id) ? current : [item, ...current]);
    };
    const onCreated = (event: Event) => addCreatedItem((event as CustomEvent<WardrobeItem>).detail);
    window.addEventListener("aura:wardrobe-item-created", onCreated);
    return () => window.removeEventListener("aura:wardrobe-item-created", onCreated);
  }, [user?.id]);

  useEffect(() => {
    if (!user) { setItems([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("wardrobe_items")
      .select("*").eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error("[AURA wardrobe] load error", error); setLoading(false); return; }
        setItems((data ?? []) as WardrobeItem[]); setLoading(false);
      });
  }, [user]);

  const seasonMatches = useMemo(
    () => new Set(items.filter((i) => itemMatchesSeason(i, season)).map((i) => i.id)),
    [items, season],
  );

  const filtered = useMemo(() => items.filter(i =>
    (cat === "All" || i.category === cat) &&
    (!seasonOnly || seasonMatches.has(i.id)) &&
    (q === "" || [i.category, i.brand, i.color, i.style, i.occasion, i.season, ...(i.colors ?? [])]
      .some(v => v?.toLowerCase().includes(q.toLowerCase())))
  ), [items, cat, q, seasonOnly, seasonMatches]);

  const w = weather?.current;
  const wLabel = w ? describeWeather(w.weatherCode, w.isDay) : null;

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{items.length} pieces</p>
          <h1 className="font-serif text-4xl mt-1">Your closet</h1>
        </div>
        <button
          onClick={() => go("add")}
          className="h-12 w-12 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90 transition shadow-luxe"
        >
          <Plus size={20} />
        </button>
      </header>

      {/* Weather / season banner */}
      <div className="mx-6 mt-4 rounded-2xl bg-card border border-border/60 p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{season} · {city ?? "your area"}</p>
          {w ? (
            <p className="font-serif text-xl mt-0.5">
              {Math.round(w.temperature)}° · {wLabel?.label}
            </p>
          ) : (
            <p className="font-serif text-lg mt-0.5 italic text-muted-foreground">Weather unavailable</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            {seasonOnly ? `Showing pieces tagged for ${season.toLowerCase()}` : "Showing every piece"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {wLabel && <span className="text-3xl leading-none">{wLabel.icon}</span>}
          <button
            onClick={() => setSeasonOnly((v) => !v)}
            className={`text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full ${
              seasonOnly ? "bg-foreground text-background" : "border border-border"
            }`}
          >
            {seasonOnly ? "This season" : "All seasons"}
          </button>
        </div>
      </div>

      <div className="mx-6 mt-4 flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
        <Search size={15} className="text-muted-foreground" />
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search by color, fabric, brand…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
        />
        <Filter size={15} className="text-muted-foreground" />
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar px-6">
        {categories.map(c => (
          <button
            key={c} onClick={() => setCat(c)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs tracking-wide transition ${
              cat === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
            }`}
          >{c}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center mt-20 text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="px-6 mt-16 text-center animate-fade-up">
          <p className="font-serif text-2xl italic">
            {items.length === 0 ? "Your closet is empty" : `Nothing for ${season.toLowerCase()} yet`}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {items.length === 0 ? "Add your first piece to begin styling." : "Turn off the season filter to see everything."}
          </p>
          {items.length === 0 ? (
            <button
              onClick={() => go("add")}
              className="mt-6 h-12 px-6 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs"
            >Add a piece</button>
          ) : (
            <button
              onClick={() => setSeasonOnly(false)}
              className="mt-6 h-12 px-6 rounded-full border border-border uppercase tracking-[0.3em] text-xs"
            >Show all seasons</button>
          )}
        </div>
      ) : (
        <div className="px-6 mt-6 grid grid-cols-2 gap-3">
          {filtered.map((it, i) => {
            const path = toStoragePath(it.image_url);
            const src = path ? (signed[path] ?? "") : "";
            const label = (it.colors?.[0] ?? it.color ?? it.category ?? "Wardrobe piece");
            return (
            <div key={it.id} className="group animate-fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
              <div className="overflow-hidden rounded-2xl shadow-soft" style={{ background: "#FFFFFF" }}>
                {src ? (
                  <img
                    src={src} alt={`${it.brand ?? label} piece`}
                    className={`w-full object-contain p-2 transition-transform duration-500 group-active:scale-95 ${i % 3 === 0 ? "aspect-[3/4]" : "aspect-square"}`}
                    loading="lazy"
                  />
                ) : (
                  <div className={`w-full ${i % 3 === 0 ? "aspect-[3/4]" : "aspect-square"} animate-pulse`} style={{ background: "#EDEDED" }} />
                )}
              </div>
              <div className="px-1 mt-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{it.brand ?? it.category}</p>
                <p className="font-serif text-base leading-tight">{[label, it.category].filter(Boolean).join(" ")}</p>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
