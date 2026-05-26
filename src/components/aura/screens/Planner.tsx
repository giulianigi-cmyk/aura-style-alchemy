import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Screen } from "../AuraApp";
import outfit1 from "@/assets/outfit-1.jpg";
import outfit2 from "@/assets/outfit-2.jpg";
import outfit3 from "@/assets/outfit-3.jpg";

const days = ["M", "T", "W", "T", "F", "S", "S"];
const dates = [25, 26, 27, 28, 29, 30, 31];
const planned: Record<number, { img: string; label: string; sub: string }> = {
  26: { img: outfit1, label: "Today", sub: "Office · client lunch" },
  28: { img: outfit2, label: "Thursday", sub: "Dinner · Le Comptoir" },
  30: { img: outfit3, label: "Saturday", sub: "Weekend · gallery" },
};

export function Planner({ go: _go }: { go: (s: Screen) => void }) {
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">May 2026</p>
        <div className="flex items-center justify-between mt-1">
          <h1 className="font-serif text-4xl">Your week</h1>
          <div className="flex gap-1">
            <button className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90"><ChevronLeft size={16} /></button>
            <button className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90"><ChevronRight size={16} /></button>
          </div>
        </div>
      </header>

      {/* Week strip */}
      <div className="px-4 mt-4 grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const date = dates[i];
          const isToday = date === 26;
          const hasPlan = !!planned[date];
          return (
            <button
              key={i}
              className={`flex flex-col items-center py-3 rounded-2xl transition active:scale-95 ${
                isToday ? "bg-foreground text-background" : "bg-transparent"
              }`}
            >
              <span className="text-[10px] uppercase tracking-widest opacity-70">{d}</span>
              <span className="font-serif text-xl mt-1">{date}</span>
              {hasPlan && <span className={`mt-1 h-1 w-1 rounded-full ${isToday ? "bg-[var(--champagne)]" : "bg-foreground"}`} />}
            </button>
          );
        })}
      </div>

      {/* Planned looks */}
      <section className="px-6 mt-8 space-y-5">
        {Object.entries(planned).map(([date, p], i) => (
          <div
            key={date}
            className="flex gap-4 animate-fade-up"
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <div className="flex flex-col items-center pt-2 w-10 shrink-0">
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{p.label.slice(0,3)}</p>
              <p className="font-serif text-2xl">{date}</p>
            </div>
            <div className="flex-1 flex gap-3 rounded-2xl bg-card border border-border/60 p-3 shadow-soft">
              <div className="h-28 w-24 rounded-xl overflow-hidden shrink-0">
                <img src={p.img} alt="" className="h-full w-full object-cover" loading="lazy" />
              </div>
              <div className="flex-1 flex flex-col justify-between py-1">
                <div>
                  <p className="font-serif text-lg leading-tight">{p.label}'s look</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{p.sub}</p>
                </div>
                <div className="flex gap-1">
                  {["beige", "cream", "gold"].map(c => (
                    <span key={c} className="text-[9px] uppercase tracking-widest rounded-full bg-secondary/60 px-2 py-0.5">{c}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Empty slot */}
        <div className="flex gap-4">
          <div className="flex flex-col items-center pt-2 w-10 shrink-0">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Fri</p>
            <p className="font-serif text-2xl text-muted-foreground">29</p>
          </div>
          <button className="flex-1 h-24 rounded-2xl border border-dashed border-border flex items-center justify-center gap-2 text-muted-foreground active:scale-[0.98] transition">
            <Plus size={14} />
            <span className="text-[10px] uppercase tracking-[0.3em]">Plan a look</span>
          </button>
        </div>
      </section>
    </div>
  );
}
