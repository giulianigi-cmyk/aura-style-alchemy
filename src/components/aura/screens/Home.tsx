import { Bell, Search, Sparkles, TrendingUp, Cloud } from "lucide-react";
import type { Screen } from "../AuraApp";
import outfit1 from "@/assets/outfit-1.jpg";
import outfit2 from "@/assets/outfit-2.jpg";
import outfit3 from "@/assets/outfit-3.jpg";
import item1 from "@/assets/item-1.jpg";
import item3 from "@/assets/item-3.jpg";
import item5 from "@/assets/item-5.jpg";

export function Home({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      {/* Header */}
      <header className="px-6 pt-14 pb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Tuesday, May 26</p>
          <h1 className="font-serif text-3xl mt-1">Good morning, Elise</h1>
        </div>
        <div className="flex gap-2">
          <button className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-95 transition">
            <Search size={16} />
          </button>
          <button className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-95 transition relative">
            <Bell size={16} />
            <span className="absolute top-2 right-2.5 h-1.5 w-1.5 rounded-full bg-[var(--champagne)]" />
          </button>
        </div>
      </header>

      {/* Weather strip */}
      <div className="mx-6 mt-2 flex items-center justify-between rounded-2xl bg-secondary/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <Cloud size={18} className="text-muted-foreground" />
          <div>
            <p className="text-sm">Paris · 18°</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">light breeze · cashmere weather</p>
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">7d</span>
      </div>

      {/* Outfit of the day - hero */}
      <section className="px-6 mt-8 animate-fade-up">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-serif text-2xl italic">Today's edit</h2>
          <button onClick={() => go("ai")} className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Regenerate</button>
        </div>
        <button onClick={() => go("ai")} className="block w-full text-left">
          <div className="relative overflow-hidden rounded-[2rem] shadow-luxe">
            <img src={outfit1} alt="Today's outfit" className="aspect-[4/5] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full glass px-3 py-1.5">
              <Sparkles size={11} />
              <span className="text-[10px] uppercase tracking-widest">AI styled</span>
            </div>
            <div className="absolute bottom-5 left-5 right-5 text-warm-white">
              <p className="text-[10px] uppercase tracking-[0.3em] opacity-80">For the day ahead</p>
              <p className="font-serif text-2xl mt-1">Quiet luxury, soft tailoring</p>
              <div className="mt-3 flex gap-1.5">
                {["beige", "cream", "taupe"].map(c => (
                  <span key={c} className="text-[10px] uppercase tracking-widest rounded-full bg-white/15 backdrop-blur px-2.5 py-0.5">{c}</span>
                ))}
              </div>
            </div>
          </div>
        </button>
      </section>

      {/* Quick nav */}
      <section className="px-6 mt-7 grid grid-cols-2 gap-3">
        <button onClick={() => go("shop")} className="text-left rounded-2xl bg-[var(--champagne)]/30 border border-[var(--champagne)]/50 p-4 active:scale-[0.98] transition">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">The edit</p>
          <p className="font-serif text-lg mt-1">Shop your gaps</p>
        </button>
        <button onClick={() => go("community")} className="text-left rounded-2xl bg-secondary/60 p-4 active:scale-[0.98] transition">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Atelier</p>
          <p className="font-serif text-lg mt-1">Community</p>
        </button>
      </section>

      {/* Stats */}
      <section className="px-6 mt-5 grid grid-cols-3 gap-3">
        {[
          { n: "184", l: "Pieces" },
          { n: "47", l: "Outfits" },
          { n: "92%", l: "Wear rate" },
        ].map(s => (
          <div key={s.l} className="rounded-2xl bg-card border border-border/60 p-4">
            <p className="font-serif text-3xl">{s.n}</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{s.l}</p>
          </div>
        ))}
      </section>

      {/* Suggested for you */}
      <section className="mt-10 animate-fade-up" style={{ animationDelay: "0.1s" }}>
        <div className="flex items-baseline justify-between px-6 mb-3">
          <h2 className="font-serif text-2xl italic">Curated for you</h2>
          <button onClick={() => go("wardrobe")} className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">See all</button>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar px-6">
          {[
            { img: outfit2, t: "Evening" },
            { img: outfit3, t: "Office" },
            { img: outfit1, t: "Weekend" },
          ].map((c, i) => (
            <button key={i} className="shrink-0 w-44 text-left active:scale-[0.98] transition">
              <div className="overflow-hidden rounded-2xl shadow-soft">
                <img src={c.img} alt="" className="aspect-[3/4] w-full object-cover" loading="lazy" />
              </div>
              <p className="mt-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{c.t}</p>
              <p className="font-serif text-base">Look {i + 1}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Recently added */}
      <section className="px-6 mt-10 animate-fade-up" style={{ animationDelay: "0.15s" }}>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-serif text-2xl italic">Recently added</h2>
          <TrendingUp size={14} className="text-muted-foreground" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[item1, item3, item5].map((src, i) => (
            <div key={i} className="rounded-xl overflow-hidden bg-secondary/40 aspect-square">
              <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
