import { X, Camera, Image as ImageIcon, Sparkles, Check, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const categories = ["Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories"];

export function AddItem({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"capture" | "details">("capture");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("Tops");
  const [color, setColor] = useState("");

  const onPick = (f: File | null) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    // basic AI placeholder suggestions
    setName(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    setStep("details");
  };

  const save = async () => {
    if (!user || !file) return;
    setSaving(true); setErr(null);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wardrobe").upload(path, file, {
        cacheControl: "3600", upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("wardrobe").getPublicUrl(path);

      const { error: dbErr } = await supabase.from("wardrobe_items").insert({
        user_id: user.id,
        name: name || "Untitled piece",
        brand: brand || null,
        category,
        color: color || null,
        image_url: pub.publicUrl,
      });
      if (dbErr) throw dbErr;
      onClose();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save");
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

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />

      {step === "capture" ? (
        <div className="flex-1 flex flex-col px-6 pb-10">
          <div className="relative flex-1 rounded-[2rem] overflow-hidden bg-gradient-to-br from-[oklch(0.35_0.02_60)] to-[oklch(0.18_0.012_60)] mb-6">
            <div className="absolute inset-0 grain opacity-30" />
            <div className="absolute inset-8 border border-white/20 rounded-2xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-white/60">
              <Sparkles size={28} className="mx-auto animate-float" />
              <p className="mt-3 text-[10px] uppercase tracking-[0.35em]">Add a garment</p>
              <p className="text-[10px] uppercase tracking-[0.35em] mt-1 opacity-60">photo, camera, or screenshot</p>
            </div>
            <div className="absolute bottom-5 left-0 right-0 flex items-center justify-around">
              <button onClick={() => fileRef.current?.click()} className="text-white/70"><ImageIcon size={22} /></button>
              <button
                onClick={() => fileRef.current?.click()}
                className="h-18 w-18 rounded-full border-4 border-white p-1 active:scale-90 transition"
              >
                <div className="h-14 w-14 rounded-full bg-white" />
              </button>
              <button onClick={() => fileRef.current?.click()} className="text-white/70"><Camera size={20} /></button>
            </div>
          </div>

          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
          >
            <ImageIcon size={16} />
            <span className="text-[10px] uppercase tracking-widest">Upload from library</span>
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-10 animate-fade-in">
          <div className="rounded-2xl overflow-hidden bg-secondary/40 aspect-[4/5]">
            {preview && <img src={preview} alt="" className="h-full w-full object-cover" />}
          </div>

          <div className="mt-6 flex items-center gap-2 rounded-full bg-[var(--champagne)]/20 border border-[var(--champagne)]/40 px-3.5 py-2 w-fit">
            <Sparkles size={12} />
            <span className="text-[10px] uppercase tracking-widest">AI suggestion (edit to refine)</span>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Name" value={name} onChange={setName} />
            <Field label="Brand" value={brand} onChange={setBrand} placeholder="optional" />
            <Field label="Color" value={color} onChange={setColor} placeholder="e.g. cream · warm" />
            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Category</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {categories.map(c => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`rounded-full px-3 py-1.5 text-xs transition ${category === c ? "bg-foreground text-background" : "bg-secondary/60"}`}
                  >{c}</button>
                ))}
              </div>
            </div>
          </div>

          {err && <p className="mt-4 text-xs text-red-700">{err}</p>}

          <button
            onClick={save}
            disabled={saving}
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
