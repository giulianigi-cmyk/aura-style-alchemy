import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DetectedItemCard, type DetectedItemDraft } from "@/components/aura/DetectedItemCard";
import { ItemCropAdjuster, type FractionalBox } from "@/components/aura/ItemCropAdjuster";
import { confirmDetectedItems, listDetectedItems, rejectDetectedItem } from "@/lib/batch-scan.functions";
import type { BBox } from "@/lib/outfit-detect-types";
import { findBestMatch, type DedupeResult } from "@/lib/outfit-dedupe";
import { clearSegmentationCache, cropItemFromSegmentation } from "@/lib/outfit-segmentation";
import { trimWhiteMargins } from "@/lib/auto-crop";
import type { WardrobeItem } from "@/lib/aura-types";

type Draft = DetectedItemDraft & {
  id: string;
  jobId: string;
  bbox: BBox | null;
  cropUrl: string | null;
  photoUrl: string | null;
  dedupe: DedupeResult;
  included: boolean;
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
        const [res, wardrobeRes] = await Promise.all([
          load({ data: { scanId } }) as unknown as Promise<{
            items: Array<{
              id: string; job_id: string; category: string | null; subcategory: string | null;
              colors: string[] | null; material: string[] | null; season: string | null;
              description: string | null; bbox: BBox | null;
            }>;
            jobs: Array<{ id: string; image_path: string }>;
          }>,
          user
            ? supabase.from("wardrobe_items").select("*").eq("user_id", user.id)
            : Promise.resolve({ data: [] as WardrobeItem[] }),
        ]);
        const wardrobe = (wardrobeRes.data ?? []) as WardrobeItem[];

        const pathById = new Map(res.jobs.map((j) => [j.id, j.image_path]));
        const signed = new Map<string, string>();
        for (const j of res.jobs) {
          const { data } = await supabase.storage.from("wardrobe").createSignedUrl(j.image_path, 3600);
          if (data?.signedUrl) signed.set(j.image_path, data.signedUrl);
        }

        const built: Draft[] = [];
        clearSegmentationCache();
        for (const it of res.items) {
          const path = pathById.get(it.job_id);
          const src = path ? signed.get(path) : undefined;
          let cropUrl: string | null = null;
          if (src && path) {
            cropUrl = await cropItemFromSegmentation(path, src, it.category ?? "", it.bbox);
          }
          if (!cropUrl) {
            cropUrl = src ? (await cropFromUrl(src, it.bbox)) ?? src : null;
          }

          const category = it.category ?? "";
          const colors = it.colors ?? [];
          const dedupe = findBestMatch(
            { category, subcategory: it.subcategory ?? undefined, colors },
            wardrobe,
          );
          built.push({
            id: it.id,
            jobId: it.job_id,
            bbox: it.bbox,
            cropUrl,
            photoUrl: src ?? null,
            category,
            subcategory: it.subcategory ?? "",
            colors,
            materials: it.material ?? [],
            seasons: it.season ? [it.season] : [],
            brand: "",
            description: it.description ?? "",
            price: "",
            currency: "EUR",
            size: "",
            styles: [],
            occasions: [],
            dedupe,
            included: dedupe.verdict !== "certain",
          });
        }
        if (!cancelled) setDrafts(built);
      } catch (e) {
        console.error("[AURA batch-review] load failed", e);
        toast.error("Couldn't load this batch.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const adjustingDraft = drafts.find((d) => d.id === adjustingId) ?? null;

  const applyManualCrop = (id: string, dataUrl: string, box: FractionalBox) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, cropUrl: dataUrl, bbox: box } : d)));

  const discard = async (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    try {
      await reject({ data: { id } });
    } catch (e) {
      console.error("[AURA batch-review] reject failed", e);
    }
  };

  const toSave = drafts.filter((d) => d.included);
  const skippedCount = drafts.length - toSave.length;

  const saveAll = async () => {
    if (!user || toSave.length === 0) return;
    setSaving(true);
    try {
      const payload: Array<{
        id: string; image_path: string; category: string; subcategory: string;
        brand: string; colors: string[]; material: string[]; season: string | null;
        price: number | null; currency: string | null; size: string | null;
        style: string | null; occasion: string | null;
      }> = [];

      for (let i = 0; i < toSave.length; i++) {
        const d = toSave[i];
        if (!d.cropUrl) continue;
        const path = `${user.id}/batch-item-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.png`;
        const trimmed = await trimWhiteMargins(d.cropUrl);
        const file = await dataUrlToFile(trimmed.dataUrl, "item.png");
        const { error } = await supabase.storage.from("wardrobe").upload(path, file, {
          cacheControl: "3600", upsert: false, contentType: "image/png",
        });
        if (error) throw error;
        const priceNum = (() => {
          const n = parseFloat(d.price.replace(",", "."));
          return Number.isFinite(n) && n > 0 ? n : null;
        })();
        payload.push({
          id: d.id,
          image_path: path,
          category: d.category,
          subcategory: d.subcategory,
          brand: d.brand,
          colors: d.colors,
          material: d.materials,
          season: d.seasons.join(", ") || null,
          price: priceNum,
          currency: priceNum != null ? d.currency : null,
          size: d.size.trim() || null,
          style: d.styles.join(", ") || null,
          occasion: d.occasions.join(", ") || null,
        });
      }

      if (!payload.length) {
        toast.error("Nothing to save.");
        return;
      }

      const res = (await confirm({ data: { items: payload } })) as unknown as {
        confirmed: number;
        results: { id: string; ok: boolean; error?: string }[];
      };

      if (res.confirmed > 0) {
        const dupNote = skippedCount ? ` (${skippedCount} skipped as duplicates already in your closet)` : "";
        toast.success(`Added ${res.confirmed} piece${res.confirmed === 1 ? "" : "s"} to your closet${dupNote}`);
      }
      const failedItems = res.results.filter((r) => !r.ok);
      if (failedItems.length) {
        const reasons = Array.from(new Set(failedItems.map((r) => r.error || "unknown error")));
        console.error("[AURA batch-review] items not confirmed:", failedItems);
        toast.error(
          `${failedItems.length} item${failedItems.length === 1 ? "" : "s"} not saved: ${reasons.join("; ")}`,
        );
      }
      if (res.confirmed > 0) go("wardrobe");
    } catch (e) {
      console.error("[AURA batch-review] save failed", e);
      toast.error(e instanceof Error ? e.message : "Some items could not be saved.");
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
          <p className="mt-3 text-sm">Cutting out each piece… this can take a few seconds per photo.</p>
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
            <div key={d.id} className="relative">
              {d.dedupe.verdict === "certain" && (
                <div className="mb-1.5 flex items-center justify-between gap-2 rounded-full bg-secondary/70 px-3 py-1">
                  <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                    <AlertTriangle size={11} />
                    {d.included ? "Looks like a duplicate — will still be added" : "Already in your closet — won't be added"}
                  </span>
                  <button
                    onClick={() => update(d.id, { included: !d.included })}
                    className="shrink-0 text-[10px] uppercase tracking-widest underline"
                  >{d.included ? "Skip it" : "Add anyway"}</button>
                </div>
              )}
              {d.dedupe.verdict === "maybe" && (
                <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] uppercase tracking-widest bg-amber-100 text-amber-800">
                  <AlertTriangle size={11} />
                  Looks similar to something you own
                </div>
              )}
              <DetectedItemCard
                item={d}
                imageUrl={d.cropUrl}
                onChange={(patch) => update(d.id, patch)}
                onRemove={() => discard(d.id)}
                footer={
                  d.photoUrl && (
                    <button
                      onClick={() => setAdjustingId(d.id)}
                      className="mt-3 w-full h-10 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground active:scale-[0.98]"
                    >Adjust crop</button>
                  )
                }
              />
            </div>
          ))}

          {adjustingDraft?.photoUrl && (
            <ItemCropAdjuster
              src={adjustingDraft.photoUrl}
              initialBox={adjustingDraft.bbox}
              onCancel={() => setAdjustingId(null)}
              onSave={({ dataUrl, box }) => {
                applyManualCrop(adjustingDraft.id, dataUrl, box);
                setAdjustingId(null);
              }}
            />
          )}

          <div className="pt-2 pb-4">
            <button
              onClick={saveAll}
              disabled={saving || toSave.length === 0}
              className="w-full h-12 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Add {toSave.length} item{toSave.length === 1 ? "" : "s"}
              {skippedCount ? ` (${skippedCount} duplicate${skippedCount === 1 ? "" : "s"} skipped)` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
