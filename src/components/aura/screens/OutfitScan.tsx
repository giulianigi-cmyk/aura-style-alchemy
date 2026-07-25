import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Camera, Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { TablesInsert } from "@/integrations/supabase/types";
import type { WardrobeItem } from "@/lib/aura-types";
import { ITEM_CATEGORIES, MATERIAL_OPTIONS, SEASON_OPTIONS, subcategoriesFor } from "@/lib/wardrobe-options";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { MaterialCombobox } from "@/components/aura/MaterialCombobox";
import { analyzeWardrobeImage } from "@/lib/ai-analyze.functions";
import { segmentOutfitPhoto } from "@/lib/outfit-segmentation";
import { findBestMatch, type DedupeResult } from "@/lib/outfit-dedupe";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

type ScanItem = {
  key: string;
  category: string;
  subcategory: string;
  colors: string[];
  materials: string[];
  seasons: string[];
  brand: string;
  description: string;
  imageDataUrl: string;
  transparent: boolean;
  dedupe: DedupeResult;
  status: "pending" | "confirmed-new" | "confirmed-duplicate";
};


export function OutfitScan({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const analyze = useServerFn(analyzeWardrobeImage);
  
  const fileRef = useRef<HTMLInputElement>(null);

  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "analyzing" | "review" | "saving">("idle");
  const [progressLabel, setProgressLabel] = useState("");
  const [scanItems, setScanItems] = useState<ScanItem[]>([]);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [matchThumbs, setMatchThumbs] = useState<Record<string, string>>({});

  const reset = () => {
    setPhotoDataUrl(null);
    setScanItems([]);
    setStage("idle");
    setProgressLabel("");
  };

  const onPick = async (file: File | null) => {
    if (!file || !user) return;
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(file);
    });
    setPhotoDataUrl(dataUrl);
    setStage("analyzing");
    setProgressLabel("Looking at your outfit…");

    try {
      const { data: existing } = await supabase
        .from("wardrobe_items").select("*").eq("user_id", user.id);
      const existingList = (existing ?? []) as WardrobeItem[];
      setWardrobe(existingList);

      setProgressLabel("Analyzing your outfit…");
      const segments = await segmentOutfitPhoto(dataUrl);
      if (!segments.length) {
        toast.error("No clothing items recognized in this photo. Try a clearer full-body shot.");
        reset();
        return;
      }

      const built: ScanItem[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        setProgressLabel(`Identifying item ${i + 1} of ${segments.length}…`);

        let meta: {
          category: string; subcategory: string; colors: string[];
          materials: string[]; seasons: string[]; brand: string;
        };
        try {
          const r = await analyze({ data: { imageDataUrl: seg.imageDataUrl } });
          meta = {
            category: r.category, subcategory: r.subcategory, colors: r.colors,
            materials: r.materials, seasons: r.seasons, brand: r.brand,
          };
        } catch (e) {
          console.warn("[AURA outfit-scan] analyze failed for segment", i, e);
          meta = { category: "", subcategory: "", colors: [], materials: [], seasons: [], brand: "" };
        }

        const dedupe = findBestMatch(
          { category: meta.category, subcategory: meta.subcategory, colors: meta.colors, brand: meta.brand || null },
          existingList,
        );
        if (dedupe.match) {
          const path = toStoragePath(dedupe.match.image_url);
          if (path) {
            const map = await resolveWardrobeUrls([dedupe.match]);
            if (map[path]) setMatchThumbs((prev) => ({ ...prev, [dedupe.match!.id]: map[path] }));
          }
        }

        const description = [meta.colors[0], meta.subcategory || meta.category].filter(Boolean).join(" ");

        built.push({
          key: `${Date.now()}-${i}`,
          category: meta.category,
          subcategory: meta.subcategory,
          colors: meta.colors,
          materials: meta.materials,
          seasons: meta.seasons,
          brand: meta.brand || "",
          description,
          imageDataUrl: seg.imageDataUrl,
          transparent: true,
          dedupe,
          status: dedupe.verdict === "certain" ? "confirmed-duplicate" : dedupe.verdict === "maybe" ? "pending" : "confirmed-new",
        });
      }


      setScanItems(built);
      setStage("review");
    } catch (e) {
      console.error("[AURA outfit-scan] failed", e);
      toast.error("Something went wrong analyzing this photo.");
      reset();
    }
  };

  const updateItem = (key: string, patch: Partial<ScanItem>) =>
    setScanItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const removeItem = (key: string) =>
    setScanItems((prev) => prev.filter((it) => it.key !== key));

  const toSave = scanItems.filter((it) => it.status === "confirmed-new");

  const save = async () => {
    if (!user || toSave.length === 0) return;
    setStage("saving");
    let ok = 0, failed = 0;
    for (let i = 0; i < toSave.length; i++) {
      const it = toSave[i];
      setProgressLabel(`Saving item ${i + 1} of ${toSave.length}…`);
      try {
        const ext = it.transparent ? "png" : "jpg";
        const path = `${user.id}/scan-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.${ext}`;
        const file = await dataUrlToFile(it.imageDataUrl, `scan.${ext}`);
        const { error: upErr } = await supabase.storage.from("wardrobe").upload(path, file, {
          cacheControl: "3600", upsert: false, contentType: file.type || (it.transparent ? "image/png" : "image/jpeg"),
        });
        if (upErr) throw upErr;

        const payload = {
          user_id: user.id,
          image_url: path,
          category: it.category,
          subcategory: it.subcategory || null,
          color: it.colors[0] ?? null,
          colors: it.colors,
          material: it.materials,
          season: it.seasons.join(", ") || null,
          brand: it.brand.trim() || null,
          source: "outfit_scan",
        } as unknown as TablesInsert<"wardrobe_items">;

        const { data: inserted, error: insErr } = await supabase
          .from("wardrobe_items").insert(payload).select("*").single();
        if (insErr) throw insErr;

        window.dispatchEvent(new CustomEvent("aura:wardrobe-item-created", { detail: inserted }));
        ok++;
      } catch (e) {
        console.error("[AURA outfit-scan] save item failed", e);
        failed++;
      }
    }
    setStage("idle");
    if (ok) toast.success(`Added ${ok} piece${ok === 1 ? "" : "s"} to your closet`);
    if (failed) toast.error(`${failed} item${failed === 1 ? "" : "s"} could not be saved`);
    reset();
    go("wardrobe");
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center gap-3">
        <button onClick={() => go("wardrobe")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Wardrobe</p>
          <h1 className="font-serif text-2xl italic leading-tight">Scan an outfit</h1>
        </div>
      </header>

      {stage === "idle" && (
        <div className="mx-6 mt-8">
          <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center">
            <Camera size={22} className="mx-auto text-muted-foreground" />
            <p className="mt-4 font-serif text-lg italic">Photograph your outfit</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              A clear, full-body photo works best. AURA will find each piece — top, bottoms,
              shoes, accessories — and turn it into its own wardrobe card.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={() => document.getElementById("outfit-scan-camera")?.click()}
                className="h-12 rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em]"
              >Take a photo</button>
              <button
                onClick={() => fileRef.current?.click()}
                className="h-12 rounded-full border border-foreground text-xs uppercase tracking-[0.3em]"
              >Choose from library</button>
            </div>
          </div>
          <input
            id="outfit-scan-camera" type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      {stage === "analyzing" && (
        <div className="mx-6 mt-16 text-center">
          {photoDataUrl && (
            <img src={photoDataUrl} alt="" className="mx-auto max-h-64 rounded-2xl object-contain" />
          )}
          <div className="mt-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            <p className="text-sm">{progressLabel}</p>
          </div>
        </div>
      )}

      {stage === "review" && (
        <div className="mx-6 mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Found {scanItems.length} piece{scanItems.length === 1 ? "" : "s"}. Review each one before saving.
          </p>

          {scanItems.map((it) => {
            if (it.status === "confirmed-duplicate") {
              const thumb = it.dedupe.match ? matchThumbs[it.dedupe.match.id] : null;
              return (
                <div key={it.key} className="rounded-2xl border border-border bg-secondary/30 p-4 flex items-center gap-3">
                  <div className="h-14 w-14 rounded-xl overflow-hidden shrink-0" style={{ background: "#FFFFFF" }}>
                    {thumb ? <img src={thumb} alt="" className="h-full w-full object-contain p-1" /> : (
                      <img src={it.imageDataUrl} alt="" className="h-full w-full object-contain p-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">Already in your closet</p>
                    <p className="text-[11px] text-muted-foreground truncate">{it.description}</p>
                  </div>
                  <button
                    onClick={() => updateItem(it.key, { status: "confirmed-new" })}
                    className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground underline"
                  >Add anyway</button>
                </div>
              );
            }

            if (it.status === "pending") {
              const thumb = it.dedupe.match ? matchThumbs[it.dedupe.match.id] : null;
              return (
                <div key={it.key} className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center">Is this the same item?</p>
                  <div className="mt-3 flex items-center justify-center gap-4">
                    <div className="text-center">
                      <div className="h-20 w-20 rounded-xl overflow-hidden mx-auto" style={{ background: "#FFFFFF" }}>
                        <img src={it.imageDataUrl} alt="" className="h-full w-full object-contain p-1.5" />
                      </div>
                      <p className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">New scan</p>
                    </div>
                    <div className="text-center">
                      <div className="h-20 w-20 rounded-xl overflow-hidden mx-auto" style={{ background: "#FFFFFF" }}>
                        {thumb && <img src={thumb} alt="" className="h-full w-full object-contain p-1.5" />}
                      </div>
                      <p className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">Already owned</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateItem(it.key, { status: "confirmed-new" })}
                      className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                    >No, different</button>
                    <button
                      onClick={() => updateItem(it.key, { status: "confirmed-duplicate" })}
                      className="h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]"
                    >Yes, same</button>
                  </div>
                </div>
              );
            }

            // confirmed-new: full editable card
            const subs = subcategoriesFor(it.category);
            return (
              <div key={it.key} className="rounded-2xl border border-border bg-card p-4 relative">
                <button
                  onClick={() => removeItem(it.key)}
                  aria-label="Remove item"
                  className="absolute top-3 right-3 h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
                ><Trash2 size={14} /></button>

                <div className="h-24 w-24 rounded-xl overflow-hidden mx-auto" style={{ background: "#FFFFFF" }}>
                  <img src={it.imageDataUrl} alt="" className="h-full w-full object-contain p-1.5" />
                </div>
                <p className="mt-2 text-center text-xs text-muted-foreground italic">{it.description}</p>

                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Category</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ITEM_CATEGORIES.map((c) => (
                      <button
                        key={c}
                        onClick={() => updateItem(it.key, { category: c, subcategory: "" })}
                        className={`rounded-full px-3 py-1.5 text-xs ${it.category === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
                      >{c}</button>
                    ))}
                  </div>
                </div>

                {subs.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Type</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {subs.map((s) => (
                        <button
                          key={s}
                          onClick={() => updateItem(it.key, { subcategory: it.subcategory === s ? "" : s })}
                          className={`rounded-full px-3 py-1.5 text-xs ${it.subcategory === s ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
                        >{s}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3">
                  <ColorPicker value={it.colors} onChange={(next) => updateItem(it.key, { colors: next })} />
                </div>

                <div className="mt-3">
                  <MaterialCombobox
                    label="Material"
                    options={MATERIAL_OPTIONS}
                    values={it.materials}
                    onChange={(v) => updateItem(it.key, { materials: v })}
                  />
                </div>

                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Season</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SEASON_OPTIONS.map((s) => {
                      const on = it.seasons.includes(s);
                      return (
                        <button
                          key={s}
                          onClick={() => updateItem(it.key, { seasons: on ? it.seasons.filter((x) => x !== s) : [...it.seasons, s] })}
                          className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
                        >{s}</button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Brand</p>
                  <input
                    value={it.brand}
                    onChange={(e) => updateItem(it.key, { brand: e.target.value })}
                    placeholder="leave empty if unknown"
                    className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            );
          })}

          <div className="pt-2 pb-4 flex gap-2">
            <button
              onClick={reset}
              className="h-12 px-5 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
            >Start over</button>
            <button
              onClick={save}
              disabled={toSave.length === 0}
              className="flex-1 h-12 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Check size={14} /> Save {toSave.length} item{toSave.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {stage === "saving" && (
        <div className="mx-6 mt-16 text-center">
          <Loader2 size={20} className="mx-auto animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">{progressLabel}</p>
        </div>
      )}
    </div>
  );
}
