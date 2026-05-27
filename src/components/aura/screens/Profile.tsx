import { Settings, Share2, ChevronRight, LogOut } from "lucide-react";
import type { Screen } from "../AuraApp";
import profile1 from "@/assets/profile-1.jpg";
import { useAuth } from "@/hooks/use-auth";

const seasonPalette = [
  { name: "Cream", hex: "#f5ead6" },
  { name: "Champagne", hex: "#d9bf94" },
  { name: "Camel", hex: "#b59169" },
  { name: "Taupe", hex: "#8a6f5a" },
  { name: "Cocoa", hex: "#4d3b2c" },
  { name: "Ivory", hex: "#ece3d2" },
];

const avoid = [
  { name: "Cool fuchsia", hex: "#c41e7a" },
  { name: "Icy blue", hex: "#a8d0e6" },
  { name: "Pure white", hex: "#ffffff" },
];

export function Profile({ go: _go }: { go: (s: Screen) => void }) {
  const { user, signOut } = useAuth();
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"><Share2 size={15} /></button>
        <p className="font-serif text-lg italic">Profile</p>
        <button className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"><Settings size={15} /></button>
      </header>

      {/* Identity */}
      <section className="mt-4 flex flex-col items-center text-center px-6">
        <div className="h-24 w-24 rounded-full p-[3px] bg-gradient-to-br from-[var(--champagne)] to-[var(--taupe)] animate-scale-in">
          <img src={profile1} alt="" className="h-full w-full rounded-full object-cover border-2 border-background" />
        </div>
        <h1 className="font-serif text-3xl mt-3">Elise Moreau</h1>
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-1">Paris · Warm Autumn</p>
        <div className="mt-4 flex gap-8">
          {[
            { n: "184", l: "Pieces" },
            { n: "47", l: "Looks" },
            { n: "1.2k", l: "Followers" },
          ].map(s => (
            <div key={s.l} className="text-center">
              <p className="font-serif text-xl">{s.n}</p>
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Color analysis */}
      <section className="mx-6 mt-8 rounded-3xl gradient-warm border border-border/60 p-6 shadow-soft animate-fade-up">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Color analysis</p>
            <h2 className="font-serif text-3xl italic mt-1">Warm Autumn</h2>
          </div>
          <button className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            Retake <ChevronRight size={12} />
          </button>
        </div>
        <p className="text-xs leading-relaxed text-foreground/70 mt-3">
          Your complexion glows with rich, earth-toned hues. Lean into golden undertones and avoid icy or jewel-cool shades.
        </p>

        <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Your palette</p>
        <div className="mt-2 grid grid-cols-6 gap-1.5">
          {seasonPalette.map(c => (
            <div key={c.name} className="flex flex-col items-center gap-1">
              <div className="h-10 w-10 rounded-full shadow-soft border border-white/40" style={{ background: c.hex }} />
              <span className="text-[8px] tracking-wider text-muted-foreground">{c.name}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Best avoided</p>
        <div className="mt-2 flex gap-2">
          {avoid.map(c => (
            <div key={c.name} className="flex items-center gap-1.5 rounded-full bg-background/60 px-2 py-1">
              <div className="h-3 w-3 rounded-full" style={{ background: c.hex }} />
              <span className="text-[10px] text-muted-foreground">{c.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Menu */}
      <section className="px-6 mt-6 divide-y divide-border/60 rounded-2xl bg-card border border-border/60 overflow-hidden">
        {[
          "Style preferences",
          "Wardrobe insights",
          "Saved outfits",
          "Sustainability score",
          "Invite friends",
        ].map(l => (
          <button key={l} className="w-full flex items-center justify-between px-5 py-4 active:bg-secondary/40 transition">
            <span className="text-sm">{l}</span>
            <ChevronRight size={14} className="text-muted-foreground" />
          </button>
        ))}
      </section>

      <div className="px-6 mt-6">
        <p className="text-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">{user?.email}</p>
        <button
          onClick={signOut}
          className="w-full h-12 rounded-full border border-border flex items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] active:scale-[0.98]"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <p className="text-center mt-8 text-[9px] uppercase tracking-[0.4em] text-muted-foreground">aura · v 1.0</p>
    </div>
  );
}
