import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { acceptedFriends, initials, signPaths, type Friendship } from "@/lib/community";
import { getOrCreateDirect } from "@/lib/chat";

type Counts = { items: number; outfits: number; friends: number };

/**
 * Instagram-style social block for the user's own profile:
 * Items · Outfits · Friends counters + friends list sheet.
 * The friend count is private: it is computed only for the signed-in user.
 */
export function ProfileSocial({
  openThread,
}: {
  openThread?: (id: string) => void;
}) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Counts>({ items: 0, outfits: 0, friends: 0 });
  const [friendsOpen, setFriendsOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (async () => {
      const [items, outfits, friends] = await Promise.all([
        supabase.from("wardrobe_items").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("outfits").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        acceptedFriends().catch(() => [] as Friendship[]),
      ]);
      if (!alive) return;
      setCounts({
        items: items.count ?? 0,
        outfits: outfits.count ?? 0,
        friends: friends.length,
      });
    })();
    return () => { alive = false; };
  }, [user]);

  return (
    <>
      <div className="mt-5 grid grid-cols-3 gap-2 px-6 w-full">
        {[
          { n: counts.items, l: "Items" },
          { n: counts.outfits, l: "Outfits" },
          { n: counts.friends, l: "Friends", onClick: () => setFriendsOpen(true) },
        ].map((s) => (
          <button
            key={s.l}
            type="button"
            onClick={s.onClick}
            disabled={!s.onClick}
            className="rounded-2xl py-2 text-center active:scale-[0.98] transition disabled:active:scale-100"
          >
            <p className="font-serif text-2xl">{s.n}</p>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{s.l}</p>
          </button>
        ))}
      </div>

      {friendsOpen && (
        <FriendsSheet
          onClose={() => setFriendsOpen(false)}
          openThread={openThread}
        />
      )}
    </>
  );
}

function FriendsSheet({
  onClose,
  openThread,
}: {
  onClose: () => void;
  openThread?: (id: string) => void;
}) {
  const [rows, setRows] = useState<Friendship[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await acceptedFriends();
      setRows(list);
      setAvatars(await signPaths("avatars", list.map((f) => f.profile_image)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openFriendChat = async (friendId: string) => {
    if (!openThread) return;
    try {
      const conversationId = await getOrCreateDirect(friendId);
      onClose();
      openThread(conversationId);
    } catch (e) {
      console.error("[AURA] open friend chat", e);
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm animate-fade-in overflow-y-auto no-scrollbar">
      <header className="px-6 pt-14 pb-3 flex items-center justify-between">
        <h2 className="font-serif text-2xl italic">Friends</h2>
        <button onClick={onClose} aria-label="Close" className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90">
          <X size={15} />
        </button>
      </header>
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="px-6 text-sm text-muted-foreground">No friends yet.</p>
      ) : (
        <div className="px-6 pb-28 divide-y divide-border/60">
          {rows.map((f) => (
            <button
              key={f.friendship_id}
              onClick={() => openFriendChat(f.other_id)}
              className="w-full py-3 flex items-center gap-3 text-left active:opacity-70"
            >
              {f.profile_image && avatars[f.profile_image] ? (
                <img src={avatars[f.profile_image]} alt="" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <div className="h-11 w-11 rounded-full bg-secondary/60 flex items-center justify-center text-[10px] tracking-widest">
                  {initials(f.username)}
                </div>
              )}
              <span className="text-sm flex-1">{f.username ?? "—"}</span>
              <ChevronRight size={14} className="text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
