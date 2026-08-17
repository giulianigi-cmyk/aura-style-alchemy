import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { signPaths } from "@/lib/community";
import { outfitThumbSrc } from "@/lib/outfit-thumb";

export type PickedOutfit = { id: string; name: string; canvas_image_url: string; thumbnail_path?: string | null };

/** One gallery tile image: skeleton while the signed URL resolves and while the
 *  bytes are still downloading, one automatic re-sign retry on error, and an
 *  explicit error state instead of a silent white card. */
function OutfitThumb({ path, url, alt, signing }: { path: string; url?: string; alt: string; signing: boolean }) {
  const [src, setSrc] = useState<string | undefined>(url);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    setSrc(url);
    setLoaded(false);
    setFailed(false);
    setRetried(false);
  }, [url]);

  // signPaths finished but this path got no signed URL → treat as an error.
  const missing = !signing && !url;

  const onError = async () => {
    if (retried) { setFailed(true); return; }
    setRetried(true);
    const { data } = await supabase.storage.from("outfits").createSignedUrl(path, 60 * 60);
    if (data?.signedUrl) setSrc(`${data.signedUrl}${data.signedUrl.includes("?") ? "&" : "?"}r=1`);
    else setFailed(true);
  };

  if (missing || failed) {
    return (
      <div className="aspect-[4/5] bg-secondary/40 flex items-center justify-center px-3 text-center">
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Impossibile caricare</span>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/5] bg-white">
      {!loaded && <div className="absolute inset-0 bg-secondary/40 animate-pulse" />}
      {src && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => void onError()}
          className={`h-full w-full object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

/** Picks one of the user's saved outfits that already has a canvas
 *  snapshot. Outfits without a canvas can't be sent as-is — the snapshot
 *  is produced client-side in the Outfit Builder, so we point there. */
export function ChatOutfitPicker({
  onPick,
  onClose,
}: {
  onPick: (outfit: PickedOutfit) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PickedOutfit[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("outfits")
        .select("id, name, canvas_image_url, thumbnail_path")
        .eq("archived", false)
        .not("canvas_image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      if (!alive) return;
      if (error) { toast.error(error.message); setLoading(false); return; }
      const list = (data ?? []) as PickedOutfit[];
      setRows(list);
      setImages(await signPaths("outfits", list.flatMap((r) => [r.thumbnail_path, r.canvas_image_url])));
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const chosen = rows.find((r) => r.id === selected) ?? null;

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 max-h-[82vh] overflow-y-auto overscroll-contain"
      >
        <p className="font-serif italic text-lg">Allega un outfit</p>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin" size={18} /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Nessun outfit con immagine salvata. Crea un look nell'Outfit Builder e salvalo:
            lo snapshot del canvas viene generato lì.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {rows.map((r) => {
                const on = selected === r.id;
                const url = outfitThumbSrc(r, images);
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    className={`relative rounded-2xl overflow-hidden border text-left transition ${on ? "border-foreground" : "border-border/60"}`}
                  >
                    <OutfitThumb path={r.thumbnail_path || r.canvas_image_url} url={url} alt={r.name} signing={loading} />
                    <p className="px-3 py-2 text-xs truncate">{r.name}</p>
                    {on && (
                      <span className="absolute top-2 right-2 h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center">
                        <Check size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => chosen && onPick(chosen)}
              disabled={!chosen}
              className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-50"
            >Allega</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
