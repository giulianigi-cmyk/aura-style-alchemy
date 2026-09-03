import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { Sparkles, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { LanguagePicker } from "./LanguagePicker";

type Mode = "signin" | "signup" | "forgot";

export function Auth() {
  const { t } = useTranslation();
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  // The language picker is shown exactly once, the moment someone taps
  // "New to AURA? Create account" for the first time — not on every app
  // open (that was the earlier, buggy placement: a standalone pre-splash
  // screen re-triggered on every launch whenever the persisted flag
  // didn't stick). Tied directly to account creation instead, and
  // skipped entirely if the flag is already set (e.g. reinstalling the
  // app after already picking a language once).
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const languageAlreadyChosen = typeof window !== "undefined" && localStorage.getItem("aura.language_chosen") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const reset = () => { setError(null); setInfo(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    reset(); setLoading(true);
    if (mode === "forgot") {
      const { error } = await resetPassword(email);
      setLoading(false);
      if (error) setError(error);
      else setInfo(t("auth.checkInboxReset"));
      return;
    }
    const fn = mode === "signin" ? signIn : signUp;
    const { error } = await fn(email, password);
    setLoading(false);
    if (error) setError(error);
    else if (mode === "signup") setInfo(t("auth.checkEmailConfirm"));
  };

  const title =
    mode === "signin" ? t("auth.welcomeBack") :
    mode === "signup" ? t("auth.beginYourEdit") :
    t("auth.resetYourPassword");
  const subtitle =
    mode === "signin" ? t("auth.wardrobeIsWaiting") :
    mode === "signup" ? t("auth.createAccountSubtitle") :
    t("auth.emailRecoveryLink");

  return (
    <div className="h-full w-full flex flex-col px-8 pt-20 pb-10 bg-background">
      <div className="flex-1 flex flex-col justify-center animate-fade-up">
        <div className="flex items-center gap-2 mb-6">
          {mode === "forgot" ? (
            <button onClick={() => { setMode("signin"); reset(); }} className="flex items-center gap-2 text-muted-foreground">
              <ArrowLeft size={14} />
              <span className="text-[10px] uppercase tracking-[0.4em]">{t("auth.back")}</span>
            </button>
          ) : (
            <>
              <Sparkles size={14} />
              <span className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">AURA</span>
            </>
          )}
        </div>
        <h1 className="font-serif text-4xl italic leading-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("auth.email")}</label>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="mt-1 w-full bg-transparent border-b border-border py-2 outline-none focus:border-foreground transition"
            />
          </div>
          {mode !== "forgot" && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("auth.password")}</label>
                {mode === "signin" && (
                  <button type="button" onClick={() => { setMode("forgot"); reset(); }}
                    className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground hover:text-foreground transition">
                    {t("auth.forgot")}
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"} required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                  className="mt-1 w-full bg-transparent border-b border-border py-2 pr-8 outline-none focus:border-foreground transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? t("auth.hidePasswordAria") : t("auth.showPasswordAria")}
                  className="absolute right-0 top-2.5 text-muted-foreground active:scale-90"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-700">{error}</p>}
          {info && <p className="text-xs text-muted-foreground">{info}</p>}

          <button
            type="submit" disabled={loading}
            className="mt-4 w-full h-14 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs disabled:opacity-50 active:scale-[0.98] transition shadow-luxe"
          >
            {loading ? "…" :
              mode === "signin" ? t("auth.signIn") :
              mode === "signup" ? t("auth.createAccount") :
              t("auth.sendResetLink")}
          </button>
        </form>

        {mode !== "forgot" && (
          <button
            onClick={() => {
              const goingToSignup = mode === "signin";
              setMode(goingToSignup ? "signup" : "signin");
              reset();
              if (goingToSignup && !languageAlreadyChosen) setShowLanguagePicker(true);
            }}
            className="mt-6 text-xs text-muted-foreground tracking-wide"
          >
            {mode === "signin" ? t("auth.newToAura") : t("auth.alreadyMember")}
          </button>
        )}
      </div>
      {showLanguagePicker && (
        <div className="fixed inset-0 z-[100]">
          <LanguagePicker onDone={() => setShowLanguagePicker(false)} />
        </div>
      )}
    </div>
  );
}
