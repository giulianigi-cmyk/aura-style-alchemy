import { useState } from "react";
import { ArrowRight } from "lucide-react";

const slides = [
  {
    eyebrow: "Step 01",
    title: "Your wardrobe,\nfinally seen.",
    body: "Photograph each piece. AURA catalogs fabric, color, season, and silhouette automatically.",
  },
  {
    eyebrow: "Step 02",
    title: "An editor,\nin your pocket.",
    body: "AI styling trained on decades of runway, street, and atelier moments. Always personal.",
  },
  {
    eyebrow: "Step 03",
    title: "Style with\nintention.",
    body: "Plan looks for any occasion, shop the gaps, and discover what truly suits you.",
  },
];

function Motif({ index }: { index: number }) {
  if (index === 0) {
    const tones = ["#F5EFE0", "#C19A6B", "#8A9A7B", "#22304A", "#6E1423"];
    return (
      <div className="relative h-60 w-60">
        {tones.map((t, i) => (
          <div
            key={t}
            className="absolute left-1/2 top-1/2 h-40 w-28 rounded-2xl border border-foreground/10 shadow-luxe"
            style={{
              background: t,
              transform: `translate(-50%,-60%) rotate(${(i - 2) * 14}deg)`,
              transformOrigin: "50% 130%",
            }}
          />
        ))}
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="relative h-60 w-60">
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
          return (
            <span
              key={i}
              className="absolute h-5 w-5 rounded-full"
              style={{
                left: `calc(50% + ${Math.cos(a) * 105}px - 10px)`,
                top: `calc(50% + ${Math.sin(a) * 105}px - 10px)`,
                background: `hsl(${i * 30} 45% 55%)`,
              }}
            />
          );
        })}
        <p className="absolute inset-0 flex items-center justify-center font-serif italic text-4xl text-foreground/70">
          aura
        </p>
      </div>
    );
  }
  return (
    <div className="relative h-60 w-60">
      <div className="absolute left-4 top-8 h-36 w-36 rounded-full mix-blend-multiply" style={{ background: "#EBD9B4" }} />
      <div className="absolute right-4 top-8 h-36 w-36 rounded-full mix-blend-multiply" style={{ background: "#D9B3A6" }} />
      <div className="absolute left-1/2 bottom-4 h-36 w-36 -translate-x-1/2 rounded-full mix-blend-multiply" style={{ background: "#BFAE9B" }} />
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const slide = slides[i];
  const last = i === slides.length - 1;

  return (
    <div className="relative h-full w-full flex flex-col">
      <div className="relative flex-1 overflow-hidden gradient-warm">
        <div className="absolute inset-0 grain opacity-40" />
        <div
          key={i}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[62%] animate-scale-in"
        >
          <Motif index={i} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent" />
        <button
          onClick={onDone}
          className="absolute top-12 right-6 text-[11px] uppercase tracking-[0.25em] text-foreground/70"
        >
          Skip
        </button>
      </div>

      <div className="px-8 pb-10 -mt-28 relative z-10">
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground animate-fade-up">{slide.eyebrow}</p>
        <h1 className="mt-3 font-serif text-[42px] leading-[1.05] text-foreground whitespace-pre-line animate-fade-up" style={{ animationDelay: "0.1s" }}>
          {slide.title}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground max-w-[280px] animate-fade-up" style={{ animationDelay: "0.2s" }}>
          {slide.body}
        </p>

        <div className="mt-8 flex items-center justify-between">
          <div className="flex gap-1.5">
            {slides.map((_, idx) => (
              <span key={idx} className={`h-1 rounded-full transition-all ${idx === i ? "w-8 bg-foreground" : "w-1 bg-foreground/25"}`} />
            ))}
          </div>
          <button
            onClick={() => (last ? onDone() : setI(i + 1))}
            className="group flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background transition-all active:scale-90 shadow-luxe"
          >
            <ArrowRight size={18} className="transition-transform group-active:translate-x-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
