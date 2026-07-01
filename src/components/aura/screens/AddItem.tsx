import { X, Camera, Image as ImageIcon, Sparkles, Check, Loader2, Upload } from "lucide-react";
import type { DragEvent } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { analyzeWardrobeImage } from "@/lib/ai-analyze.functions";

const categories = ["Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories"];
const seasonOptions = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"];
const styleOptions = ["Minimal", "Editorial", "Quiet luxury", "Street", "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage"];
const occasionOptions = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"];
const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);

function fileExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && imageExtensions.has(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  const map: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };
  return map[file.type] ?? "jpg";
}

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

export function AddItem({ onClose }: { onClose: () => void }) {
  const { loading: authLoading } = useAuth();
  const analyze = useServerFn(analyzeWardrobeImage);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"capture" | "details">("capture");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("Tops");
  const [colors, setColors] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);

  const onPick = async (f: File | null) => {
    if (!f) return;
    if (!isImageFile(f)) { toast.error("Please select an image"); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStep("details");
    // Reset previous suggestions
    setBrand(""); setCategory("Tops"); setColors([]); setSeasons([]); setStyles([]); setOccasions([]);

    // Kick off AI analysis
    setAnalyzing(true);
    try {
      const dataUrl = await readFileAsDataUrl(f);
      const result = await analyze({ data: { imageDataUrl: dataUrl } });
      if (result.category) setCategory(result.category);
      if (result.colors?.length) setColors(result.colors);
      if (result.styles?.length) setStyles(result.styles);
      if (result.occasions?.length) setOccasions(result.occasions);
      if (result.seasons?.length) setSeasons(result.seasons);
      if (result.brand) setBrand(result.brand);
    } catch (e) {
      console.warn("[AURA] AI analysis failed", e);
    } finally {
      setAnalyzing(false);
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

      const ext = fileExtension(file);
      const path = `${uid}/item-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wardrobe").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg",
      });
      if (upErr) throw upErr;

      // Store storage path (not URL). Wardrobe grid signs it on read since bucket is private.
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

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => galleryRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <ImageIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">From gallery</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <Upload size={16} />
              <span className="text-[10px] uppercase tracking-widest">Upload file</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-10 animate-fade-in">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="rounded-2xl overflow-hidden bg-secondary/40 aspect-[4/5]"
          >
            {preview && <img src={preview} alt="" className="h-full w-full object-cover" />}
          </div>

          <div className="mt-6 flex items-center gap-2 rounded-full bg-[var(--champagne)]/20 border border-[var(--champagne)]/40 px-3.5 py-2 w-fit">
            {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            <span className="text-[10px] uppercase tracking-widest">
              {analyzing ? "Analyzing your item…" : "AI suggestions ready · edit anything"}
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Brand" value={brand} onChange={setBrand} placeholder={analyzing ? "detecting…" : "leave empty if no logo"} />
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
