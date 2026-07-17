import { X, Camera, Image as ImageIcon, Sparkles, Check, Loader2, Upload, Link as LinkIcon } from "lucide-react";
import type { DragEvent } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { analyzeWardrobeImage } from "@/lib/ai-analyze.functions";
import { removeBackground } from "@/lib/ai-bgremove.functions";
import { importProductFromUrl } from "@/lib/import-url.functions";

const categories = ["Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories", "Underwear"];
const seasonOptions = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"];
const styleOptions = ["Minimal", "Editorial", "Quiet luxury", "Street", "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage"];
const occasionOptions = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"];
const materialOptions = ["Silk", "Linen", "Cotton", "Wool", "Cashmere", "Denim", "Leather", "Suede", "Synthetic", "Knit"];
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
  // Near-neutral grey/white covering common checker palettes:
  // Photoshop-style (#CCCCCC / #FFFFFF) and darker Gemini variant
  // (~#B0B0B0 / ~#E0E0E0). Chroma-key range only, not saturated colors.
  const grey = Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && Math.abs(r - b) < 10;
  if (!grey) return false;
  return r >= 235 || (r >= 175 && r <= 225);
}

/**
 * Ensure the AI-removed-background PNG has a REAL alpha channel.
 *
 * Handles the one real failure mode from the AI bg-removal step: some image
 * models (Gemini flash-image included, intermittently) return an opaque RGB
 * PNG where the "transparent" background is rasterised as a grey/white
 * checker pattern instead of true alpha=0 pixels. We detect that case by
 * sampling the four frame corners (a foreground subject cannot fill them)
 * and, when they look like checker greys/whites AND the image has no real
 * alpha variance, we zero out the ALPHA channel on every matching checker
 * pixel — producing genuine transparency instead of baking anything to
 * white.
 *
 * When the model already returned proper alpha, this function changes
 * nothing and returns the original bytes untouched.
 *
 * Search logs for "[AURA transparency]" for diagnostics.
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
      // Model already gave us real transparency — leave pixels untouched.
      isTransparent = true;
    } else if (checkerCorners >= 3) {
      // Baked-in checkerboard: zero the ALPHA on matching pixels so they
      // become genuinely transparent, instead of painting them white.
      console.warn("[AURA transparency] baked checkerboard detected — zeroing alpha on checker pixels");
      for (let i = 0; i < d.length; i += 4) {
        if (isCheckerPixel(d[i], d[i + 1], d[i + 2])) {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      isTransparent = true;
    } else {
      // Neither real alpha nor a recognisable checker — nothing safe to do,
      // ship the image as-is rather than guessing.
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

type Stage = "idle" | "bgremove" | "analyze";

export function AddItem({ onClose }: { onClose: () => void }) {
  const { loading: authLoading } = useAuth();
  const analyze = useServerFn(analyzeWardrobeImage);
  const bgRemove = useServerFn(removeBackground);
  const importUrl = useServerFn(importProductFromUrl);
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

  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("Tops");
  const [colors, setColors] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);

  const resetFields = () => {
    setBrand(""); setCategory("Tops"); setColors([]);
    setSeasons([]); setStyles([]); setOccasions([]); setMaterials([]);
  };

  /**
   * Full pipeline for a chosen image (from camera/gallery/upload/URL).
   * 1. Show preview immediately.
   * 2. Run AI analysis for form pre-fill.
   * 3. Attempt background removal; on success, swap file+preview to the PNG.
   *    On failure, keep the original image (non-blocking).
   */
  const runPipeline = async (initialFile: File, opts?: { brand?: string; source?: "photo" | "url" }) => {
    setFile(initialFile);
    setPreview(URL.createObjectURL(initialFile));
    setTransparent(false);
    setStep("details");
    resetFields();
    if (opts?.brand) setBrand(opts.brand);

    const dataUrl = await readFileAsDataUrl(initialFile);

    // Kick both off in parallel; UI shows the current stage.
    setStage("analyze");
    const analysisPromise = analyze({ data: { imageDataUrl: dataUrl } })
      .then(result => {
        if (result.category) setCategory(result.category);
        if (result.colors?.length) setColors(result.colors);
        if (result.styles?.length) setStyles(result.styles);
        if (result.occasions?.length) setOccasions(result.occasions);
        if (result.seasons?.length) setSeasons(result.seasons);
        // Material auto-detection only applies to photos (camera/gallery/upload).
        // URL-imported product shots are left for manual selection, since the
        // fabric read on catalog photography is less reliable and the person
        // asked to always confirm materials by hand for that path.
        if (opts?.source !== "url" && result.materials?.length) setMaterials(result.materials);
        // Don't overwrite a domain-derived brand with an empty AI result.
        if (result.brand && !opts?.brand) setBrand(result.brand);
      })
      .catch(e => console.warn("[AURA] AI analysis failed", e));

    setStage("bgremove");
    try {
      const bg = await bgRemove({ data: { imageDataUrl: dataUrl } });
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
      const result = await importUrl({ data: { url: parsed.toString() } });
      if (!result.ok) { toast.error(result.error); return; }
      const file = await dataUrlToFile(result.imageDataUrl, `import-${Date.now()}.jpg`);
      await runPipeline(file, { brand: result.brand || undefined, source: "url" });
      if (result.title) toast.message(result.title, { description: result.price ?? undefined });
    } catch (e) {
      console.error("[AURA import-url]", e);
      toast.error("Could not import from that URL");
    } finally {
      setImporting(false);
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

      // Prefer PNG extension after background removal; otherwise use the file's real type.
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
        brand: brand.trim() || null,
        color: colors[0] ?? null,
        colors,
        season: seasons.filter((s) => seasonOptions.includes(s)).join(", ") || null,
        style: styles.filter((s) => styleOptions.includes(s)).join(", ") || null,
        occasion: occasions.filter((o) => occasionOptions.includes(o)).join(", ") || null,
        material: materials.filter((m) => materialOptions.includes(m)),
      };

      const { data: inserted, error: insErr } = await supabase
        .from("wardrobe_items").insert(payload).select("*").single();
      if (insErr) throw insErr;

      toast.success("Added to your closet");
      window.dispatchEvent(new CustomEvent("aura:wardrobe-item-created", { detail: inserted }));
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save wardrobe item.";
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
        <button onClick={onClose} className="h-10 w-10 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90">
          <X size={18} />
        </button>
        <p className="font-serif text-lg italic">Add a piece</p>
        <div className="w-10" />
      </header>

      <input ref={galleryRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
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
              <p className="text-[10px] uppercase tracking-[0.35em] mt-1 opacity-60">camera · gallery · upload</p>
            </div>
            <div className="absolute bottom-5 left-0 right-0 flex items-center justify-around">
              <button onClick={() => galleryRef.current?.click()} className="text-white/70 flex flex-col items-center gap-1">
                <ImageIcon size={22} />
                <span className="text-[8px] uppercase tracking-widest">Gallery</span>
              </button>
              <button
                onClick={() => cameraRef.current?.click()}
                className="h-18 w-18 rounded-full border-4 border-white p-1 active:scale-90 transition"
                aria-label="Take photo"
              >
                <div className="h-14 w-14 rounded-full bg-white" />
              </button>
              <button onClick={() => cameraRef.current?.click()} className="text-white/70 flex flex-col items-center gap-1">
                <Camera size={20} />
                <span className="text-[8px] uppercase tracking-widest">Camera</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => galleryRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <ImageIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">Gallery</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <Upload size={16} />
              <span className="text-[10px] uppercase tracking-widest">Upload</span>
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

          <div className="mt-6 flex items-center gap-2 rounded-full bg-[var(--champagne)]/20 border border-[var(--champagne)]/40 px-3.5 py-2 w-fit">
            {stage !== "idle" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            <span className="text-[10px] uppercase tracking-widest">{stageLabel}</span>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Brand" value={brand} onChange={setBrand} placeholder={stage === "analyze" ? "detecting…" : "leave empty if no logo"} />
            <ChipGroup label="Category" options={categories} value={category} onChange={setCategory} />
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
            <MultiChipGroup label="Material" options={materialOptions} values={materials} onToggle={(v: string) => toggle(materials, setMaterials, v)} />
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

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
      />
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
