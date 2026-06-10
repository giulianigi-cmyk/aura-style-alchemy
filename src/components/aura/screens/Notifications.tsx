import { ArrowLeft, Bell } from "lucide-react";
import type { Screen } from "../AuraApp";

export function Notifications({ go }: { go: (s: Screen) => void }) {
  const items = [
    { t: "Welcome to AURA", b: "Start by adding a few wardrobe pieces.", time: "Just now" },
  ];
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("home")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">Notifications</p>
        <span className="w-10" />
      </header>

      <section className="mx-6 mt-6 divide-y divide-border/60 rounded-2xl bg-card border border-border/60 overflow-hidden animate-fade-up">
        {items.map((n, i) => (
          <div key={i} className="px-5 py-4 flex gap-3">
            <div className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center shrink-0">
              <Bell size={14} />
            </div>
            <div className="flex-1">
              <p className="text-sm">{n.t}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{n.b}</p>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-2">{n.time}</p>
            </div>
          </div>
        ))}
      </section>

      <p className="text-center mt-8 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">You're all caught up</p>
    </div>
  );
}
