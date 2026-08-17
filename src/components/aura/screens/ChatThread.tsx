import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Send, ImagePlus, Heart, ThumbsDown, MessageCircle,
  Users, Shield, ShieldOff, LogOut, UserPlus, UserMinus, Crown,
} from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { acceptedFriends, initials, signPaths, type Friendship } from "@/lib/community";
import { ChatOutfitPicker, type PickedOutfit } from "../ChatOutfitPicker";
import { createWatermarkedChatSnapshot } from "@/lib/chat-watermark";

import {
  listMessages, listParticipants, listMessageComments, markRead, listConversations,
  sendText, sendOutfitShare, toggleReaction, addMessageComment,
  addParticipant, removeParticipant, leaveConversation, promoteToAdmin,
  listBlockedIds, blockUser, unblockUser,
  systemMessageText, formatTime,
  type ChatMessage, type ChatParticipant, type Conversation, type MessageComment,
} from "@/lib/chat";

/* --------------------------------------------------------- outfit bubble */

function OutfitBubble({
  m, meId, imageUrl, onChanged,
}: {
  m: ChatMessage; meId: string; imageUrl: string | null; onChanged: () => void;
}) {
  const [openComments, setOpenComments] = useState(false);
  const [comments, setComments] = useState<MessageComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [body, setBody] = useState("");

  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    try { setComments(await listMessageComments(m.id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Commenti non disponibili"); }
    finally { setLoadingComments(false); }
  }, [m.id]);

  const react = async (type: "like" | "dislike") => {
    try {
      await toggleReaction(m.id, meId, type, m.my_reaction);
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Reazione non riuscita"); }
  };

  const submitComment = async () => {
    const text = body.trim();
    if (!text) return;
    try {
      await addMessageComment(m.id, meId, text);
      setBody("");
      await loadComments();
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Commento non riuscito"); }
  };

  const ev = (m.event_snapshot ?? null) as { title?: string; date?: string; location?: string } | null;

  return (
    <div className="rounded-2xl overflow-hidden border border-border/60 bg-card w-[78%]">
      <div className="bg-white">
        {imageUrl ? (
          <img src={imageUrl} alt="Outfit" className="aspect-[4/5] w-full object-contain" />
        ) : (
          <div className="aspect-[4/5] flex items-center justify-center text-xs text-muted-foreground">
            Immagine non disponibile
          </div>
        )}
      </div>

      {(m.body || ev?.title) && (
        <div className="px-3 pt-2 space-y-0.5">
          {m.body && <p className="text-sm">{m.body}</p>}
          {ev?.title && (
            <p className="text-[11px] text-muted-foreground">
              {ev.title}{ev.date ? ` · ${ev.date}` : ""}{ev.location ? ` · ${ev.location}` : ""}
            </p>
          )}
        </div>
      )}

      <div className="px-3 py-2 flex items-center gap-4">
        <button onClick={() => void react("like")} className="flex items-center gap-1.5 active:scale-90 transition">
          <Heart size={16} fill={m.my_reaction === "like" ? "currentColor" : "none"} />
          <span className="text-xs">{m.like_count}</span>
        </button>
        <button onClick={() => void react("dislike")} className="flex items-center gap-1.5 active:scale-90 transition">
          <ThumbsDown size={16} fill={m.my_reaction === "dislike" ? "currentColor" : "none"} />
          <span className="text-xs">{m.dislike_count}</span>
        </button>
        <button
          onClick={() => { const next = !openComments; setOpenComments(next); if (next) void loadComments(); }}
          className="flex items-center gap-1.5 active:scale-90 transition"
        >
          <MessageCircle size={16} /><span className="text-xs">{m.comment_count}</span>
        </button>
      </div>

      {openComments && (
        <div className="px-3 pb-3 space-y-2">
          {loadingComments ? (
            <Loader2 size={14} className="animate-spin" />
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nessun commento.</p>
          ) : comments.map((c) => (
            <p key={c.id} className="text-sm">
              <span className="font-medium">{c.username ?? "—"}</span>{" "}
              <span className="text-foreground/80">{c.body}</span>
            </p>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Aggiungi un commento…"
              className="flex-1 bg-secondary/60 rounded-full px-3 py-2 text-sm outline-none"
            />
            <button
              onClick={() => void submitComment()}
              disabled={!body.trim()}
              aria-label="Invia commento"
              className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-40 active:scale-90"
            ><Send size={13} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ group sheet */

function GroupSheet({
  conversation, participants, meId, onClose, onChanged,
}: {
  conversation: Conversation;
  participants: ChatParticipant[];
  meId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [friends, setFriends] = useState<Friendship[]>([]);
  const isAdmin = conversation.my_role === "admin";
  const active = participants.filter((p) => !p.left_at);

  useEffect(() => {
    void (async () => {
      try { setFriends(await acceptedFriends()); } catch { /* ignore */ }
    })();
  }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Operazione non riuscita"); }
  };

  const addable = friends.filter((f) => !active.some((p) => p.user_id === f.other_id));

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 max-h-[82vh] overflow-y-auto overscroll-contain"
      >
        <p className="font-serif italic text-lg">Partecipanti</p>

        <div className="space-y-1">
          {active.map((p) => (
            <div key={p.user_id} className="flex items-center gap-3 py-2">
              <div className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center text-[10px] tracking-widest">
                {initials(p.username)}
              </div>
              <span className="text-sm flex-1">
                {p.username ?? "—"}{p.user_id === meId ? " (tu)" : ""}
              </span>
              {p.role === "admin" && <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Admin</span>}
              {isAdmin && p.user_id !== meId && (
                <>
                  {p.role !== "admin" && (
                    <button
                      onClick={() => void run(() => promoteToAdmin(conversation.conversation_id, p.user_id), "Promosso ad admin")}
                      aria-label="Promuovi ad admin"
                      className="h-8 w-8 rounded-full border border-border flex items-center justify-center active:scale-90"
                    ><Crown size={12} /></button>
                  )}
                  <button
                    onClick={() => void run(() => removeParticipant(conversation.conversation_id, p.user_id), "Partecipante rimosso")}
                    aria-label="Rimuovi partecipante"
                    className="h-8 w-8 rounded-full border border-border flex items-center justify-center active:scale-90"
                  ><UserMinus size={12} /></button>
                </>
              )}
            </div>
          ))}
        </div>

        {addable.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Aggiungi amici</p>
            {addable.map((f) => (
              <div key={f.other_id} className="flex items-center gap-3 py-2">
                <span className="text-sm flex-1">{f.username ?? "—"}</span>
                <button
                  onClick={() => void run(() => addParticipant(conversation.conversation_id, f.other_id), "Aggiunto al gruppo")}
                  className="h-8 px-3 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] active:scale-95 inline-flex items-center gap-1.5"
                ><UserPlus size={11} /> Aggiungi</button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => void run(async () => { await leaveConversation(conversation.conversation_id); onClose(); }, "Hai lasciato il gruppo")}
          className="w-full h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center justify-center gap-2"
        ><LogOut size={12} /> Esci dal gruppo</button>
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------------------------------------------- thread */

export function ChatThread({
  go, conversationId, onBack,
}: {
  go: (s: Screen) => void;
  conversationId: string;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [blocked, setBlocked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(false);
  const [groupSheet, setGroupSheet] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [convs, msgs, parts, blocks] = await Promise.all([
        listConversations(),
        listMessages(conversationId),
        listParticipants(conversationId),
        listBlockedIds(),
      ]);
      setConversation(convs.find((c) => c.conversation_id === conversationId) ?? null);
      setMessages(msgs);
      setParticipants(parts);
      setBlocked(blocks);
      setImages(await signPaths("outfits", msgs.map((m) => m.snapshot_image_url)));
      await markRead(conversationId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossibile aprire la conversazione");
    } finally {
      setLoading(false);
    }
  }, [conversationId, user]);

  useEffect(() => { void load(); }, [load]);

  // Live updates for this conversation.
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const nameOf = useCallback(
    (id: string) => participants.find((p) => p.user_id === id)?.username ?? "qualcuno",
    [participants],
  );

  const otherId = conversation?.other_id ?? null;
  const isBlockedByMe = Boolean(otherId && blocked.includes(otherId));
  const canSend = Boolean(conversation?.can_send) && !isBlockedByMe;

  const send = async () => {
    const value = text.trim();
    if (!value || !user) return;
    setSending(true);
    try {
      await sendText(conversationId, user.id, value);
      setText("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Messaggio non inviato");
    } finally {
      setSending(false);
    }
  };

  const attachOutfit = async (outfit: PickedOutfit) => {
    if (!user) return;
    setPicker(false);
    setSending(true);
    try {
      // Burn a per-share watermark with the sender's username. Always a new
      // file: the outfit's own canvas_image_url is never modified.
      const senderUsername = participants.find((p) => p.user_id === user.id)?.username ?? null;
      const snapshotImageUrl = await createWatermarkedChatSnapshot({
        sourcePath: outfit.canvas_image_url,
        senderId: user.id,
        senderUsername,
      });
      await sendOutfitShare({
        conversationId,
        senderId: user.id,
        outfitId: outfit.id,
        snapshotImageUrl,
        body: text.trim() || null,
      });
      setText("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Outfit non condiviso");
    } finally {
      setSending(false);
    }
  };


  const toggleBlock = async () => {
    if (!user || !otherId) return;
    try {
      if (isBlockedByMe) { await unblockUser(user.id, otherId); toast.success("Utente sbloccato"); }
      else { await blockUser(user.id, otherId); toast.success("Utente bloccato — la chat è in sola lettura"); }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operazione non riuscita");
    }
  };

  const header = useMemo(() => conversation?.title ?? "Chat", [conversation]);

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center px-10 text-center">
        <p className="text-sm text-muted-foreground">Accedi per usare la chat.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="px-5 pt-14 pb-3 flex items-center gap-3 border-b border-border/60">
        <button onClick={onBack} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{header}</p>
          {conversation?.is_group && (
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {conversation.member_count} partecipanti
            </p>
          )}
        </div>
        {conversation?.is_group ? (
          <button
            onClick={() => setGroupSheet(true)}
            aria-label="Gestisci gruppo"
            className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
          ><Users size={15} /></button>
        ) : otherId ? (
          <button
            onClick={() => void toggleBlock()}
            aria-label={isBlockedByMe ? "Sblocca" : "Blocca"}
            className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
          >{isBlockedByMe ? <ShieldOff size={15} /> : <Shield size={15} />}</button>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground mt-10">
            Nessun messaggio. Scrivi qualcosa o condividi un outfit.
          </p>
        ) : messages.map((m) => {
          if (m.content_type === "system") {
            return (
              <p key={m.id} className="text-center text-[11px] text-muted-foreground py-1">
                {systemMessageText(m, nameOf)}
              </p>
            );
          }
          const mine = m.sender_id === user.id;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              {conversation?.is_group && !mine && (
                <span className="text-[10px] text-muted-foreground mb-0.5 px-1">{m.sender_username ?? "—"}</span>
              )}
              {m.content_type === "outfit_share" ? (
                <OutfitBubble
                  m={m}
                  meId={user.id}
                  imageUrl={m.snapshot_image_url ? images[m.snapshot_image_url] ?? null : null}
                  onChanged={() => void load()}
                />
              ) : (
                <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-foreground text-background" : "bg-secondary/60"}`}>
                  {m.deleted_at ? <span className="italic opacity-60">Messaggio eliminato</span> : m.body}
                </div>
              )}
              <span className="text-[9px] text-muted-foreground mt-1 px-1">{formatTime(m.created_at)}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="px-5 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t border-border/60">
        {!canSend ? (
          <p className="text-center text-xs text-muted-foreground py-3">
            {isBlockedByMe
              ? "Hai bloccato questa persona: la conversazione è in sola lettura."
              : "Questa conversazione è in sola lettura."}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPicker(true)}
              aria-label="Allega outfit"
              className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90 shrink-0"
            ><ImagePlus size={16} /></button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
              placeholder="Scrivi un messaggio…"
              maxLength={2000}
              className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
            />
            <button
              onClick={() => void send()}
              disabled={!text.trim() || sending}
              aria-label="Invia"
              className="h-10 w-10 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-40 active:scale-90 shrink-0"
            >{sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</button>
          </div>
        )}
      </div>

      {picker && <ChatOutfitPicker onPick={(o) => void attachOutfit(o)} onClose={() => setPicker(false)} />}
      {groupSheet && conversation && (
        <GroupSheet
          conversation={conversation}
          participants={participants}
          meId={user.id}
          onClose={() => { setGroupSheet(false); void load(); }}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
