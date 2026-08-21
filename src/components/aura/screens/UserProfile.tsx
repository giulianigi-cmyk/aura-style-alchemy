import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, UserPlus } from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { initials, signPaths } from "@/lib/community";

type PublicProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  profile_image: string | null;
  bio: string | null;
  relation: "self" | "friends" | "outgoing" | "incoming" | "none" | string;
};

export function UserProfile({ userId, onBack }: { userId: string; go?: (s: Screen) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("public_profile", { _user_id: userId });
    if (error) {
      toast.error(error.message);
      setProfile(null);
      setLoading(false);
      return;
    }
    const row = (data as PublicProfile[] | null)?.[0] ?? null;
    setProfile(row);
    if (row?.profile_image) {
      const signed = await signPaths("avatars", [row.profile_image]);
      setAvatar(signed[row.profile_image] ?? null);
    } else {
      setAvatar(null);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const sendRequest = async () => {
    if (!user || !profile) return;
    setBusy(true);
    const { error } = await supabase.from("friends").insert({ requester_id: user.id, addressee_id: profile.id });
    setBusy(false);
    if (error) { toast.error(error.code === "23505" ? t("userProfile.toastRequestAlreadySent") : error.message); return; }
    toast.success(t("userProfile.toastRequestSent"));
    setProfile({ ...profile, relation: "outgoing" });
  };

  const acceptRequest = async () => {
    if (!user || !profile) return;
    setBusy(true);
    const { error } = await supabase
      .from("friends")
      .update({ status: "accepted" })
      .eq("requester_id", profile.id)
      .eq("addressee_id", user.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("userProfile.toastNowFriends"));
    await load();
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3 flex items-center gap-3">
        <button onClick={onBack} aria-label={t("userProfile.backAria")} className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("userProfile.profile")}</p>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div>
      ) : !profile ? (
        <p className="px-6 mt-8 text-sm text-muted-foreground">{t("userProfile.profileNotAvailable")}</p>
      ) : (
        <section className="px-6 mt-4">
          <div className="rounded-3xl bg-card border border-border/60 p-8 text-center shadow-soft animate-fade-up">
            {avatar ? (
              <img src={avatar} alt="" className="mx-auto h-24 w-24 rounded-full object-cover" />
            ) : (
              <div className="mx-auto h-24 w-24 rounded-full bg-secondary/60 flex items-center justify-center text-sm tracking-widest">
                {initials(profile.username)}
              </div>
            )}

            <p className="mt-4 text-sm text-muted-foreground">@{profile.username ?? "—"}</p>
            {profile.full_name && <h1 className="font-serif text-3xl italic mt-1">{profile.full_name}</h1>}
            {profile.bio && <p className="mt-3 text-sm text-foreground/80 leading-relaxed">{profile.bio}</p>}

            <div className="mt-6">
              {profile.relation === "self" ? null : profile.relation === "friends" ? (
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("userProfile.friends")}</span>
              ) : profile.relation === "outgoing" ? (
                <button
                  disabled
                  className="h-11 px-6 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] opacity-60"
                >{t("userProfile.requestSent")}</button>
              ) : profile.relation === "incoming" ? (
                <button
                  onClick={() => void acceptRequest()}
                  disabled={busy}
                  className="h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center gap-2 disabled:opacity-50"
                ><Check size={12} /> {t("userProfile.accept")}</button>
              ) : (
                <button
                  onClick={() => void sendRequest()}
                  disabled={busy}
                  className="h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center gap-2 disabled:opacity-50"
                ><UserPlus size={12} /> {t("userProfile.addFriend")}</button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
