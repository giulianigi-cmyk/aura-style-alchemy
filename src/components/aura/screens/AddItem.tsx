import { X, Camera, Image as ImageIcon, Sparkles, Check } from "lucide-react";
import { useState } from "react";
import item1 from "@/assets/item-1.jpg";

export function AddItem({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"capture" | "details">("capture");

  return (
    <div className="absolute inset-0 z-50 bg-background animate-slide-up flex flex-col">
      <header className="flex items-center justify-between px-6 pt-14 pb-3">
        <button onClick={onClose} className="h-10 w-10 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90">
          <X size={18} />
        </button>
        <p className="font-serif text-lg italic">Add a piece</p>
        <div className="w-10" />
      </header>

      {step === "capture" ? (
        <div className="flex-1 flex flex-col px-6 pb-10">
          {/* Camera viewfinder */}
          <div className="relative flex-1 rounded-[2rem] overflow-hidden bg-gradient-to-br from-[oklch(0.35_0.02_60)] to-[oklch(0.18_0.012_60)] mb-6">
            <div className="absolute inset-0 grain opacity-30" />
            <div className="absolute inset-8 border border-white/20 rounded-2xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-white/60">
              <Sparkles size={28} className="mx-auto animate-float" />
              <p className="mt-3 text-[10px] uppercase tracking-[0.35em]">Center the garment</p>
              <p className="text-[10px] uppercase tracking-[0.35em] mt-1 opacity-60">background will auto-remove</p>
            </div>
            <div className="absolute bottom-5 left-0 right-0 flex items-center justify-around">
              <button className="text-white/70"><ImageIcon size={22} /></button>
              <button
                onClick={() => setStep("details")}
                className="h-18 w-18 rounded-full border-4 border-white p-1 active:scale-90 transition"
              >
                <div className="h-14 w-14 rounded-full bg-white" />
              </button>
              <button className="text-white/70 text-[10px] uppercase tracking-widest">Flip</button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { Icon: Camera, l: "Photo" },
              { Icon: ImageIcon, l: "Library" },
              { Icon: Sparkles, l: "URL import" },
            ].map((o, i) => (
              <button key={i} className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition">
                <o.Icon size={16} />
                <span className="text-[10px] uppercase tracking-widest">{o.l}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-10 animate-fade-in">
          <div className="rounded-2xl overflow-hidden bg-secondary/40 aspect-[4/5]">
            <img src={item1} alt="" className="h-full w-full object-cover" />
          </div>

          <div className="mt-6 flex items-center gap-2 rounded-full bg-[var(--champagne)]/20 border border-[var(--champagne)]/40 px-3.5 py-2 w-fit">
            <Sparkles size={12} />
            <span className="text-[10px] uppercase tracking-widest">AI detected</span>
          </div>

          <div className="mt-5 space-y-4">
            {[
              { l: "Name", v: "Ribbed cashmere knit" },
              { l: "Brand", v: "The Row" },
              { l: "Color", v: "Cream · warm undertone" },
              { l: "Category", v: "Tops · Knitwear" },
              { l: "Season", v: "Autumn · Winter" },
              { l: "Material", v: "100% cashmere" },
            ].map(f => (
              <div key={f.l} className="border-b border-border/60 pb-3">
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{f.l}</p>
                <p className="font-serif text-lg mt-0.5">{f.v}</p>
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            className="mt-8 w-full h-14 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe"
          >
            <Check size={16} />
            <span className="text-xs uppercase tracking-[0.3em]">Save to closet</span>
          </button>
        </div>
      )}
    </div>
  );
}
