import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import it from "./locales/it.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";

export const SUPPORTED_LANGUAGES = ["it", "en", "es", "fr"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Native-name labels for the language picker (Profile settings + onboarding
// step). These are intentionally NOT translated — a language switcher always
// shows each option in its own language ("Français", not "French"
// translated into whatever language is currently active), which is the
// standard pattern (Discord, Twitter/X, Duolingo, etc.).
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  it: "Italiano",
  en: "English",
  es: "Español",
  fr: "Français",
};

// Initialized once at module load, isomorphically (runs on both the SSR
// pass and the client). Default language is English on first paint if
// nothing else is known yet — this matches the app's existing hardcoded
// copy and avoids a server/client hydration mismatch. Once the user's
// profile loads client-side, callers (see Home.tsx) switch i18n to
// profile.language if the user has set one.
//
// Before that profile exists at all — someone who picked a language on
// the pre-auth LanguagePicker screen (see LanguagePicker.tsx) but hasn't
// finished signing up yet — there's nothing to read a preference FROM
// except localStorage, which is why that screen writes the same key
// this reads. Without this, closing the app mid-signup and reopening it
// would silently revert to English regardless of what was chosen.
function initialLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem("aura.language");
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
      return stored as SupportedLanguage;
    }
  } catch { /* private browsing or similar — fall through to default */ }
  return "en";
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      it: { translation: it },
      es: { translation: es },
      fr: { translation: fr },
    },
    lng: initialLanguage(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export default i18n;
