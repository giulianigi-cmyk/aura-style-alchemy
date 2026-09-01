import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Camera, Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { TablesInsert } from "@/integrations/supabase/types";
import type { WardrobeItem } from "@/lib/aura-types";
import { DetectedItemCard } from "@/components/aura/DetectedItemCard";
import { analyzeWardrobeImage } from "@/lib/ai-analyze.functions";
import { segmentOutfitPhoto } from "@/lib/outfit-segmentation";
import { findBestMatch, type DedupeResult } from "@/lib/outfit-dedupe";
import { trimFileMargins } from "@/lib/auto-crop";
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
  price: string;
  currency: string;
  size: string;
  styles: string[];
  occasions: string[];
  purchaseDate: string;
  sleeveLength: string;
  formality: number | null;
  dayEvening: string;
  length: string;
  fit: string;
  heelHeight: string;
  toeShape: string;
  closure: string;
  gender: string;
  styleTags: string[];
};


export function OutfitScan({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
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
    setProgressLabel(t("outfitScan.lookingAtOutfit"));

    try {
      const { data: existing } = await supabase
        .from("wardrobe_items").select("*").eq("user_id", user.id);
      const existingList = (existing ?? []) as WardrobeItem[];
      setWardrobe(existingList);

      setProgressLabel(t("outfitScan.analyzingOutfit"));
      const segments = await segmentOutfitPhoto(dataUrl);
      if (!segments.length) {
        toast.error(t("outfitScan.noClothingRecognized"));
        reset();
        return;
      }

      const built: ScanItem[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        setProgressLabel(t("outfitScan.identifyingItem", { current: i + 1, total: segments.length }));

        let meta: {
          category: string; subcategory: string; colors: string[];
          materials: string[]; seasons: string[]; brand: string;
          formality: number | null; dayEvening: string; sleeveLength: string;
          length: string; fit: string; heelHeight: string; toeShape: string;
          closure: string; gender: string; styleTags: string[];
        };
        try {
          const r = await analyze({ data: { imageDataUrl: seg.imageDataUrl } });
          // Every one of these fields was already coming back from this
          // same analyze() call — the code just wasn't reading most of
          // them, so a piece added via outfit scan came out with far
          // fewer details than the same piece added one at a time.
          meta = {
            category: r.category, subcategory: r.subcategory, colors: r.colors,
            materials: r.materials, seasons: r.seasons, brand: r.brand,
            formality: r.formality ?? null, dayEvening: r.dayEvening || "", sleeveLength: r.sleeveLength || "",
            length: r.length || "", fit: r.fit || "", heelHeight: r.heelHeight || "", toeShape: r.toeShape || "",
            closure: r.closure || "", gender: r.gender || "", styleTags: r.styleTags ?? [],
          };
        } catch (e) {
          console.warn("[AURA outfit-scan] analyze failed for segment", i, e);
          meta = {
            category: "", subcategory: "", colors: [], materials: [], seasons: [], brand: "",
            formality: null, dayEvening: "", sleeveLength: "",
            length: "", fit: "", heelHeight: "", toeShape: "", closure: "", gender: "", styleTags: [],
          };
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
          price: "",
          currency: "EUR",
          size: "",
          styles: [],
          occasions: [],
          purchaseDate: new Date().toISOString().slice(0, 10),
          sleeveLength: meta.sleeveLength,
          formality: meta.formality,
          dayEvening: meta.dayEvening,
          length: meta.length,
          fit: meta.fit,
          heelHeight: meta.heelHeight,
          toeShape: meta.toeShape,
          closure: meta.closure,
          gender: meta.gender,
          styleTags: meta.styleTags,
        });
      }


      setScanItems(built);
      setStage("review");
    } catch (e) {
      console.error("[AURA outfit-scan] failed", e);
      toast.error(t("outfitScan.somethingWentWrong"));
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
      setProgressLabel(t("outfitScan.savingItem", { current: i + 1, total: toSave.length }));
      try {
        const ext = it.transparent ? "png" : "jpg";
        const path = `${user.id}/scan-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.${ext}`;
        const rawFile = await dataUrlToFile(it.imageDataUrl, `scan.${ext}`);
        const file = await trimFileMargins(rawFile);
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
          style: it.styles.join(", ") || null,
          occasion: it.occasions.join(", ") || null,
          size: it.size.trim() || null,
          price: (() => {
            const n = parseFloat(it.price.replace(",", "."));
            return Number.isFinite(n) && n > 0 ? n : null;
          })(),
          currency: it.price.trim() ? it.currency : null,
          purchase_date: it.purchaseDate || null,
          sleeve_length: it.sleeveLength || null,
          formality: it.formality,
          day_evening: it.dayEvening || null,
          length: it.length || null,
          fit: it.fit || null,
          heel_height: it.heelHeight || null,
          toe_shape: it.toeShape || null,
          closure: it.closure || null,
          gender: it.gender || null,
          style_tags: it.styleTags,
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
    if (ok) toast.success(t("outfitScan.addedPiecesToCloset", { count: ok }));
    if (failed) toast.error(t("outfitScan.itemsCouldNotBeSaved", { count: failed }));
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
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("outfitScan.wardrobe")}</p>
          <h1 className="font-serif text-2xl italic leading-tight">{t("outfitScan.scanAnOutfit")}</h1>
        </div>
      </header>

      {stage === "idle" && (
        <div className="mx-6 mt-8">
          <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center">
            <Camera size={22} className="mx-auto text-muted-foreground" />
            <p className="mt-4 font-serif text-lg italic">{t("outfitScan.photographYourOutfit")}</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {t("outfitScan.photoHint")}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={() => document.getElementById("outfit-scan-camera")?.click()}
                className="h-12 rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em]"
              >{t("outfitScan.takeAPhoto")}</button>
              <button
                onClick={() => fileRef.current?.click()}
                className="h-12 rounded-full border border-foreground text-xs uppercase tracking-[0.3em]"
              >{t("outfitScan.chooseFromLibrary")}</button>
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
            {t("outfitScan.foundPiecesReview", { count: scanItems.length })}
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
                    <p className="text-sm">{t("outfitScan.alreadyInCloset")}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{it.description}</p>
                  </div>
                  <button
                    onClick={() => updateItem(it.key, { status: "confirmed-new" })}
                    className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground underline"
                  >{t("outfitScan.addAnyway")}</button>
                </div>
              );
            }

            if (it.status === "pending") {
              const thumb = it.dedupe.match ? matchThumbs[it.dedupe.match.id] : null;
              return (
                <div key={it.key} className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center">{t("outfitScan.isThisSameItem")}</p>
                  <div className="mt-3 flex items-center justify-center gap-4">
                    <div className="text-center">
                      <div className="h-20 w-20 rounded-xl overflow-hidden mx-auto" style={{ background: "#FFFFFF" }}>
                        <img src={it.imageDataUrl} alt="" className="h-full w-full object-contain p-1.5" />
                      </div>
                      <p className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">{t("outfitScan.newScan")}</p>
                    </div>
                    <div className="text-center">
                      <div className="h-20 w-20 rounded-xl overflow-hidden mx-auto" style={{ background: "#FFFFFF" }}>
                        {thumb && <img src={thumb} alt="" className="h-full w-full object-contain p-1.5" />}
                      </div>
                      <p className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">{t("outfitScan.alreadyOwned")}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateItem(it.key, { status: "confirmed-new" })}
                      className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                    >{t("outfitScan.noDifferent")}</button>
                    <button
                      onClick={() => updateItem(it.key, { status: "confirmed-duplicate" })}
                      className="h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]"
                    >{t("outfitScan.yesSame")}</button>
                  </div>
                </div>
              );
            }

            return (
              <DetectedItemCard
                key={it.key}
                item={it}
                imageUrl={it.imageDataUrl}
                onChange={(patch) => updateItem(it.key, patch)}
                onRemove={() => removeItem(it.key)}
              />
            );
          })}

          <div className="pt-2 pb-4 flex gap-2">
            <button
              onClick={reset}
              className="h-12 px-5 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
            >{t("outfitScan.startOver")}</button>
            <button
              onClick={save}
              disabled={toSave.length === 0}
              className="flex-1 h-12 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Check size={14} /> {t("outfitScan.saveItemsCount", { count: toSave.length })}
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
