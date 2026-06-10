import { ArrowLeft, Heart, Sparkles } from "lucide-react";
import type { Screen } from "../AuraApp";

export function SavedOutfits({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("profile")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">Saved outfits</p>
        <span className="w-10" />
      </header>

      <section className="mx-6 mt-6 rounded-3xl bg-card border border-border/60 p-8 text-center shadow-soft animate-fade-up">
        <div className="mx-auto h-14 w-14 rounded-full bg-secondary/60 flex items-center justify-center mb-4">
          <Heart size={20} />
        </div>
        <h2 className="font-serif text-2xl italic">Your edits live here</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Save looks from the AI Stylist or build your own. They'll appear here as a beautifully curated gallery.
        </p>
        <button onClick={() => go("ai")} className="mt-6 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center gap-2">
          <Sparkles size={12} /> Open the Stylist
        </button>
      </section>
    </div>
  );
}
