import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DetectedItemCard, type DetectedItemDraft } from "@/components/aura/DetectedItemCard";
import { confirmDetectedItems, listDetectedItems, rejectDetectedItem } from "@/lib/batch-scan.functions";
import type { BBox } from "@/lib/outfit-detect-types";

type Draft = DetectedItemDraft & {
  id: string;
  jobId: string;
  bbox: BBox | null;
  cropUrl: string | null;
};

async function cropFromUrl(src: string, bbox: BBox | null): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image load failed"));
      el.src = src;
    });
    const b = bbox ?? { x: 0, y: 0, width: 1, height: 1 };
    const sx = Math.round(b.x * img.naturalWidth);
    const sy = Math.round(b.y * img.naturalHeight);
    const sw = Math.max(8, Math.round(b.width * img.naturalWidth));
    const sh = Math.max(8, Math.round(b.height * img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

export function BatchReview({ go, scanId }: { go: (s: Screen) => void; scanId: string }) {
  const { user } = useAuth();
  const load = useServerFn(listDetectedItems);
  const confirm = useServerFn(confirmDetectedItems);
  const reject = useServerFn(rejectDetectedItem);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = (await load({ data: { scanId } })) as unknown as {
          items: Array<{
            id: string; job_id: string; category: string | null; subcategory: string | null;
            colors: string[] | null; material: string[] | null; season: string | null;
            description: string | null; bbox: BBox | null;
          }>;
          jobs: Array<{ id: string; image_path: string }>;
        };

        const pathById = new Map(res.jobs.map((j) => [j.id, j.image_path]));
        const signed = new Map<string, string>();
        for (const j of res.jobs) {
          const { data } = await supabase.storage.from("wardrobe").createSignedUrl(j.image_path, 3600);
          if (data?.signedUrl) signed.set(j.image_path, data.signedUrl);
        }

                const built: Draft[] = [];
        for (const it of res.items) {
          const path = pathById.get(it.job_id);
          const src = path ? signed.get(path) : undefined;
          // If the crop fails (e.g. a canvas/CORS restriction on the signed
          // URL), fall back to the full photo rather than silently dropping
          // the item — losing a real detection is worse than an uncropped
          // preview.
          const cropUrl = src ? (await cropFromUrl(src, it.bbox)) ?? src : null;
          built.push({
            id: it.id,
            jobId: it.job_id,
            bbox: it.bbox,
            cropUrl,
            category: it.category ?? "",
            subcategory: it.subcategory ?? "",
            colors: it.colors ?? [],
            materials: it.material ?? [],
            seasons: it.season ? [it.season] : [],
            brand: "",
            description: it.description ?? "",
          });
        }
        if (!cancelled) setDrafts(built);
      } catch (e) {
        console.error("[AURA batch-review] load failed", e);
        toast.error("Could not load this batch.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const update = (id: string, patch: Partial<DetectedItemDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const discard = async (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    try {
      await reject({ data: { id } });
    } catch (e) {
      console.error("[AURA batch-review] reject failed", e);
    }
  };

  const saveAll = async () => {
    if (!user || drafts.length === 0) return;
    setSaving(true);
    try {
      const payload: Array<{
        id: string; image_path: string; category: string; subcategory: string;
        brand: string; colors: string[]; material: string[]; season: string | null;
      }> = [];

      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        if (!d.cropUrl) continue;
        const path = `${user.id}/batch-item-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.png`;
        const file = await dataUrlToFile(d.cropUrl, "item.png");
        const { error } = await supabase.storage.from("wardrobe").upload(path, file, {
          cacheControl: "3600", upsert: false, contentType: "image/png",
        });
        if (error) throw error;
        payload.push({
          id: d.id,
          image_path: path,
          category: d.category,
          subcategory: d.subcategory,
          brand: d.brand,
          colors: d.colors,
          material: d.materials,
          season: d.seasons.join(", ") || null,
        });
      }

      if (!payload.length) {
        toast.error("Nothing to save.");
        return;
      }

      const res = (await confirm({ data: { items: payload } })) as unknown as { confirmed: number };
      toast.success(`Added ${res.confirmed} piece${res.confirmed === 1 ? "" : "s"} to your closet`);
      go("wardrobe");
    } catch (e) {
      console.error("[AURA batch-review] save failed", e);
      toast.error("Some items could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center gap-3">
        <button onClick={() => go("batch-scan")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Batch scan</p>
          <h1 className="font-serif text-2xl italic leading-tight">Review pieces</h1>
        </div>
      </header>

      {loading && (
        <div className="mx-6 mt-16 text-center text-muted-foreground">
          <Loader2 size={18} className="mx-auto animate-spin" />
          <p className="mt-3 text-sm">Preparing your detections…</p>
        </div>
      )}

      {!loading && drafts.length === 0 && (
        <p className="mx-6 mt-10 text-sm text-muted-foreground">
          Nothing left to review in this batch.
        </p>
      )}

      {!loading && drafts.length > 0 && (
        <div className="mx-6 mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {drafts.length} suggested piece{drafts.length === 1 ? "" : "s"}. Edit anything, discard what you don't want.
          </p>

          {drafts.map((d) => (
            <DetectedItemCard
              key={d.id}
              item={d}
              imageUrl={d.cropUrl}
              onChange={(patch) => update(d.id, patch)}
              onRemove={() => discard(d.id)}
            />
          ))}

          <div className="pt-2 pb-4">
            <button
              onClick={saveAll}
              disabled={saving}
              className="w-full h-12 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Add {drafts.length} item{drafts.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
