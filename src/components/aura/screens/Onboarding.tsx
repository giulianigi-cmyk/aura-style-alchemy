import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

type Slide = { intro?: boolean; eyebrowKey?: string; titleKey?: string; bodyKey?: string };

const slides: Slide[] = [
  { intro: true },
  { eyebrowKey: "step01", titleKey: "title01", bodyKey: "body01" },
  { eyebrowKey: "step02", titleKey: "title02", bodyKey: "body02" },
  { eyebrowKey: "step03", titleKey: "title03", bodyKey: "body03" },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const slide = slides[i];
  const last = i === slides.length - 1;

  return (
    <div className="relative h-full w-full flex flex-col">
      <div className="relative flex-1 overflow-hidden gradient-warm">
        <div className="absolute inset-0 grain opacity-40" />
        {slide.intro && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center animate-scale-in">
            <p className="font-serif text-[96px] leading-none italic text-foreground/85 tracking-tight">
              aura
            </p>
            <div className="mx-auto mt-5 h-px w-16 bg-foreground/30" />
            <p className="mt-5 text-[10px] uppercase tracking-[0.45em] text-muted-foreground">
              {t("splash.tagline")}
            </p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent" />
        <button
          onClick={onDone}
          className="absolute top-12 right-6 text-[11px] uppercase tracking-[0.25em] text-foreground/70"
        >
          {t("onboarding.skip")}
        </button>
      </div>

      <div className="px-8 pb-10 relative z-10">
        <div className="min-h-[190px] flex flex-col justify-end">
          {!slide.intro && (
            <div key={i}>
              <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground animate-fade-up">{t(`onboarding.${slide.eyebrowKey}`)}</p>
              <h1 className="mt-3 font-serif text-[42px] leading-[1.05] text-foreground whitespace-pre-line animate-fade-up" style={{ animationDelay: "0.1s" }}>
                {t(`onboarding.${slide.titleKey}`)}
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground max-w-[280px] animate-fade-up" style={{ animationDelay: "0.2s" }}>
                {t(`onboarding.${slide.bodyKey}`)}
              </p>
            </div>
          )}
        </div>

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
