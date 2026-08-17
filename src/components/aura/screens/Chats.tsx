import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, MessageCircle, Plus, Users, Check } from "lucide-react";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { acceptedFriends, initials, signPaths, type Friendship } from "@/lib/community";
import { listConversations, getOrCreateDirect, createGroup, type Conversation } from "@/lib/chat";

function Avatar({ url, label, size = 44 }: { url?: string | null; label?: string | null; size?: number }) {
  if (url) return <img src={url} alt="" style={{ height: size, width: size }} className="rounded-full object-cover" />;
  return (
    <div
      style={{ height: size, width: size }}
      className="rounded-full bg-secondary/60 flex items-center justify-center text-[10px] tracking-widest"
    >{initials(label)}</div>
  );
}

function NewChatSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await acceptedFriends();
        if (!alive) return;
        setFriends(list);
        setAvatars(await signPaths("avatars", list.map((f) => f.profile_image)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Impossibile caricare gli amici");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const toggle = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const start = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const id = selected.length === 1
        ? await getOrCreateDirect(selected[0])
        : await createGroup(selected);
      onCreated(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossibile creare la conversazione");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-3 max-h-[82vh] overflow-y-auto overscroll-contain"
      >
        <p className="font-serif italic text-lg">Nuova conversazione</p>
        <p className="text-xs text-muted-foreground">
          Seleziona un amico per una chat 1:1, o più amici per creare un gruppo.
        </p>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>
        ) : friends.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Non hai ancora amici. Vai su Community → Friends per aggiungerne.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              {friends.map((f) => {
                const on = selected.includes(f.other_id);
                return (
                  <button
                    key={f.other_id}
                    onClick={() => toggle(f.other_id)}
                    className="w-full flex items-center gap-3 py-2.5 px-1 text-left active:scale-[0.99]"
                  >
                    <Avatar url={f.profile_image ? avatars[f.profile_image] : null} label={f.username} size={36} />
                    <span className="text-sm flex-1">{f.username ?? "—"}</span>
                    <span className={`h-6 w-6 rounded-full border flex items-center justify-center ${on ? "bg-foreground text-background border-foreground" : "border-border"}`}>
                      {on && <Check size={12} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => void start()}
              disabled={!selected.length || busy}
              className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {selected.length > 1 ? "Crea gruppo" : "Apri chat"}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Chats({ go, openThread }: { go: (s: Screen) => void; openThread: (id: string) => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Conversation[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [newChat, setNewChat] = useState(false);

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

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center px-10 text-center">
        <p className="text-sm text-muted-foreground">Accedi per usare la chat.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3 flex items-center justify-between">
        <button onClick={() => go("community")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">Chat</p>
        <button
          onClick={() => setNewChat(true)}
          aria-label="Nuova conversazione"
          className="h-10 w-10 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90"
        ><Plus size={15} /></button>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <section className="mx-6 mt-6 rounded-3xl bg-card border border-border/60 p-8 text-center shadow-soft animate-fade-up">
          <div className="mx-auto h-14 w-14 rounded-full bg-secondary/60 flex items-center justify-center mb-4">
            <MessageCircle size={20} />
          </div>
          <h2 className="font-serif text-2xl italic">Nessuna conversazione</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Scrivi a un'amica o crea un gruppo per condividere outfit e ricevere pareri.
          </p>
          <button
            onClick={() => setNewChat(true)}
            className="mt-6 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98]"
          >Inizia</button>
        </section>
      ) : (
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
      )}

      {newChat && (
        <NewChatSheet
          onClose={() => setNewChat(false)}
          onCreated={(id) => { setNewChat(false); openThread(id); }}
        />
      )}
    </div>
  );
}
