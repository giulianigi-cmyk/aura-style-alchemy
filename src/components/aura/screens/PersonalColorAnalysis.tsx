import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, RotateCcw, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { classifyColorSeason, type SeasonResult } from "@/lib/personal-color";
import { autoSampleFromCanvas } from "@/lib/face-analyze";
import { useProfile } from "@/hooks/use-profile";

type Step = "instructions" | "sampling" | "result";
type TapIndex = 0 | 1 | 2;



const TAP_PROMPTS = [
  "Tap a spot on your skin (cheek or forehead)",
  "Tap a strand of your hair",
  "Tap the iris of one eye",
] as const;

const TAP_LABELS = ["Skin", "Hair", "Eyes"] as const;

const GUIDELINES = [
  "Wear a plain white T-shirt or a neutral white top",
  "Remove makeup if possible",
  "Tie your hair back so your face is fully visible",
  "Remove glasses if possible",
  "Use natural daylight",
  "Avoid direct sunlight or strong shadows",
  "Stand in front of a neutral white or light-colored background",
  "Look directly at the camera",
  "Keep a neutral facial expression",
  "Do not use filters or beauty effects",
  "Use the highest photo quality available",
];

export function PersonalColorAnalysis({ go }: { go: (s: Screen) => void }) {
  const { update } = useProfile();
  const [step, setStep] = useState<Step>("instructions");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [samples, setSamples] = useState<(string | null)[]>([null, null, null]);
  const [activeTap, setActiveTap] = useState<TapIndex>(0);
  const [result, setResult] = useState<SeasonResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoRanRef = useRef<string | null>(null);

  // Draw the photo onto the canvas, then attempt automatic face-based sampling.
  useEffect(() => {
    if (step !== "sampling" || !imageUrl || !canvasRef.current) return;
    const img = new Image();
    img.onload = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const size = 640;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#F5EFE0";
      ctx.fillRect(0, 0, size, size);
      const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

      // Run auto-detection once per loaded image.
      if (autoRanRef.current === imageUrl) return;
      autoRanRef.current = imageUrl;
      setAnalyzing(true);
      try {
        const auto = await autoSampleFromCanvas(canvas);
        if (auto) {
          setSamples([auto.skin, auto.hair, auto.eye]);
          setActiveTap(0);
        } else {
          toast("Couldn't detect your face automatically. Tap the three points manually.");
        }
      } catch (err) {
        console.error("[AURA] auto face analysis failed", err);
        toast("Couldn't detect your face automatically. Tap the three points manually.");
      } finally {
        setAnalyzing(false);
      }
    };
    img.onerror = () => toast.error("Couldn't load photo");
    img.src = imageUrl;
  }, [step, imageUrl]);


  useEffect(() => {
    return () => { if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [imageUrl]);

  const onPickFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Please select an image"); return; }
    const url = URL.createObjectURL(f);
    setImageUrl(url);
    setSamples([null, null, null]);
    setActiveTap(0);
    setResult(null);
    setStep("sampling");
  };

  const handleTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    // Sample a small neighborhood instead of a single pixel — a lone pixel
    // can land on a stray highlight, shadow, or compression artifact.
    const RADIUS = 6;
    const sx = Math.max(0, Math.min(canvas.width - 1, x - RADIUS));
    const sy = Math.max(0, Math.min(canvas.height - 1, y - RADIUS));
    const sw = Math.min(canvas.width - sx, RADIUS * 2 + 1);
    const sh = Math.min(canvas.height - sy, RADIUS * 2 + 1);
    let box: ImageData;
    try { box = ctx.getImageData(sx, sy, sw, sh); }
    catch (err) { console.error("[AURA color-analysis] getImageData blocked", err); toast.error("Couldn't sample this photo"); return; }
    const reds: number[] = [], greens: number[] = [], blues: number[] = [];
    const d = box.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      reds.push(d[i]); greens.push(d[i + 1]); blues.push(d[i + 2]);
    }
    if (reds.length === 0) return;
    const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const r = median(reds), g = median(greens), b = median(blues);
    const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    const next = [...samples];
    next[activeTap] = hex;
    setSamples(next);
    // Advance to first not-yet-sampled index; else stay put
    const nextEmpty = next.findIndex(s => !s);
    if (nextEmpty !== -1) setActiveTap(nextEmpty as TapIndex);
  };

  const canFinish = samples.every(Boolean);

  const finish = () => {
    if (!canFinish) return;
    const [skin, hair, eye] = samples as [string, string, string];
    setResult(classifyColorSeason(skin, hair, eye));
    setStep("result");
  };

  const restart = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    autoRanRef.current = null;
    setImageUrl(null);
    setSamples([null, null, null]);
    setActiveTap(0);
    setResult(null);
    setAnalyzing(false);
    setStep("instructions");
  };


  const saveToProfile = async () => {
    if (!result) return;
    setSaving(true);
    const { error } = await update({
      season: result.subgroup,
      undertone: result.undertone,
      value: result.value,
      clarity: result.contrast, // repurposed column: now stores contrast (Alto/Medio/Basso)
    });
    setSaving(false);
    if (error) { toast.error("Couldn't save"); return; }
    toast.success("Saved to profile");
    go("profile");
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />

      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button
          onClick={() => step === "instructions" ? go("profile") : restart()}
          aria-label="Back"
          className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
        >
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">Color analysis</p>
        <span className="w-10" />
      </header>

      {step === "instructions" && (
        <section className="mx-6 mt-6 animate-fade-up">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Before you begin</p>
          <h2 className="font-serif text-3xl italic mt-2">A clear photo, a truer result.</h2>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
            This estimate is only as accurate as the photo. Take a moment to set the scene.
          </p>

          <ul className="mt-6 space-y-3">
            {GUIDELINES.map((g) => (
              <li key={g} className="flex gap-3 text-sm leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-foreground/60 shrink-0" />
                <span className="text-foreground/80">{g}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={() => fileRef.current?.click()}
            className="mt-8 w-full h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe"
          >
            <Camera size={14} />
            <span className="text-[10px] uppercase tracking-[0.3em]">Continue</span>
          </button>
        </section>
      )}

      {step === "sampling" && (
        <section className="mx-6 mt-6 animate-fade-up">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center">
            {analyzing ? "Please wait" : `Step ${activeTap + 1} of 3`}
          </p>
          <p className="mt-2 font-serif italic text-xl text-center">
            {analyzing ? "Analyzing your photo…" : TAP_PROMPTS[activeTap]}
          </p>

          <div className="mt-5 rounded-3xl overflow-hidden border border-border/60 bg-secondary/40 shadow-soft relative">
            {analyzing && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-sm">
                <Loader2 className="animate-spin" size={22} />
              </div>
            )}

            <canvas
              ref={canvasRef}
              onPointerDown={handleTap}
              className="w-full aspect-square touch-none cursor-crosshair block"
            />
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {samples.map((hex, i) => {
              const isActive = i === activeTap;
              return (
                <button
                  key={i}
                  onClick={() => setActiveTap(i as TapIndex)}
                  className={`rounded-2xl border p-3 flex flex-col items-center gap-2 transition ${
                    isActive ? "border-foreground bg-card" : "border-border/60 bg-card/60"
                  }`}
                >
                  <div
                    className="h-10 w-10 rounded-full border border-white/60 shadow-soft"
                    style={{ background: hex ?? "transparent",
                      backgroundImage: hex ? undefined : "repeating-conic-gradient(#eee 0% 25%, #fafafa 0% 50%)",
                      backgroundSize: hex ? undefined : "10px 10px" }}
                  />
                  <span className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{TAP_LABELS[i]}</span>
                  {hex && <span className="text-[9px] font-mono text-muted-foreground">{hex}</span>}
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center">
            Tap a swatch to retake it
          </p>

          <button
            onClick={finish}
            disabled={!canFinish}
            className="mt-6 w-full h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-40"
          >
            <Check size={14} />
            <span className="text-[10px] uppercase tracking-[0.3em]">See result</span>
          </button>
        </section>
      )}

      {step === "result" && result && (
        <section className="mx-6 mt-6 animate-fade-up">
          <div className="rounded-3xl gradient-warm border border-border/60 p-6 shadow-soft text-center">
            <span className="inline-block text-[9px] uppercase tracking-[0.35em] px-3 py-1 rounded-full bg-background/60 border border-border/60 text-muted-foreground">
              Estimated
            </span>
            <h2 className="font-serif text-4xl italic mt-3">
              {result.subgroup}
            </h2>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-2">
              {result.undertone} · {result.value} · Contrast {result.contrast}
            </p>

            <p className="mt-4 text-sm leading-relaxed text-foreground/80">
              {result.description}
            </p>
          </div>

          <div className="mt-6 rounded-3xl bg-card border border-border/60 p-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center mb-3">
              Season compatibility
            </p>
            {(Object.entries(result.compatibilityScores) as [string, number][])
              .sort((a, b) => b[1] - a[1])
              .map(([s, pct]) => (
                <div key={s} className="mb-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                    <span>{s}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                    <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            <p className="mt-3 text-[11px] text-muted-foreground italic text-center">
              {result.classificationConfidence === "Low"
                ? "Your top seasons are close — this reading is more uncertain than usual."
                : result.classificationConfidence === "Moderate"
                ? "A reasonably clear match, with some overlap with neighboring seasons."
                : "A clear, decisive match."}
              {result.sampleQuality !== "Good" && " The extracted samples also looked less clean than ideal — retaking in even, natural light may help."}
            </p>
          </div>

          <div className="mt-6 rounded-3xl bg-card border border-border/60 p-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center">
              Sampled from your photo
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {samples.map((hex, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div className="h-14 w-14 rounded-full border border-white/60 shadow-soft" style={{ background: hex ?? "#eee" }} />
                  <span className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{TAP_LABELS[i]}</span>
                  <span className="text-[9px] font-mono text-muted-foreground">{hex}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Your best colors</p>
            {(Object.entries(result.palette) as [string, string[]][])
              .filter(([, hexes]) => hexes.length > 0)
              .map(([family, hexes]) => (
                <div key={family} className="mb-2 flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[9px] uppercase tracking-widest text-muted-foreground capitalize">{family}</span>
                  <div className="flex gap-1.5">
                    {hexes.map((hex) => (
                      <div key={hex} className="h-7 w-7 rounded-full border border-white/40 shadow-soft" style={{ background: hex }} />
                    ))}
                  </div>
                </div>
              ))}
          </div>

          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Neutrals for you</p>
            <div className="grid grid-cols-6 gap-1.5">
              {result.neutrals.map((hex) => (
                <div key={hex} className="aspect-square rounded-full border border-white/40 shadow-soft" style={{ background: hex }} />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Accent colors</p>
            <div className="grid grid-cols-6 gap-1.5">
              {result.accents.map((hex) => (
                <div key={hex} className="aspect-square rounded-full border border-white/40 shadow-soft" style={{ background: hex }} />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Less harmonious for you</p>
            <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
              Not off-limits — armocromia is a guide, not a rule. These just need a bit more care: worn away from
              the face, mixed with a color that suits you, or as a shoe, bag, or pattern accent.
            </p>
            <div className="grid grid-cols-6 gap-1.5">
              {result.lessHarmonious.map((hex) => (
                <div key={hex} className="aspect-square rounded-full border border-white/40 shadow-soft" style={{ background: hex }} />
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-secondary/40 p-4 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Best metal</p>
            <p className="font-serif text-lg italic">{result.metal}</p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <button
              onClick={restart}
              className="h-12 rounded-full border border-border flex items-center justify-center gap-2 active:scale-[0.98] transition"
            >
              <RotateCcw size={14} />
              <span className="text-[10px] uppercase tracking-[0.3em]">Retake</span>
            </button>
            <button
              onClick={saveToProfile}
              disabled={saving}
              className="h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              <span className="text-[10px] uppercase tracking-[0.3em]">Save to profile</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
