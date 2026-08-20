import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Screen } from "../AuraApp";
import { CalendarConnectionSection, AppleCalendarConnectionSection, OutlookCalendarConnectionSection } from "../CalendarConnectionSection";

export function SettingsCalendar({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("settings")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("settings.calendar")}</p>
        <span className="w-10" />
      </header>
      <CalendarConnectionSection />
      <AppleCalendarConnectionSection />
      <OutlookCalendarConnectionSection />
    </div>
  );
}
