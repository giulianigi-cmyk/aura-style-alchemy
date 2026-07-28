import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { acceptedFriends, initials, signPaths, type Friendship } from "@/lib/community";

/** Bottom sheet that shares one of the user's own outfits with accepted friends. */
export function ShareOutfitSheet({ outfitId, onClose }: { outfitId: string; onClose: () => void }) {
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
        if (alive) toast.error(e instanceof Error ? e.message : "Could not load friends");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const share = async () => {
    if (!selected.length) return;
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id;
    if (!me) { setBusy(false); toast.error("You are signed out"); return; }

    let ok = 0;
    let dup = 0;
    let failed = 0;
    for (const friendId of selected) {
      const { error } = await supabase
        .from("outfit_shares")
        .insert({ outfit_id: outfitId, shared_by: me, shared_with: friendId });
      if (!error) ok++;
      else if (error.code === "23505") dup++;
      else failed++;
    }
    setBusy(false);
    if (ok) toast.success(`Shared with ${ok} friend${ok > 1 ? "s" : ""}`);
    if (dup) toast(`Already shared with ${dup} friend${dup > 1 ? "s" : ""}`);
    if (failed) toast.error(`Could not share with ${failed} friend${failed > 1 ? "s" : ""}`);
    if (!failed) onClose();
  };

    return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-end" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-3 max-h-[82vh] overflow-y-auto overscroll-contain"
      >
        <p className="font-serif italic text-lg">Share with friends</p>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>
        ) : friends.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            You have no friends yet. Head to Community → Friends to add people first.
          </p>
        ) : (
          <>
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
              onClick={() => void share()}
              disabled={!selected.length || busy}
              className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >{busy && <Loader2 size={12} className="animate-spin" />} Share</button>
          </>
        )}
      </div>
       </div>,
    document.body,
  );
}

