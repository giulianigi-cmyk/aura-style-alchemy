import { X, Image as ImageIcon, Sparkles, Check, Loader2, Upload, Link as LinkIcon } from "lucide-react";
import type { DragEvent } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { MaterialCombobox } from "@/components/aura/MaterialCombobox";
import { analyzeWardrobeImage } from "@/lib/ai-analyze.functions";
import { removeBackgroundClient } from "@/lib/bg-removal-client";
import { importProductFromUrl, type CompositionEntry } from "@/lib/import-url.functions";
import { downloadImportImage } from "@/lib/import-image.functions";
import { compressImageForUpload } from "@/lib/image-compress";
import { sizeEquivalences, isShoeCategory } from "@/lib/size-conversion";


import {
  ITEM_CATEGORIES as categories,
  SEASON_OPTIONS as seasonOptions,
  STYLE_OPTIONS as styleOptions,
  OCCASION_OPTIONS as occasionOptions,
  MATERIAL_OPTIONS as materialOptions,
  CURRENCY_OPTIONS as currencyOptions,
  SLEEVE_LENGTH_OPTIONS as sleeveLengthOptions,
  FIT_OPTIONS as fitOptions,
  HEEL_HEIGHT_OPTIONS as heelHeightOptions,
  TOE_SHAPE_OPTIONS as toeShapeOptions,
  CLOSURE_OPTIONS as closureOptions,
  GENDER_OPTIONS as genderOptions,
  STYLE_TAG_OPTIONS as styleTagOptions,
  subcategoriesFor,
  attributeAppliesTo,
  lengthOptionsFor,
  lengthAppliesTo,
} from "@/lib/wardrobe-options";
const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);

function isImageFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("image/") || imageExtensions.has(ext);
}

function readFileAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(f);
  });
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

/**
 * Flatten a (potentially transparent) PNG onto a solid white background.
 *
 * Handles TWO failure modes from the AI bg-removal step:
 *  1. Real alpha transparency — fillWhite + drawImage drops the alpha
 *     channel and produces a clean white background.
 *  2. Baked-in checkerboard pixels — some image models (Gemini flash-image
 *     included, intermittently) return an RGB PNG where the "transparent"
 *     background is rasterised as a grey/white checker pattern. In that
 *     case a simple composite does nothing because the checker pixels are
 *     fully opaque. We detect it by sampling corner pixels (a foreground
 *     subject cannot fill the frame corners) and, when they look like
 *     checker greys/whites, replace every matching pixel with white before
 *     compositing.
 *
 * Search logs for "[AURA flatten]" for diagnostics (dims, alpha stats,
 * corner RGBA, whether the baked-checker path fired).
 */
function isCheckerPixel(r: number, g: number, b: number): boolean {
  const grey = Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && Math.abs(r - b) < 10;
  if (!grey) return false;
  return r >= 235 || (r >= 175 && r <= 225);
}

/**
 * Ensure the AI-removed-background PNG has a REAL alpha channel.
 */
async function ensureTransparentPng(
  dataUrl: string,
  filename: string,
): Promise<{ file: File; isTransparent: boolean }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("transparency check: image failed to load"));
    el.src = dataUrl;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("transparency check: no 2d context");
  ctx.drawImage(img, 0, 0);

  let isTransparent = false;
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    let hasAlpha = false;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 250) { hasAlpha = true; break; }
    }

    const corner = (x: number, y: number) => {
      const o = (y * w + x) * 4;
      return [d[o], d[o + 1], d[o + 2], d[o + 3]] as const;
    };
    const tl = corner(0, 0);
    const tr = corner(w - 1, 0);
    const bl = corner(0, h - 1);
    const br = corner(w - 1, h - 1);
    const checkerCorners = [tl, tr, bl, br].filter((p) => isCheckerPixel(p[0], p[1], p[2])).length;

    console.log(
      "[AURA transparency] dims", w, "x", h,
      "hasAlpha", hasAlpha,
      "checkerCorners", checkerCorners,
      "corners", { tl, tr, bl, br },
    );

    if (hasAlpha) {
      isTransparent = true;
    } else if (checkerCorners >= 3) {
      console.warn("[AURA transparency] baked checkerboard detected — zeroing alpha on checker pixels");
      for (let i = 0; i < d.length; i += 4) {
        if (isCheckerPixel(d[i], d[i + 1], d[i + 2])) {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      isTransparent = true;
    } else {
      console.warn("[AURA transparency] no alpha and no recognisable checker — leaving image untouched");
    }
  } catch (e) {
    console.warn("[AURA transparency] pixel inspection failed", e);
  }

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("transparency check: toBlob null"))), "image/png"),
  );
  console.log("[AURA transparency] output bytes", blob.size, "isTransparent", isTransparent);
  return { file: new File([blob], filename, { type: "image/png" }), isTransparent };
}



/** remove.bg only accepts JPG/PNG — CDNs sometimes serve webp/avif anyway
 *  (that's why Mytheresa imports kept their background while Zara worked).
 *  The browser decodes those natively, so we re-encode via canvas. */
async function normalizeForPipeline(f: File): Promise<File> {
  if (f.type === "image/jpeg" || f.type === "image/png") return f;
  try {
    const bitmap = await createImageBitmap(f);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return f;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return f;
    return new File([blob], f.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch (e) {
    console.warn("[AURA normalize] re-encode failed, keeping original", e);
    return f;
  }
}

type Stage = "idle" | "bgremove" | "analyze";

export function AddItem({ onClose }: { onClose: () => void }) {
  const { loading: authLoading } = useAuth();
  const analyze = useServerFn(analyzeWardrobeImage);
  
  const importUrl = useServerFn(importProductFromUrl);
  const downloadImage = useServerFn(downloadImportImage);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"capture" | "url" | "details">("capture");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [transparent, setTransparent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [err, setErr] = useState<string | null>(null);

  const [urlInput, setUrlInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [altImages, setAltImages] = useState<string[]>([]);
  const [altLoading, setAltLoading] = useState<string | null>(null);
  const [importReferer, setImportReferer] = useState<string>("");

  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [category, setCategory] = useState("Tops");
  const [subcategory, setSubcategory] = useState("");
  const [length, setLength] = useState("");
  const [sleeveLength, setSleeveLength] = useState("");
  const [fit, setFit] = useState("");
  const [heelHeight, setHeelHeight] = useState("");
  const [toeShape, setToeShape] = useState("");
  const [closure, setClosure] = useState("");
  const [gender, setGender] = useState("");
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [composition, setComposition] = useState<CompositionEntry[]>([]);

  const resetFields = () => {
    setBrand(""); setSize(""); setCategory("Tops"); setSubcategory(""); setColors([]);
    setLength(""); setSleeveLength(""); setFit(""); setHeelHeight(""); setToeShape("");
    setClosure(""); setGender(""); setStyleTags([]);
    setSeasons([]); setStyles([]); setOccasions([]); setMaterials([]);
    setPrice(""); setCurrency("EUR"); setComposition([]);
  };

  const runPipeline = async (initialFile: File, opts?: { brand?: string; source?: "photo" | "url"; price?: string; currency?: string; materials?: string[]; composition?: CompositionEntry[] }) => {
    const compressedFile = await compressImageForUpload(initialFile);
    setFile(compressedFile);
    setPreview(URL.createObjectURL(compressedFile));
    setTransparent(false);
    setStep("details");
    resetFields();
    if (opts?.brand) setBrand(opts.brand);
    if (opts?.price) setPrice(opts.price);
    if (opts?.currency) setCurrency(opts.currency);
    if (opts?.materials?.length) setMaterials(opts.materials);
    if (opts?.composition?.length) setComposition(opts.composition);

    const dataUrl = await readFileAsDataUrl(compressedFile);

    setStage("analyze");
    const analysisPromise = analyze({ data: { imageDataUrl: dataUrl } })
      .then(result => {
        if (result.category) setCategory(result.category);
        if (result.subcategory) setSubcategory(result.subcategory);
        if (result.length) setLength(result.length);
        if (result.sleeveLength) setSleeveLength(result.sleeveLength);
        if (result.fit) setFit(result.fit);
        if (result.heelHeight) setHeelHeight(result.heelHeight);
        if (result.toeShape) setToeShape(result.toeShape);
        if (result.closure) setClosure(result.closure);
        if (result.gender) setGender(result.gender);
        if (result.styleTags?.length) setStyleTags(result.styleTags);
        if (result.colors?.length) setColors(result.colors);
        if (result.styles?.length) setStyles(result.styles);
        if (result.occasions?.length) setOccasions(result.occasions);
        if (result.seasons?.length) setSeasons(result.seasons);
        if (!opts?.materials?.length && result.materials?.length) setMaterials(result.materials);
        if (result.brand && !opts?.brand) setBrand(result.brand);
      })
      .catch(e => console.warn("[AURA] AI analysis failed", e));

    setStage("bgremove");
    try {
      // Retry automatico: fino a 3 tentativi totali con backoff crescente,
      // prima di arrendersi e tenere la foto senza sfondo rimosso.
      let bg = await removeBackgroundClient(dataUrl);
      let attempt = 1;
      while (!bg.ok && attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        bg = await removeBackgroundClient(dataUrl);
        attempt++;
      }
      if (!bg.ok) toast.message("Background not removed", { description: bg.error });
      if (bg.ok) {

        const { file: cleanFile, isTransparent } = await ensureTransparentPng(
          bg.imageDataUrl,
          `item-${Date.now()}.png`,
        );
        setFile(cleanFile);
        setPreview(URL.createObjectURL(cleanFile));
        setTransparent(isTransparent);
      }
    } catch (e) {
      console.warn("[AURA] bg removal failed", e);
    }

    await analysisPromise;
    setStage("idle");
  };

  const onPick = async (f: File | null) => {
    if (!f) return;
    if (!isImageFile(f)) { toast.error("Please select an image"); return; }
    setAltImages([]);
    await runPipeline(f);
  };
  const handleImportUrl = async () => {
    const raw = urlInput.trim();
    if (!raw) return;
    let parsed: URL;
    try { parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`); }
    catch { toast.error("Please enter a valid URL"); return; }

    setImporting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const result = await importUrl({
        data: { url: parsed.toString(), accessToken: sess.session?.access_token },
      });
      if (!result.ok) { toast.error(result.error); return; }
      setAltImages(result.imageCandidates ?? []);
      setImportReferer(parsed.origin);
      const raw = await dataUrlToFile(result.imageDataUrl, `import-${Date.now()}.jpg`);
      const file = await normalizeForPipeline(raw);
      await runPipeline(file, {
        brand: result.brand || undefined,
        source: "url",
        price: result.priceValue != null ? String(result.priceValue) : undefined,
        currency: result.priceCurrency || undefined,
        materials: result.materials?.length ? result.materials : undefined,
        composition: result.composition?.length ? result.composition : undefined,
      });
      if (result.title) toast.message(result.title, { description: result.price ?? undefined });
      if (result.confidence === "low") {
        toast.message("Double-check the photo", {
          description: "We couldn't verify this image against the product page — make sure it's the right piece.",
        });
      }
    } catch (e) {
      console.error("[AURA import-url]", e);
      toast.error("Could not import from that URL");
    } finally {
      setImporting(false);
    }
  };

  const useAltImage = async (url: string) => {
    if (altLoading) return;
    setAltLoading(url);
    try {
      const res = await downloadImage({ data: { url, referer: importReferer || undefined } });
      if (!res.ok) { toast.error(res.error); return; }
      const rawF = await dataUrlToFile(res.imageDataUrl, `import-${Date.now()}.jpg`);
      const f = await normalizeForPipeline(rawF);
      await runPipeline(f, {
        brand: brand || undefined,
        source: "url",
        price: price || undefined,
        currency,
        materials: materials.length ? materials : undefined,
        composition: composition.length ? composition : undefined,
      });
    } catch (e) {
      console.error("[AURA import-alt]", e);
      toast.error("Could not load that photo");
    } finally {
      setAltLoading(null);
    }
  };

  const toggle = (values: string[], setter: (next: string[]) => void, value: string) =>
    setter(values.includes(value) ? values.filter((x) => x !== value) : [...values, value]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void onPick(event.dataTransfer.files?.[0] ?? null);
  };

  const save = async () => {
    if (!file) return;
    setSaving(true); setErr(null);
    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr || !auth?.user?.id) throw new Error("You must be signed in to add a piece.");
      const uid = auth.user.id;

      const isPng = file.type === "image/png";
      const ext = isPng ? "png" : (file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg");
      const path = `${uid}/item-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wardrobe").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type || "image/png",
      });
      if (upErr) throw upErr;

      const payload: TablesInsert<"wardrobe_items"> = {
        user_id: uid,
        image_url: path,
        category: categories.includes(category) ? category : "Tops",
        subcategory: subcategoriesFor(category).includes(subcategory) ? subcategory : null,
        brand: brand.trim() || null,
        color: colors[0] ?? null,
        colors,
        season: seasons.filter((s) => seasonOptions.includes(s)).join(", ") || null,
        style: styles.filter((s) => styleOptions.includes(s)).join(", ") || null,
        occasion: occasions.filter((o) => occasionOptions.includes(o)).join(", ") || null,
        material: materials.filter((m) => materialOptions.includes(m)),
        price: (() => {
          const n = parseFloat(price.replace(",", "."));
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        currency: price.trim() ? currency : null,
        size: size.trim() || null,
      };
      const compositionToSave = composition.filter((c) => materials.includes(c.material));
      const fullPayload = {
        ...payload,
        composition: compositionToSave.length ? compositionToSave : null,
        length: length || null,
        sleeve_length: sleeveLength || null,
        fit: fit || null,
        heel_height: heelHeight || null,
        toe_shape: toeShape || null,
        closure: closure || null,
        gender: gender || null,
        style_tags: styleTags,
      } as unknown as TablesInsert<"wardrobe_items">;

      let { data: inserted, error: insErr } = await supabase
        .from("wardrobe_items").insert(fullPayload).select("*").single();
      if (insErr && /column .* does not exist|composition/i.test(String(insErr.message))) {
        console.warn("[AURA wardrobe] new column not in cache yet — saving without extended attributes", insErr.message);
        ({ data: inserted, error: insErr } = await supabase
          .from("wardrobe_items").insert(payload).select("*").single());
      }
      if (insErr) throw insErr;

      toast.success("Added to your closet");
      window.dispatchEvent(new CustomEvent("aura:wardrobe-item-created", { detail: inserted }));
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : "Failed to save wardrobe item.");
      console.error("[AURA wardrobe] save failed", e);
      setErr(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const stageLabel =
    stage === "bgremove" ? "Cleaning up image…" :
    stage === "analyze"  ? "Analyzing your item…" :
    "AI suggestions ready · edit anything";

  return (
    <div className="absolute inset-0 z-50 bg-background animate-slide-up flex flex-col">
      <header className="flex items-center justify-between px-6 pt-14 pb-3">
        <button onClick={onClose} aria-label="Close add item" className="h-10 w-10 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90">
          <X size={18} />
        </button>
        <h1 className="font-serif text-lg italic">Add a New Piece</h1>
        <div className="w-10" />
      </header>

      <input ref={galleryRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <input ref={fileRef} type="file" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      {step === "capture" ? (
        <div className="flex-1 flex flex-col px-6 pb-10">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="relative flex-1 rounded-[2rem] overflow-hidden bg-gradient-to-br from-[oklch(0.35_0.02_60)] to-[oklch(0.18_0.012_60)] mb-6"
          >
            <div className="absolute inset-0 grain opacity-30" />
            <div className="absolute inset-8 border border-white/20 rounded-2xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-white/60">
              <Sparkles size={28} className="mx-auto animate-float" />
              <p className="mt-3 text-[10px] uppercase tracking-[0.35em]">Add a garment</p>
              <p className="text-[10px] uppercase tracking-[0.35em] mt-1 opacity-60">tap to take a photo</p>
            </div>
            <div className="absolute bottom-5 left-0 right-0 flex items-center justify-center">
              <button
                onClick={() => cameraRef.current?.click()}
                className="h-18 w-18 rounded-full border-4 border-white p-1 active:scale-90 transition"
                aria-label="Take photo"
              >
                <div className="h-14 w-14 rounded-full bg-white" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => galleryRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <ImageIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">Photo library</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <Upload size={16} />
              <span className="text-[10px] uppercase tracking-widest">Choose file</span>
            </button>
            <button
              onClick={() => setStep("url")}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <LinkIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">From URL</span>
            </button>
          </div>
        </div>
      ) : step === "url" ? (
        <div className="flex-1 flex flex-col px-6 pb-10 animate-fade-in">
          <div className="rounded-2xl bg-secondary/40 p-6">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Import from URL</p>
            <p className="font-serif text-2xl italic mt-2">Paste a product link</p>
            <p className="text-xs text-muted-foreground mt-2">
              Works with most fashion stores.
              We'll extract the product photo, clean it up and pre-fill the details.
            </p>
            <div className="mt-5 rounded-full bg-background border border-border flex items-center px-4 py-2.5">
              <LinkIcon size={14} className="text-muted-foreground shrink-0" />
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.zara.com/…"
                className="flex-1 ml-2 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                autoFocus
              />
            </div>
            <button
              onClick={handleImportUrl}
              disabled={importing || !urlInput.trim()}
              className="mt-4 w-full h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] disabled:opacity-60"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
              Import product
            </button>
            <button
              onClick={() => setStep("capture")}
              className="mt-3 w-full h-10 rounded-full border border-border text-xs uppercase tracking-[0.3em]"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-10 animate-fade-in">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="rounded-2xl overflow-hidden aspect-[4/5]"
            style={{ background: "#F5F5F5" }}
          >
            {preview && (
              <img
                src={preview}
                alt=""
                className={`h-full w-full ${transparent ? "object-contain p-4" : "object-cover"}`}
              />
            )}
          </div>

          {altImages.length > 1 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Wrong photo? Pick another</p>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {altImages.map((u) => (
                  <button
                    key={u}
                    onClick={() => void useAltImage(u)}
                    disabled={altLoading !== null}
                    className="relative h-20 w-16 shrink-0 rounded-xl overflow-hidden border border-border bg-secondary/40 active:scale-95 transition"
                    aria-label="Use this photo"
                  >
                    <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {altLoading === u && (
                      <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                        <Loader2 size={14} className="animate-spin" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center gap-2 rounded-full bg-[var(--champagne)]/20 border border-[var(--champagne)]/40 px-3.5 py-2 w-fit">
            {stage !== "idle" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            <span className="text-[10px] uppercase tracking-widest">{stageLabel}</span>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Brand" value={brand} onChange={setBrand} placeholder={stage === "analyze" ? "detecting…" : "leave empty if no logo"} />
            <Field
              label="Size"
              value={size}
              onChange={setSize}
              placeholder="e.g. 42 or M — optional"
              hint={sizeEquivalences(size, { shoes: isShoeCategory(category) }) ?? undefined}
            />

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Price</p>
              <div className="mt-1 flex items-center gap-3">
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/[^0-9.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="e.g. 129.90"
                  className="flex-1 bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
                />
                <div className="flex gap-1.5">
                  {currencyOptions.map((c) => (
                    <button key={c} onClick={() => setCurrency(c)}
                      className={`rounded-full px-2.5 py-1 text-[10px] tracking-widest transition ${currency === c ? "bg-foreground text-background" : "bg-secondary/60"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Powers cost-per-wear in the item card.</p>
            </div>
            <ChipGroup
              label="Category"
              options={categories}
              value={category}
              onChange={(c) => {
                setCategory(c); setSubcategory("");
                setLength(""); setSleeveLength(""); setFit("");
                setHeelHeight(""); setToeShape(""); setClosure("");
              }}
            />
            {subcategoriesFor(category).length > 0 && (
              <ChipGroup
                label="Type"
                options={subcategoriesFor(category)}
                value={subcategory}
                onChange={(t) => { setSubcategory(t); setLength(""); }}
              />
            )}
            {lengthAppliesTo(category, subcategory) && (
              <ChipGroup label="Length" options={lengthOptionsFor(category, subcategory)} value={length} onChange={setLength} />
            )}
            {attributeAppliesTo("sleeveLength", category) && (
              <ChipGroup label="Sleeve" options={sleeveLengthOptions} value={sleeveLength} onChange={setSleeveLength} />
            )}
            {attributeAppliesTo("fit", category) && (
              <ChipGroup label="Fit" options={fitOptions} value={fit} onChange={setFit} />
            )}
            {attributeAppliesTo("heelHeight", category) && (
              <ChipGroup label="Heel" options={heelHeightOptions} value={heelHeight} onChange={setHeelHeight} />
            )}
            {attributeAppliesTo("toeShape", category) && (
              <ChipGroup label="Toe shape" options={toeShapeOptions} value={toeShape} onChange={setToeShape} />
            )}
            {attributeAppliesTo("closure", category) && (
              <ChipGroup label="Closure" options={closureOptions} value={closure} onChange={setClosure} />
            )}
            <ChipGroup label="Gender" options={genderOptions} value={gender} onChange={setGender} />
            <MultiChipGroup
              label="Style tags"
              options={styleTagOptions}
              values={styleTags}
              onToggle={(v: string) => toggle(styleTags, setStyleTags, v)}
            />
            <ColorPicker value={colors} onChange={setColors} />

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Season</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {seasonOptions.map(s => {
                  const on = seasons.includes(s);
                  return (
                    <button key={s} onClick={() => toggle(seasons, setSeasons, s)}
                      className={`rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60"}`}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <MultiChipGroup label="Style" options={styleOptions} values={styles} onToggle={(v: string) => toggle(styles, setStyles, v)} />
            <MultiChipGroup label="Occasion" options={occasionOptions} values={occasions} onToggle={(v: string) => toggle(occasions, setOccasions, v)} />
            <MaterialCombobox label="Material" options={materialOptions} values={materials} onChange={setMaterials} />
            {composition.length > 0 && (
              <p className="text-[11px] text-muted-foreground -mt-1">
                Composition: {composition.map((c) => (c.pct != null ? `${c.pct}% ${c.material}` : c.material)).join(" · ")}
              </p>
            )}
          </div>

          {err && <p className="mt-4 text-xs text-red-700">{err}</p>}

          <button
            onClick={save}
            disabled={saving || authLoading}
            className="mt-8 w-full h-14 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            <span className="text-xs uppercase tracking-[0.3em]">Save to closet</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChipGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(o => (
          <button key={o}
            onClick={() => onChange(o)}
            className={`rounded-full px-3 py-1.5 text-xs transition ${value === o ? "bg-foreground text-background" : "bg-secondary/60"}`}
          >{o}</button>
        ))}
      </div>
    </div>
  );
}

function MultiChipGroup({ label, options, values, onToggle }: { label: string; options: string[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(o => {
          const on = values.includes(o);
          return (
            <button key={o}
              onClick={() => onToggle(o)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60"}`}
            >{o}</button>
          );
        })}
      </div>
    </div>
  );
}
