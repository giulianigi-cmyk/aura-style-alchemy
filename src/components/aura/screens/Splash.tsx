import { useTranslation } from "react-i18next";
import type { Screen } from "../AuraApp";

export function Splash({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative h-full w-full overflow-hidden gradient-warm">
      <div className="absolute inset-0 grain opacity-40" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="animate-scale-in">
          <h1 className="font-serif text-[88px] leading-none italic text-foreground tracking-tight">
            aura
            <span className="sr-only"> — {t("splash.tagline")}</span>
          </h1>
          <div className="mx-auto mt-4 h-px w-16 bg-foreground/30" />
          <p className="mt-4 text-[10px] uppercase tracking-[0.45em] text-muted-foreground">
            {t("splash.tagline")}
          </p>
        </div>
      </div>

      {/* Descriptive summary + navigable actions for users and AI agents */}
      <section
        className="absolute bottom-24 left-0 right-0 px-8 text-center animate-fade-in"
        style={{ animationDelay: "0.6s" }}
        aria-label={t("splash.introAria")}
      >
        <p className="text-sm text-foreground/80 leading-relaxed max-w-xs mx-auto">
          {t("splash.description")}
        </p>
        <nav className="mt-5 flex flex-col items-center gap-2" aria-label={t("splash.getStartedAria")}>
          <button
            type="button"
            onClick={() => go("onboarding")}
            className="rounded-full bg-foreground text-background px-6 py-2.5 text-xs uppercase tracking-widest active:scale-95 transition"
          >
            {t("splash.getStarted")}
          </button>
          <button
            type="button"
            onClick={() => go("auth")}
            className="text-xs text-muted-foreground underline underline-offset-4 active:scale-95 transition"
          >
            {t("splash.signIn")}
          </button>
        </nav>
      </section>

      <div className="absolute bottom-10 left-0 right-0 text-center animate-fade-in" style={{ animationDelay: "1s" }}>
        <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/70">
          {t("splash.est")}
        </p>
      </div>
    </div>
  );
}
