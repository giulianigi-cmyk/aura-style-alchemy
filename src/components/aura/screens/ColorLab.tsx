import { useEffect, useState } from "react";
import { ArrowLeft, Palette } from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { ColorWheelPicker } from "@/components/aura/ColorWheelPicker";

/**
 * Dedicated, discoverable entry point for color analysis — separate from
 * the per-item shortcut in Wardrobe.tsx. Lets the user pick any garment
 * from their closet and opens the same ColorWheelPicker used there.
 */
export function ColorLab({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<WardrobeItem | null>(null);

  useEffect(() => {
    if (!user) { setItems([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("wardrobe_items")
      .select("*").eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error("[AURA color-lab] load error", error); setLoading(false); return; }
        setItems((data ?? []) as WardrobeItem[]);
        setLoading(false);
      });
  }, [user]);

  useEffect(() => {
    if (!items.length) { setSigned({}); return; }
    let cancelled = false;
    void resolveWardrobeUrls(items).then((map) => { if (!cancelled) setSigned((prev) => ({ ...prev, ...map })); });
    return () => { cancelled = true; };
  }, [items]);

  const activeSrc = active ? (() => {
    const path = toStoragePath(active.image_url);
    return path ? signed[path] : "";
  })() : "";

  return (
    <div className="h-full overflow-y-auto pb-28">
      <header className="px-6 pt-6 flex items-center gap-3">
        <button
          onClick={() => go("home")}
          aria-label="Back"
          className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Color Lab</p>
          <p className="font-serif text-2xl">Analizza un colore</p>
        </div>
      </header>

      <p className="px-6 mt-3 text-sm text-muted-foreground">
        Scegli un capo dal tuo guardaroba per campionarne il colore e vedere
        gli abbinamenti sulla ruota di Itten.
      </p>

      {loading ? (
        <div className="px-6 mt-6 grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl animate-pulse" style={{ background: "#EDEDED" }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-6 mt-10 text-center">
          <Palette size={28} className="mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Aggiungi qualche capo al guardaroba per iniziare.
          </p>
        </div>
      ) : (
        <div className="px-6 mt-6 grid grid-cols-3 gap-3">
          {items.map((it) => {
            const path = toStoragePath(it.image_url);
            const src = path ? signed[path] : "";
            return (
              <button
                key={it.id}
                onClick={() => src && setActive(it)}
                disabled={!src}
                className="aspect-square rounded-2xl overflow-hidden border border-border active:scale-95 transition disabled:opacity-50"
                style={{ background: "#FFFFFF" }}
              >
                {src ? (
                  <img src={src} alt="" className="h-full w-full object-contain p-2" />
                ) : (
                  <div className="h-full w-full animate-pulse" style={{ background: "#EDEDED" }} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {active && activeSrc && (
        <ColorWheelPicker imageUrl={activeSrc} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
