import { useState } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useProfile } from "@/hooks/use-profile";
import i18n, { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, type SupportedLanguage } from "@/i18n/config";

export function SettingsLanguage({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const { profile, update } = useProfile();
  const [saving, setSaving] = useState<SupportedLanguage | null>(null);
  const current = (profile?.language as SupportedLanguage | null) ?? i18n.language;

  const choose = async (code: SupportedLanguage) => {
    if (code === current) return;
    setSaving(code);
    void i18n.changeLanguage(code);
    const { error } = await update({ language: code });
    setSaving(null);
    if (error) toast.error(error);
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("settings")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("settings.language")}</p>
        <span className="w-10" />
      </header>

      <section className="mx-6 mt-6 rounded-[20px] bg-card border border-border overflow-hidden divide-y divide-border">
        {SUPPORTED_LANGUAGES.map((code) => (
          <button
            key={code}
            onClick={() => choose(code)}
            disabled={saving !== null}
            className="w-full flex items-center justify-between px-4 py-3.5 text-left active:bg-secondary/40 transition disabled:opacity-60"
          >
            <span className="font-serif text-lg">{LANGUAGE_LABELS[code]}</span>
            {saving === code ? <Loader2 size={14} className="animate-spin" /> : current === code ? <Check size={16} /> : null}
          </button>
        ))}
      </section>
    </div>
  );
}
