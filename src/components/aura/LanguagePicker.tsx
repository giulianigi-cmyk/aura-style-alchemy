import i18n, { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, type SupportedLanguage } from "@/i18n/config";

/**
 * The very first screen, before Onboarding/Auth — deliberately has NO
 * translated copy at all beyond the language names themselves (each
 * shown in its own native form: "Italiano", "English", "Español",
 * "Français"). Everything downstream (onboarding slides, the sign-up
 * form) renders via i18next, which defaults to English until a language
 * is explicitly chosen — someone who doesn't read English couldn't get
 * past that default before this screen existed. Choosing a language
 * here switches i18n immediately AND persists the choice to
 * localStorage (not just React state), so a person who closes the app
 * mid-signup — before there's a profile row to store a preference on —
 * still sees their chosen language on the next launch instead of
 * silently reverting to English. See src/i18n/config.ts, which reads
 * this same key on init.
 */
export function LanguagePicker({ onDone }: { onDone: () => void }) {
  const choose = (code: SupportedLanguage) => {
    void i18n.changeLanguage(code);
    try {
      localStorage.setItem("aura.language", code);
      localStorage.setItem("aura.language_chosen", "1");
    } catch { /* private browsing or similar — the in-memory i18n change still applies for this session */ }
    onDone();
  };

  return (
    <div className="relative h-full w-full flex flex-col gradient-warm">
      <div className="absolute inset-0 grain opacity-40" />
      <div className="relative flex-1 flex flex-col items-center justify-center px-8">
        <p className="font-serif text-[64px] leading-none italic text-foreground/85 tracking-tight">aura</p>
        <div className="mx-auto mt-6 h-px w-16 bg-foreground/30" />
        <div className="mt-10 w-full max-w-xs space-y-3">
          {SUPPORTED_LANGUAGES.map((code) => (
            <button
              key={code}
              onClick={() => choose(code)}
              className="w-full h-14 rounded-full border border-foreground/20 bg-background/60 backdrop-blur flex items-center justify-center font-serif text-lg active:scale-[0.98] transition"
            >
              {LANGUAGE_LABELS[code]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
