import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function ResetPassword({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { updatePassword, clearRecovery } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError(t("resetPassword.errTooShort")); return; }
    if (password !== confirm) { setError(t("resetPassword.errMismatch")); return; }
    setLoading(true);
    const { error } = await updatePassword(password);
    setLoading(false);
    if (error) { setError(error); return; }
    setSuccess(true);
    setTimeout(() => {
      clearRecovery();
      onDone();
    }, 1400);
  };

  return (
    <div className="h-full w-full flex flex-col px-8 pt-20 pb-10 bg-background">
      <div className="flex-1 flex flex-col justify-center animate-fade-up">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles size={14} />
          <span className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">AURA</span>
        </div>
        <h1 className="font-serif text-4xl italic leading-tight">{t("resetPassword.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("resetPassword.subtitle")}
        </p>

        {success ? (
          <div className="mt-10 flex flex-col items-center text-center animate-fade-up">
            <div className="h-14 w-14 rounded-full bg-foreground text-background flex items-center justify-center">
              <Check size={20} />
            </div>
            <p className="mt-4 font-serif text-xl italic">{t("resetPassword.updated")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("resetPassword.takingYouHome")}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("resetPassword.newPassword")}</label>
              <input
                type="password" required minLength={6} value={password}
                onChange={e => setPassword(e.target.value)}
                className="mt-1 w-full bg-transparent border-b border-border py-2 outline-none focus:border-foreground transition"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("resetPassword.confirmPassword")}</label>
              <input
                type="password" required minLength={6} value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="mt-1 w-full bg-transparent border-b border-border py-2 outline-none focus:border-foreground transition"
              />
            </div>

            {error && <p className="text-xs text-red-700">{error}</p>}

            <button
              type="submit" disabled={loading}
              className="mt-4 w-full h-14 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs disabled:opacity-50 active:scale-[0.98] transition shadow-luxe flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : t("resetPassword.updateButton")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
