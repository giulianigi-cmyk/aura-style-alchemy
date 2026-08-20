import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Check } from "lucide-react";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { acceptedFriends, initials, signPaths, type Friendship } from "@/lib/community";
import { getOrCreateDirect, createGroup } from "@/lib/chat";
import { ConversationList } from "../ConversationList";

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
  const { t } = useTranslation();
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
        toast.error(e instanceof Error ? e.message : t("chats.toastCouldNotLoadFriends"));
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
      toast.error(e instanceof Error ? e.message : t("chats.toastCouldNotCreate"));
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
        <p className="font-serif italic text-lg">{t("chats.newConversation")}</p>
        <p className="text-xs text-muted-foreground">
          {t("chats.selectFriendHint")}
        </p>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>
        ) : friends.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("chats.noFriendsYet")}
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
              {selected.length > 1 ? t("chats.createGroup") : t("chats.openChat")}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Chats({ go, openThread }: { go: (s: Screen) => void; openThread: (id: string) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [newChat, setNewChat] = useState(false);

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center px-10 text-center">
        <p className="text-sm text-muted-foreground">{t("chats.signInToUse")}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3 flex items-center justify-between">
        <button onClick={() => go("community")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("chats.title")}</p>
        <button
          onClick={() => setNewChat(true)}
          aria-label={t("chats.newConversation")}
          className="h-10 w-10 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90"
        ><Plus size={15} /></button>
      </header>

      <ConversationList openThread={openThread} onStartChat={() => setNewChat(true)} />

      {newChat && (
        <NewChatSheet
          onClose={() => setNewChat(false)}
          onCreated={(id) => { setNewChat(false); openThread(id); }}
        />
      )}
    </div>
  );
}
