import { Home, Shirt, Sparkles, Calendar, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Screen } from "./AuraApp";

const tabs: { id: Screen; labelKey: string; Icon: typeof Home }[] = [
  { id: "home", labelKey: "tabBar.home", Icon: Home },
  { id: "wardrobe", labelKey: "tabBar.closet", Icon: Shirt },
  { id: "ai", labelKey: "tabBar.stylist", Icon: Sparkles },
  { id: "planner", labelKey: "tabBar.calendar", Icon: Calendar },
  { id: "profile", labelKey: "tabBar.you", Icon: User },
];

export function TabBar({ current, go }: { current: Screen; go: (s: Screen) => void }) {
  const { t } = useTranslation();
  return (
    <nav className="absolute bottom-0 left-0 right-0 z-40 glass border-t border-border/60">
      <ul className="flex items-end justify-around px-2 pt-2 pb-5">
        {tabs.map(({ id, labelKey, Icon }) => {
          const active = current === id;
          return (
            <li key={id}>
              <button
                onClick={() => go(id)}
                className="flex flex-col items-center gap-1 px-3 py-1.5 transition-all active:scale-90"
              >
                <Icon
                  size={20}
                  strokeWidth={active ? 2 : 1.4}
                  className={active ? "text-foreground" : "text-muted-foreground"}
                />
                <span className={`text-[10px] tracking-wider ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {t(labelKey)}
                </span>
                {active && <span className="h-1 w-1 rounded-full bg-foreground -mt-0.5" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
