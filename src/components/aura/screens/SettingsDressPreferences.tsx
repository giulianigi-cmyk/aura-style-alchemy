import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { DressPreferencesSection } from "../DressPreferencesSection";

export function SettingsDressPreferences({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("settings")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("settings.dressPreferences")}</p>
        <span className="w-10" />
      </header>
      <DressPreferencesSection userId={user?.id} />
    </div>
  );
}
