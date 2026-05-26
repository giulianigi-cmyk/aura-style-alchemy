export function Splash() {
  return (
    <div className="relative h-full w-full overflow-hidden gradient-warm">
      <div className="absolute inset-0 grain opacity-40" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="animate-scale-in">
          <p className="font-serif text-[88px] leading-none italic text-foreground tracking-tight">
            aura
          </p>
          <div className="mx-auto mt-4 h-px w-16 bg-foreground/30" />
          <p className="mt-4 text-[10px] uppercase tracking-[0.45em] text-muted-foreground">
            Wardrobe Intelligence
          </p>
        </div>
      </div>
      <div className="absolute bottom-10 left-0 right-0 text-center animate-fade-in" style={{ animationDelay: "1s" }}>
        <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground/70">
          est. 2026 · paris
        </p>
      </div>
    </div>
  );
}
