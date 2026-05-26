import { Plus, Filter, Search } from "lucide-react";
import type { Screen } from "../AuraApp";
import item1 from "@/assets/item-1.jpg";
import item2 from "@/assets/item-2.jpg";
import item3 from "@/assets/item-3.jpg";
import item4 from "@/assets/item-4.jpg";
import item5 from "@/assets/item-5.jpg";
import item6 from "@/assets/item-6.jpg";

const categories = ["All", "Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags"];

const items = [
  { img: item1, name: "Cashmere knit", brand: "The Row", tall: true },
  { img: item3, name: "Trench coat", brand: "Toteme" },
  { img: item2, name: "Silk slip", brand: "Khaite", tall: true },
  { img: item5, name: "Satin skirt", brand: "Studio Nicholson" },
  { img: item4, name: "Wool trouser", brand: "Lemaire" },
  { img: item6, name: "Leather boot", brand: "Mansur Gavriel", tall: true },
];

export function Wardrobe({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">184 pieces</p>
          <h1 className="font-serif text-4xl mt-1">Your closet</h1>
        </div>
        <button
          onClick={() => go("add")}
          className="h-12 w-12 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90 transition shadow-luxe"
        >
          <Plus size={20} />
        </button>
      </header>

      {/* Search */}
      <div className="mx-6 mt-5 flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
        <Search size={15} className="text-muted-foreground" />
        <input
          placeholder="Search by color, fabric, brand…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
        />
        <Filter size={15} className="text-muted-foreground" />
      </div>

      {/* Category pills */}
      <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar px-6">
        {categories.map((c, i) => (
          <button
            key={c}
            className={`shrink-0 rounded-full px-4 py-2 text-xs tracking-wide transition ${
              i === 0 ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Masonry-ish grid */}
      <div className="px-6 mt-6 grid grid-cols-2 gap-3">
        {items.map((it, i) => (
          <div
            key={i}
            className="group animate-fade-up"
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <div className="overflow-hidden rounded-2xl bg-secondary/40 shadow-soft">
              <img
                src={it.img}
                alt={it.name}
                className={`w-full object-cover transition-transform duration-500 group-active:scale-95 ${it.tall ? "aspect-[3/4]" : "aspect-square"}`}
                loading="lazy"
              />
            </div>
            <div className="px-1 mt-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{it.brand}</p>
              <p className="font-serif text-base leading-tight">{it.name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
