import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { initials, signPaths } from "@/lib/community";
import { listConversations, type Conversation } from "@/lib/chat";

function Avatar({ url, label, size = 44 }: { url?: string | null; label?: string | null; size?: number }) {
  if (url) return <img src={url} alt="" style={{ height: size, width: size }} className="rounded-full object-cover" />;
  return (
    <div
      style={{ height: size, width: size }}
      className="rounded-full bg-secondary/60 flex items-center justify-center text-[10px] tracking-widest"
    >{initials(label)}</div>
  );
}

/** Reusable conversation list — same data logic as the Chat screen. */
export function ConversationList({
  openThread,
  onStartChat,
}: {
  openThread: (id: string) => void;
  onStartChat?: () => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Conversation[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const list = await listConversations();
      setRows(list);
      setAvatars(await signPaths("avatars", list.map((r) => r.other_profile_image)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossibile caricare le conversazioni");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div>;
  }

  if (rows.length === 0) {
    return (
      <section className="mx-6 mt-6 rounded-3xl bg-card border border-border/60 p-8 text-center shadow-soft animate-fade-up">
        <div className="mx-auto h-14 w-14 rounded-full bg-secondary/60 flex items-center justify-center mb-4">
          <MessageCircle size={20} />
        </div>
        <h2 className="font-serif text-2xl italic">Nessuna conversazione</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Scrivi a un'amica o crea un gruppo per condividere outfit e ricevere pareri.
        </p>
        {onStartChat && (
          <button
            onClick={onStartChat}
            className="mt-6 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98]"
          >Inizia</button>
        )}
      </section>
    );
  }

  return (
    <section className="mt-4 divide-y divide-border/60 animate-fade-up">
      {rows.map((c) => (
        <button
          key={c.conversation_id}
          onClick={() => openThread(c.conversation_id)}
          className="w-full px-6 py-4 flex items-center gap-3 text-left active:bg-secondary/40"
        >
          {c.is_group ? (
            <div className="h-11 w-11 rounded-full bg-secondary/60 flex items-center justify-center"><Users size={16} /></div>
          ) : (
            <Avatar url={c.other_profile_image ? avatars[c.other_profile_image] : null} label={c.title} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">
              {c.title ?? "—"}
              {c.is_group && <span className="text-muted-foreground"> · {c.member_count}</span>}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {c.last_message_type === "outfit_share"
                ? "Outfit condiviso"
                : c.last_message_type === "system"
                  ? "Aggiornamento del gruppo"
                  : c.last_message_body ?? "Nessun messaggio"}
            </p>
          </div>
          {c.status !== "active" && (
            <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Frozen</span>
          )}
          {c.unread_count > 0 && (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-foreground text-background text-[10px] flex items-center justify-center">
              {c.unread_count}
            </span>
          )}
        </button>
      ))}
    </section>
  );
}
