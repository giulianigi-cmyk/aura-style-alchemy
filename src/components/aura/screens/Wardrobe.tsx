import { ColorWheelPicker } from "@/components/ColorWheelPicker";
import { Plus, Filter, Search, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { currentSeason, itemMatchesSeason, resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";

const categories = ["All", "Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories", "Underwear"];

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
  const [detail, setDetail] = useState<WardrobeItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [colorWheelOpen, setColorWheelOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deleteItem = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      const path = toStoragePath(detail.image_url);
      // Delete DB row first (RLS-scoped); best-effort clean up the file after.
      const { error } = await supabase.from("wardrobe_items").delete().eq("id", detail.id);
      if (error) throw error;
      if (path) {
        await supabase.storage.from("wardrobe").remove([path]).catch(() => { /* ignore */ });
      }
      setItems((prev) => prev.filter((it) => it.id !== detail.id));
      toast.success("Item deleted");
      setConfirmDelete(false);
      setDetail(null);
    } catch (e) {
      console.error("[AURA wardrobe] delete", e);
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

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
            <button
              key={it.id}
              onClick={() => { setDetail(it); setConfirmDelete(false); }}
              className="group animate-fade-up text-left"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
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
            </button>
            );
          })}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 bg-background/85 backdrop-blur flex items-end sm:items-center justify-center" onClick={() => setDetail(null)}>
         <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[85dvh] overflow-y-auto bg-card rounded-t-3xl sm:rounded-3xl border border-border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] relative"
          >
            <button
              onClick={() => setDetail(null)}
              className="absolute top-4 left-4 h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
              aria-label="Close"
            ><X size={16} /></button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="absolute top-4 right-4 h-9 w-9 rounded-full bg-destructive/10 text-destructive flex items-center justify-center active:scale-90"
              aria-label="Delete item"
            ><Trash2 size={16} /></button>

            {(() => {
              const path = toStoragePath(detail.image_url);
              const src = path ? signed[path] : "";
              return (
                <>
                  <div className="mt-6 rounded-2xl overflow-hidden mx-auto aspect-square max-w-[240px]" style={{ background: "#FFFFFF" }}>
                    {src ? (
                      <img src={src} alt="" className="h-full w-full object-contain p-3" />
                    ) : (
                      <div className="h-full w-full animate-pulse" style={{ background: "#EDEDED" }} />
                    )}
                  </div>
                  {src && (
                   <button
                      onClick={() => setColorWheelOpen(true)}
                      className="mx-auto mt-3 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground active:scale-95"
                    >
                      🎨 Color Harmony
                    </button>
                  )}
                  {colorWheelOpen && src && (
                    <ColorWheelPicker imageUrl={src} onClose={() => setColorWheelOpen(false)} />
                  )}
                </>
              );
            })()}

            <div className="mt-4 text-center">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{detail.brand ?? detail.category}</p>
              <p className="font-serif text-2xl mt-1">{[detail.colors?.[0] ?? detail.color, detail.category].filter(Boolean).join(" ")}</p>
              {detail.season && <p className="text-xs text-muted-foreground mt-1">{detail.season}</p>}
              {detail.price != null && (
                <div className="mt-3 inline-flex items-center rounded-full bg-secondary/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                  {detail.worn_count ? (
                    <span>{detail.currency ?? "€"}{(detail.price / detail.worn_count).toFixed(2)} per wear</span>
                  ) : (
                    <span>Not worn yet</span>
                  )}
                </div>
              )}
            </div>

            {confirmDelete ? (
              <div className="mt-5 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
                <p className="font-serif text-lg text-center">Delete this item?</p>
                <p className="text-xs text-muted-foreground text-center mt-1">This cannot be undone.</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                  >Cancel</button>
                  <button
                    onClick={deleteItem}
                    disabled={deleting}
                    className="h-11 rounded-full bg-destructive text-destructive-foreground text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {deleting && <Loader2 size={12} className="animate-spin" />}
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="mt-5 w-full h-12 rounded-full border border-destructive/40 text-destructive text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2"
              >
                <Trash2 size={12} /> Delete item
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
