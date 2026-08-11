import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, Check, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import type { WardrobeItem } from "@/lib/aura-types";
import { ITEM_CATEGORIES } from "@/lib/wardrobe-options";
import { thumbSrc, toStoragePath } from "@/lib/wardrobe-image";
import { listLocations } from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";

/**
 * Shared piece picker — the single Closet-style grid used everywhere the
 * user selects wardrobe items (calendar planning, marking a day as worn,
 * editing a saved outfit in the builder). Search + category chips +
 * location chips only help *find* a piece; they never restrict which
 * pieces can be selected — the full wardrobe is always reachable by
 * clearing the filters.
 */
export function PiecePicker({
  items,
  signed,
  selectedIds,
  onToggle,
  loading = false,
  emptyHint,
  extraChips,
  className = "",
}: {
  items: WardrobeItem[];
  signed: Record<string, string>;
  selectedIds: string[];
  onToggle: (id: string) => void;
  loading?: boolean;
  emptyHint?: string;
  /** Optional context-specific chips (e.g. "Suggested" in the planner). */
  extraChips?: ReactNode;
  className?: string;
}) {
  const fetchLocations = useServerFn(listLocations);
  const [locations, setLocations] = useState<WardrobeLocation[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [locId, setLocId] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    fetchLocations()
      .then((res) => { if (alive) setLocations(res.locations); })
      .catch((e) => console.error("[AURA picker] locations load failed", e));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((i) => {
      const itemLoc = (i as unknown as { location_id?: string | null }).location_id ?? null;
      return (locId === "all" || itemLoc === locId) &&
        (cat === "All" || i.category === cat) &&
        (query === "" || [i.category, i.brand, i.color, i.style, i.occasion, i.season, ...(i.colors ?? [])]
          .some((v) => v?.toLowerCase().includes(query)));
    });
  }, [items, cat, q, locId]);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
        <Search size={15} className="text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by color, fabric, brand…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
        />
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
        {extraChips}
        {["All", ...ITEM_CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs tracking-wide transition ${
              cat === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
            }`}
          >{c}</button>
        ))}
      </div>

      {locations.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setLocId("all")}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-widest ${locId === "all" ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
          >All</button>
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => setLocId(loc.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-widest ${locId === loc.id ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
            >{loc.name}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin" /></div>
      ) : visible.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {items.length === 0 ? (emptyHint ?? "Add pieces to your closet first.") : "No matches — clear the search or filters to see all."}
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5">
          {visible.map((it) => {
            const src = thumbSrc(it, signed) || (toStoragePath(it.image_url) ? signed[toStoragePath(it.image_url)!] ?? "" : "");
            const on = selectedIds.includes(it.id);
            const label = it.colors?.[0] ?? it.color ?? it.category ?? "Wardrobe piece";
            return (
              <button key={it.id} onClick={() => onToggle(it.id)} className="group text-left">
                <div
                  className={`relative overflow-hidden rounded-[1.25rem] border aspect-[4/5] ${on ? "border-foreground border-2" : "border-border/50"}`}
                  style={{ background: "#FFFFFF" }}
                >
                  {src ? (
                    <img src={src} alt={`${it.brand ?? label} piece`} className="h-full w-full object-contain p-1 transition-transform duration-500 group-active:scale-95" loading="lazy" />
                  ) : (
                    <div className="h-full w-full animate-pulse" style={{ background: "#EDEDED" }} />
                  )}
                  {on && (
                    <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-foreground border border-foreground flex items-center justify-center">
                      <Check size={13} className="text-background" />
                    </span>
                  )}
                </div>
                <div className="px-0.5 mt-1.5">
                  <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground truncate">{it.brand ?? it.category}</p>
                  <p className="font-serif text-[15px] leading-tight truncate">{[label, it.category].filter(Boolean).join(" ")}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
