import { Plus, Filter, Search, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";

const categories = ["All", "Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories"];

// The wardrobe storage bucket is private. We store the storage path in `image_url`
// and generate a short-lived signed URL to render each item. Older rows may hold
// a full public URL — extract the path portion from those before signing.
function toStoragePath(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (!imageUrl.startsWith("http")) return imageUrl;
  const marker = "/wardrobe/";
  const idx = imageUrl.indexOf(marker);
  return idx >= 0 ? imageUrl.slice(idx + marker.length) : null;
}

async function resolveImageUrls(items: WardrobeItem[]): Promise<Record<string, string>> {
  const paths = items.map(i => toStoragePath(i.image_url)).filter(Boolean) as string[];
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from("wardrobe").createSignedUrls(paths, 60 * 60);
  if (error || !data) { console.error("[AURA wardrobe] sign urls", error); return {}; }
  const map: Record<string, string> = {};
  data.forEach((row, i) => { if (row.signedUrl) map[paths[i]] = row.signedUrl; });
  return map;
}

export function Wardrobe({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");

  // Sign whenever items change
  useEffect(() => {
    if (!items.length) { setSigned({}); return; }
    let cancelled = false;
    void resolveImageUrls(items).then(map => { if (!cancelled) setSigned(prev => ({ ...prev, ...map })); });
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

  const filtered = useMemo(() => items.filter(i =>
    (cat === "All" || i.category === cat) &&
    (q === "" || [i.category, i.brand, i.color, i.style, i.occasion, i.season, ...(i.colors ?? [])]
      .some(v => v?.toLowerCase().includes(q.toLowerCase())))
  ), [items, cat, q]);

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

      <div className="mx-6 mt-5 flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
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
          <p className="font-serif text-2xl italic">Your closet is empty</p>
          <p className="text-sm text-muted-foreground mt-2">Add your first piece to begin styling.</p>
          <button
            onClick={() => go("add")}
            className="mt-6 h-12 px-6 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs"
          >Add a piece</button>
        </div>
      ) : (
        <div className="px-6 mt-6 grid grid-cols-2 gap-3">
          {filtered.map((it, i) => (
            <div key={it.id} className="group animate-fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
              <div className="overflow-hidden rounded-2xl bg-secondary/40 shadow-soft">
                <img
                  src={it.image_url} alt={`${it.brand ?? it.color ?? it.category ?? "Wardrobe"} piece`}
                  className={`w-full object-cover transition-transform duration-500 group-active:scale-95 ${i % 3 === 0 ? "aspect-[3/4]" : "aspect-square"}`}
                  loading="lazy"
                />
              </div>
              <div className="px-1 mt-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{it.brand ?? it.category}</p>
                <p className="font-serif text-base leading-tight">{[it.color, it.category].filter(Boolean).join(" ") || "Wardrobe piece"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
