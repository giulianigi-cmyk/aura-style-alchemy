import { Heart, MessageCircle, Bookmark, MoreHorizontal } from "lucide-react";
import type { Screen } from "../AuraApp";
import outfit1 from "@/assets/outfit-1.jpg";
import outfit2 from "@/assets/outfit-2.jpg";
import outfit3 from "@/assets/outfit-3.jpg";
import profile1 from "@/assets/profile-1.jpg";

const posts = [
  { img: outfit2, user: "amelie.k", handle: "Paris", caption: "Champagne silk for the dinner at Septime.", likes: "2.4k", tags: ["#quietluxury", "#evening"] },
  { img: outfit1, user: "noor.styles", handle: "Milan", caption: "Soft tailoring for the studio.", likes: "1.1k", tags: ["#minimal", "#tailoring"] },
  { img: outfit3, user: "isabelle", handle: "Copenhagen", caption: "Cream on cream, always.", likes: "892", tags: ["#wardrobestaple"] },
];

export function Community({ go: _go }: { go: (s: Screen) => void }) {
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">The atelier</p>
          <h1 className="font-serif text-4xl mt-1">Community</h1>
        </div>
      </header>

      {/* Story rail */}
      <div className="mt-3 flex gap-4 overflow-x-auto no-scrollbar px-6 pb-2">
        {[profile1, profile1, profile1, profile1, profile1].map((src, i) => (
          <button key={i} className="shrink-0 flex flex-col items-center gap-1.5">
            <div className="h-14 w-14 rounded-full p-[2px] bg-gradient-to-br from-[var(--champagne)] to-[var(--taupe)]">
              <div className="h-full w-full rounded-full bg-background p-[2px]">
                <img src={src} alt="" className="h-full w-full rounded-full object-cover" loading="lazy" />
              </div>
            </div>
            <span className="text-[10px] tracking-wide text-muted-foreground">user_{i+1}</span>
          </button>
        ))}
      </div>

      {/* Trending tags */}
      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar px-6">
        {["Following", "For you", "#quietluxury", "#minimal", "#tailoring", "#editorial"].map((c, i) => (
          <button key={c} className={`shrink-0 rounded-full px-4 py-2 text-xs transition ${i === 0 ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}>
            {c}
          </button>
        ))}
      </div>

      {/* Feed */}
      <section className="mt-6 space-y-8">
        {posts.map((p, i) => (
          <article key={i} className="animate-fade-up" style={{ animationDelay: `${i * 0.08}s` }}>
            <div className="px-6 flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <img src={profile1} alt="" className="h-9 w-9 rounded-full object-cover" loading="lazy" />
                <div>
                  <p className="text-sm font-medium">{p.user}</p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{p.handle}</p>
                </div>
              </div>
              <button className="text-muted-foreground"><MoreHorizontal size={16} /></button>
            </div>

            <div className="relative">
              <img src={p.img} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" />
            </div>

            <div className="px-6 mt-3 flex items-center gap-4">
              <button className="flex items-center gap-1.5 active:scale-90 transition"><Heart size={18} /><span className="text-xs">{p.likes}</span></button>
              <button className="flex items-center gap-1.5 active:scale-90 transition"><MessageCircle size={18} /><span className="text-xs">84</span></button>
              <button className="ml-auto active:scale-90 transition"><Bookmark size={18} /></button>
            </div>
            <p className="px-6 mt-2 text-sm leading-relaxed">
              <span className="font-medium">{p.user}</span> <span className="text-foreground/80">{p.caption}</span>
            </p>
            <div className="px-6 mt-1.5 flex gap-2">
              {p.tags.map(t => <span key={t} className="text-[10px] text-[var(--taupe)] tracking-wide">{t}</span>)}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
