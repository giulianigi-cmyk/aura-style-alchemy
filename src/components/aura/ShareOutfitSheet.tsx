import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { acceptedFriends, initials, signPaths, type Friendship } from "@/lib/community";
import { getOrCreateDirect, sendOutfitShare } from "@/lib/chat";
import { createWatermarkedChatSnapshot } from "@/lib/chat-watermark";

type ShareMode = "friend" | "feed";

/** Bottom sheet to share one of the user's own outfits.
 *
 * Two genuinely different destinations, not one feature wearing two hats:
 * - "friend": sends the outfit as a real message inside a private 1:1
 *   conversation (reuses the same chat pipeline ChatThread's outfit
 *   attach uses) — visible only to that person, ever.
 * - "feed": posts to `outfit_shares` with shared_with = NULL, visible to
 *   every accepted friend (see get_shared_feed RPC). This is the only
 *   path that is actually a feed; it used to be faked by picking friends
 *   one by one, which created a private post per person while looking
 *   like a public feed post — confusing, and fixed here. */
export function ShareOutfitSheet({ outfitId, onClose }: { outfitId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ShareMode>("friend");
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
        const map = await signPaths("avatars", list.map((f) => f.profile_image));
        if (alive) setAvatars(map);
      } catch (e) {
        if (alive) toast.error(e instanceof Error ? e.message : t("shareOutfitSheet.couldNotLoadFriends"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const shareToFriends = async () => {
    if (!selected.length) return;
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id;
    if (!me) { setBusy(false); toast.error(t("shareOutfitSheet.youAreSignedOut")); return; }

    const { data: outfit, error: outfitErr } = await supabase
      .from("outfits").select("canvas_image_url").eq("id", outfitId).maybeSingle();
    if (outfitErr || !outfit?.canvas_image_url) {
      setBusy(false);
      toast.error(t("shareOutfitSheet.couldNotShareWithCount", { count: selected.length }));
      return;
    }
    const { data: myProfile } = await supabase.from("profiles").select("username").eq("id", me).maybeSingle();
    const senderUsername = (myProfile as { username?: string | null } | null)?.username ?? null;

    let ok = 0;
    let failed = 0;
    for (const friendId of selected) {
      try {
        const conversationId = await getOrCreateDirect(friendId);
        const snapshotImageUrl = await createWatermarkedChatSnapshot({
          sourcePath: outfit.canvas_image_url as string,
          senderId: me,
          senderUsername,
        });
        await sendOutfitShare({ conversationId, senderId: me, outfitId, snapshotImageUrl, body: null });
        ok++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (ok) toast.success(t("shareOutfitSheet.sentInChatCount", { count: ok }));
    if (failed) toast.error(t("shareOutfitSheet.couldNotShareWithCount", { count: failed }));
    if (!failed) onClose();
  };

  const shareToFeed = async () => {
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id;
    if (!me) { setBusy(false); toast.error(t("shareOutfitSheet.youAreSignedOut")); return; }

    const { error } = await supabase
      .from("outfit_shares")
      .insert({ outfit_id: outfitId, shared_by: me, shared_with: null });
    setBusy(false);
    if (error && error.code === "23505") {
      toast(t("shareOutfitSheet.alreadyOnFeed"));
      onClose();
      return;
    }
    if (error) { toast.error(error.message); return; }
    toast.success(t("shareOutfitSheet.sharedToFeed"));
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-3 max-h-[82vh] overflow-y-auto overscroll-contain"
      >
        <p className="font-serif italic text-lg">{t("shareOutfitSheet.shareOutfit")}</p>

        <div className="flex rounded-full bg-secondary/60 p-1">
          <button
            onClick={() => setMode("friend")}
            className={`flex-1 h-9 rounded-full text-[11px] uppercase tracking-[0.2em] transition ${mode === "friend" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          >{t("shareOutfitSheet.modeFriend")}</button>
          <button
            onClick={() => setMode("feed")}
            className={`flex-1 h-9 rounded-full text-[11px] uppercase tracking-[0.2em] transition ${mode === "feed" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          >{t("shareOutfitSheet.modeFeed")}</button>
        </div>

        {mode === "friend" ? (
          loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>
          ) : friends.length === 0 ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{t("shareOutfitSheet.noFriendsYetHint")}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground px-1">{t("shareOutfitSheet.modeFriendHint")}</p>
              <div className="space-y-1">
                {friends.map((f) => {
                  const on = selected.includes(f.other_id);
                  const url = f.profile_image ? avatars[f.profile_image] : null;
                  return (
                    <button
                      key={f.other_id}
                      onClick={() => toggle(f.other_id)}
                      className="w-full flex items-center gap-3 py-2.5 px-1 text-left active:scale-[0.99]"
                    >
                      {url ? (
                        <img src={url} alt="" className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center text-[10px] tracking-widest">
                          {initials(f.username)}
                        </div>
                      )}
                      <span className="text-sm flex-1">{f.username ?? "—"}</span>
                      <span className={`h-6 w-6 rounded-full border flex items-center justify-center ${on ? "bg-foreground text-background border-foreground" : "border-border"}`}>
                        {on && <Check size={12} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => void shareToFriends()}
                disabled={!selected.length || busy}
                className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >{busy && <Loader2 size={12} className="animate-spin" />} {t("shareOutfitSheet.sendInChat")}</button>
            </>
          )
        ) : (
          <>
            <p className="text-xs text-muted-foreground px-1 leading-relaxed">{t("shareOutfitSheet.modeFeedHint")}</p>
            <button
              onClick={() => void shareToFeed()}
              disabled={busy}
              className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >{busy && <Loader2 size={12} className="animate-spin" />} {t("shareOutfitSheet.shareToFeedButton")}</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
