import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/** Short two-note chime. Browsers block audio before the first user
 *  gesture, so a failure here is silently ignored — the toast still shows. */
function playChime() {
  try {
    const Ctor = (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.24);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* audio unavailable — ignore */
  }
}

/** In-app notification stream: subscribes to the current user's own
 *  notification rows and surfaces outfit shares with a toast + chime. */
export function useChatNotifications(onOpen?: (conversationId: string) => void) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as { type?: string; title?: string; body?: string; data?: { conversation_id?: string } };
          if (row.type !== "outfit_share") return;
          playChime();
          const conversationId = row.data?.conversation_id;
          toast(row.title ?? "Nuovo outfit condiviso", {
            description: row.body ?? undefined,
            action: conversationId && onOpen
              ? { label: "Apri", onClick: () => onOpen(conversationId) }
              : undefined,
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [user, onOpen]);
}
