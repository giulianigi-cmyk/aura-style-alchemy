import { Heart, Sparkles } from "lucide-react";
import type { Screen } from "../AuraApp";
import item1 from "@/assets/item-1.jpg";
import item2 from "@/assets/item-2.jpg";
import item3 from "@/assets/item-3.jpg";
import item5 from "@/assets/item-5.jpg";
import item6 from "@/assets/item-6.jpg";
import hero2 from "@/assets/hero-2.jpg";

const products = [
  { img: item3, brand: "Toteme", name: "Cotton trench", price: "€890" },
  { img: item2, brand: "Khaite", name: "Silk slip dress", price: "€1,240" },
  { img: item5, brand: "Studio Nicholson", name: "Satin midi", price: "€520" },
  { img: item6, brand: "Mansur Gavriel", name: "Ankle boot", price: "€680" },
  { img: item1, brand: "The Row", name: "Cashmere knit", price: "€1,090" },
];

export function Shop({ go: _go }: { go: (s: Screen) => void }) {
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">The edit</p>
        <h1 className="font-serif text-4xl mt-1">Pieces to complete <span className="italic">your story</span></h1>
      </header>

      {/* Hero recommendation */}
      <section className="px-6 mt-6">
        <div className="relative rounded-[2rem] overflow-hidden shadow-luxe">
          <img src={hero2} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent" />
          <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full glass px-3 py-1.5">
            <Sparkles size={11} />
            <span className="text-[10px] uppercase tracking-widest">Your wardrobe is missing</span>
          </div>
          <div className="absolute bottom-5 left-5 right-5 text-warm-white">
            <p className="font-serif text-2xl italic">A camel cashmere coat</p>
            <p className="text-[11px] opacity-80 mt-1">Would pair with 23 pieces you own</p>
          </div>
        </div>
      </section>

      {/* Filters */}
      <div className="mt-7 flex gap-2 overflow-x-auto no-scrollbar px-6">
        {["For you", "Outerwear", "Knitwear", "Bags", "New in", "Under €500"].map((c, i) => (
          <button key={c} className={`shrink-0 rounded-full px-4 py-2 text-xs tracking-wide transition ${i === 0 ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}>
            {c}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <section className="px-6 mt-5 grid grid-cols-2 gap-3">
        {products.map((p, i) => (
          <div key={i} className="animate-fade-up" style={{ animationDelay: `${i * 0.05}s` }}>
            <div className="relative overflow-hidden rounded-2xl bg-secondary/40 shadow-soft">
              <img src={p.img} alt={p.name} className="aspect-[3/4] w-full object-cover" loading="lazy" />
              <button className="absolute top-2.5 right-2.5 h-8 w-8 rounded-full glass flex items-center justify-center active:scale-90">
                <Heart size={12} />
              </button>
              <div className="absolute bottom-2 left-2 rounded-full bg-[var(--champagne)]/90 backdrop-blur px-2 py-0.5">
                <span className="text-[9px] uppercase tracking-widest">98% match</span>
              </div>
            </div>
            <div className="mt-2 px-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{p.brand}</p>
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-serif text-sm leading-tight truncate">{p.name}</p>
                <p className="text-xs">{p.price}</p>
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
