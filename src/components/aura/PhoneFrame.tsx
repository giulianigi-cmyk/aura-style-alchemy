import { ReactNode } from "react";

export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-[oklch(0.93_0.018_75)] to-[oklch(0.88_0.025_70)] flex items-center justify-center md:p-8">
      {/* Mobile: edge-to-edge. Desktop: phone frame */}
      <div className="relative w-full h-[100svh] md:h-[860px] md:w-[400px] md:rounded-[3.2rem] md:border-[10px] md:border-black/85 md:shadow-[0_60px_120px_-30px_rgba(0,0,0,0.5)] overflow-hidden bg-background">
        {/* iOS status bar */}
        <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-7 pt-3 pb-1 text-[11px] font-medium text-foreground/90">
          <span>9:41</span>
          <div className="absolute left-1/2 -translate-x-1/2 top-2 h-6 w-28 rounded-full bg-black hidden md:block" />
          <div className="flex items-center gap-1">
            <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor"><path d="M1 7h2v2H1zM4 5h2v4H4zM7 3h2v6H7zM10 1h2v8h-2z"/></svg>
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M7 1.5c2 0 3.8.7 5 1.8M7 4c1.2 0 2.3.4 3 1M7 6.5a1 1 0 100 2 1 1 0 000-2z"/></svg>
            <svg width="22" height="10" viewBox="0 0 22 10" fill="none" stroke="currentColor" strokeWidth="0.8"><rect x="1" y="1" width="17" height="8" rx="2"/><rect x="2.5" y="2.5" width="14" height="5" rx="1" fill="currentColor"/><path d="M19 3.5v3" /></svg>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
