import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2, Plus } from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { WardrobeItem } from "@/lib/aura-types";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { analyzeWardrobeGap, type GapSuggestion } from "@/lib/wardrobe-gap.functions";

const COLOR_HEX: Record<string, string> = {
  Black: "#1a1a1a", White: "#FFFFFF", Ivory: "#F5EFE0", Beige: "#E8C9A0",
  Camel: "#C19A6B", Brown: "#6E4B3A", Navy: "#1F2A44", Blue: "#4169E1",
  Grey: "#8E8E93", Red: "#C0392B", Green: "#6B8E23", Olive: "#708238",
  Pink: "#F4C2C2", Purple: "#8E5A9E", Yellow: "#E9C46A", Orange: "#E76F51",
};

export function Shop({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const analyzeGap = useServerFn(analyzeWardrobeGap);
  const [loading, setLoading] = useState(true);
  const [itemCount, setItemCount] = useState(0);
  const [suggestion, setSuggestion] = useState<GapSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [itemsById, setItemsById] = useState<Record<string, WardrobeItem>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoading(true);
      const { data } = await supabase.from("wardrobe_items").select("*").eq("user_id", user.id);
      const items = (data ?? []) as WardrobeItem[];
      setItemCount(items.length);
      const map: Record<string, WardrobeItem> = {};
      items.forEach((it) => { map[it.id] = it; });
      setItemsById(map);

      if (items.length < 5) {
        setLoading(false);
        return;
      }
      const res = await analyzeGap({
        data: {
          items: items.map((it) => ({
            id: it.id, category: it.category, subcategory: it.subcategory,
            colors: it.colors ?? (it.color ? [it.color] : []),
            style: it.style ? (Array.isArray(it.style) ? it.style : [it.style]) : [],
          })),
        },
      });
      if (res.ok) {
        setSuggestion(res.suggestion);
        const matching = items.filter((it) => res.suggestion.pairsWithIds.includes(it.id));
        setSigned(await resolveWardrobeUrls(matching));
      } else {
        setError(res.error ?? "Couldn't analyze your wardrobe.");
      }
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">The edit</p>
        <h1 className="font-serif text-4xl mt-1">Pieces to complete <span className="italic">your story</span></h1>
      </header>

      <section className="px-6 mt-6">
        {loading ? (
          <div className="rounded-[2rem] bg-secondary/40 aspect-[4/3] flex items-center justify-center">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : itemCount < 5 ? (
          <div className="rounded-[2rem] bg-secondary/40 p-6 text-center">
            <p className="font-serif text-lg italic">Not enough pieces yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add at least 5 pieces to your wardrobe and AURA will spot what's genuinely missing.
            </p>
            <button
              onClick={() => go("add")}
              className="mt-4 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] inline-flex items-center gap-2"
            ><Plus size={12} /> Add a piece</button>
          </div>
        ) : error || !suggestion ? (
          <div className="rounded-[2rem] bg-secondary/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">{error ?? "Couldn't analyze your wardrobe right now."}</p>
          </div>
        ) : (
          <>
            <div className="relative rounded-[2rem] overflow-hidden shadow-luxe gradient-warm p-6">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-background/60 px-3 py-1.5">
                <Sparkles size={11} />
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Your wardrobe is missing</span>
              </div>
              <p className="font-serif text-2xl italic mt-4">
                {suggestion.colors[0] ? `A ${suggestion.colors[0].toLowerCase()} ` : "A "}
                {(suggestion.subcategory || suggestion.category).toLowerCase()}
              </p>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{suggestion.reason}</p>
              <div className="mt-4 flex gap-2">
                {suggestion.colors.map((c) => (
                  <span
                    key={c}
                    className="h-7 w-7 rounded-full border border-border/60"
                    style={{ background: COLOR_HEX[c] ?? "#CCCCCC" }}
                    title={c}
                  />
                ))}
              </div>
              <button
                onClick={() => go("add")}
                className="mt-5 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] inline-flex items-center gap-2"
              ><Plus size={12} /> Add this piece</button>
            </div>

            {suggestion.pairsWithIds.length > 0 && (
              <div className="mt-6">
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
                  Would pair with {suggestion.pairsWithIds.length} piece{suggestion.pairsWithIds.length === 1 ? "" : "s"} you already own
                </p>
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {suggestion.pairsWithIds.map((id) => {
                    const it = itemsById[id];
                    if (!it) return null;
                    const path = toStoragePath(it.image_url);
                    const src = path ? signed[path] : null;
                    return (
                      <div key={id} className="shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-white border border-border/60">
                        {src && <img src={src} alt="" className="h-full w-full object-contain p-1" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <p className="px-6 mt-6 text-[11px] text-muted-foreground leading-relaxed">
        This is a wardrobe gap estimate based on what you already own — not a live product catalog.
        Real shopping recommendations with actual products and links are coming soon.
      </p>
    </div>
  );
}
