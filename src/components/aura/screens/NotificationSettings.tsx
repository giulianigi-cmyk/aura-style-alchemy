import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useProfile } from "@/hooks/use-profile";

type Prefs = { outfit_share: boolean; weather_change: boolean; system: boolean };
const DEFAULTS: Prefs = { outfit_share: true, weather_change: true, system: true };

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch" aria-checked={on} onClick={onClick}
      className={`h-6 w-10 shrink-0 rounded-full transition ${on ? "bg-foreground" : "bg-border"}`}
    >
      <span className={`block h-5 w-5 mt-0.5 rounded-full bg-background transition-transform ${on ? "translate-x-[1.15rem]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function NotificationSettings({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const { profile, update } = useProfile();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setPrefs({ ...DEFAULTS, ...(profile.notification_preferences ?? {}) });
  }, [profile]);

  const setPref = async (key: keyof Prefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    const { error } = await update({ notification_preferences: next });
    setSaving(false);
    if (error) { toast.error(error); setPrefs(prefs); }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("settings")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("settings.notifications")}</p>
        <span className="w-10" />
      </header>

      <p className="mx-6 mt-4 text-[11px] text-muted-foreground leading-relaxed">{t("settings.notificationsIntro")}</p>

      <div className="mx-6 mt-4 rounded-[20px] bg-card border border-border overflow-hidden divide-y divide-border">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="min-w-0 pr-3">
            <p className="text-sm">{t("settings.notifOutfitShare")}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("settings.notifOutfitShareSub")}</p>
          </div>
          <Toggle on={prefs.outfit_share} onClick={() => void setPref("outfit_share", !prefs.outfit_share)} />
        </div>
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="min-w-0 pr-3">
            <p className="text-sm">{t("settings.notifWeatherChange")}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("settings.notifWeatherChangeSub")}</p>
          </div>
          <Toggle on={prefs.weather_change} onClick={() => void setPref("weather_change", !prefs.weather_change)} />
        </div>
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="min-w-0 pr-3">
            <p className="text-sm">{t("settings.notifSystem")}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("settings.notifSystemSub")}</p>
          </div>
          <Toggle on={prefs.system} onClick={() => void setPref("system", !prefs.system)} />
        </div>
      </div>
    </div>
  );
}
