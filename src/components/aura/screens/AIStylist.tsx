import { Sparkles, Heart, Share2, RotateCw, Bookmark } from "lucide-react";
import { useState } from "react";
import type { Screen } from "../AuraApp";
import outfit1 from "@/assets/outfit-1.jpg";
import outfit2 from "@/assets/outfit-2.jpg";
import outfit3 from "@/assets/outfit-3.jpg";
import item1 from "@/assets/item-1.jpg";
import item4 from "@/assets/item-4.jpg";
import item6 from "@/assets/item-6.jpg";

const occasions = ["Office", "Dinner", "Weekend", "Travel", "Event", "Date"];
const moods = ["Quiet luxury", "Editorial", "Soft", "Polished", "Effortless"];

const outfits = [outfit1, outfit2, outfit3];

export function AIStylist({ go: _go }: { go: (s: Screen) => void }) {
  const [occ, setOcc] = useState("Office");
  const [mood, setMood] = useState("Quiet luxury");
  const [i, setI] = useState(0);

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--accent)]" />
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">AI Stylist</p>
        </div>
        <h1 className="font-serif text-4xl mt-2 leading-tight">
          What shall <span className="italic">you</span> wear?
        </h1>
      </header>

      {/* Occasion */}
      <section className="mt-6">
        <p className="px-6 text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Occasion</p>
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-6">
          {occasions.map(o => (
            <button
              key={o}
              onClick={() => setOcc(o)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs tracking-wide transition ${
                occ === o ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </section>

      {/* Mood */}
      <section className="mt-5">
        <p className="px-6 text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Mood</p>
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-6">
          {moods.map(o => (
            <button
              key={o}
              onClick={() => setMood(o)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs tracking-wide transition ${
                mood === o ? "bg-[var(--champagne)] text-foreground" : "bg-secondary/60 text-foreground/70"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </section>

      {/* Generated outfit card */}
      <section className="px-6 mt-8">
        <div className="relative overflow-hidden rounded-[2rem] shadow-luxe animate-scale-in" key={i}>
          <img src={outfits[i]} alt="Generated outfit" className="aspect-[3/4] w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full glass px-3 py-1.5">
            <Sparkles size={11} />
            <span className="text-[10px] uppercase tracking-widest">Match 97%</span>
          </div>
          <div className="absolute top-4 right-4 flex gap-2">
            <button className="h-9 w-9 rounded-full glass flex items-center justify-center active:scale-90"><Bookmark size={14} /></button>
            <button className="h-9 w-9 rounded-full glass flex items-center justify-center active:scale-90"><Share2 size={14} /></button>
          </div>
          <div className="absolute bottom-5 left-5 right-5 text-warm-white">
            <p className="text-[10px] uppercase tracking-[0.3em] opacity-80">{occ} · {mood}</p>
            <p className="font-serif text-2xl mt-1 italic">The tailored neutral</p>
          </div>
        </div>

        {/* Pieces in this look */}
        <p className="mt-6 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">3 pieces in this look</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[item1, item4, item6].map((s, idx) => (
            <div key={idx} className="rounded-xl overflow-hidden aspect-square bg-secondary/40">
              <img src={s} alt="" className="h-full w-full object-cover" loading="lazy" />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setI((i + 1) % outfits.length)}
            className="flex-1 h-14 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe"
          >
            <RotateCw size={14} />
            <span className="text-xs uppercase tracking-[0.3em]">Regenerate</span>
          </button>
          <button className="h-14 w-14 rounded-full border border-border flex items-center justify-center active:scale-90">
            <Heart size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
