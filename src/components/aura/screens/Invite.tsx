import { useState } from "react";
import { ArrowLeft, Copy, Check, Share2, Mail } from "lucide-react";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";

export function Invite({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const code = (user?.id ?? "aura").slice(0, 8).toUpperCase();
  const link = `https://aura.style/i/${code}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* noop */ }
  };

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "Join me on AURA", text: "Digitize your wardrobe with me on AURA.", url: link }); }
      catch { /* noop */ }
    } else { copy(); }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("profile")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">Invite friends</p>
        <span className="w-10" />
      </header>

      <section className="mx-6 mt-6 rounded-3xl gradient-warm border border-border/60 p-7 text-center shadow-soft animate-fade-up">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Your invite code</p>
        <h2 className="font-serif text-4xl italic mt-2">{code}</h2>
        <p className="mt-3 text-sm text-muted-foreground">Share AURA with people whose style you love.</p>

        <div className="mt-5 flex items-center gap-2 bg-background border border-border rounded-full px-4 py-3">
          <span className="flex-1 text-xs truncate text-left">{link}</span>
          <button onClick={copy} className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={share} className="h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center justify-center gap-2">
            <Share2 size={12} /> Share
          </button>
          <a href={`mailto:?subject=Join%20me%20on%20AURA&body=${encodeURIComponent(link)}`}
            className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center justify-center gap-2">
            <Mail size={12} /> Email
          </a>
        </div>
      </section>
    </div>
  );
}
