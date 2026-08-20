import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ChevronRight, LogOut, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { deleteMyAccount } from "@/lib/delete-account.functions";
import i18n, { LANGUAGE_LABELS, type SupportedLanguage } from "@/i18n/config";

function Row({ label, sub, onClick }: { label: string; sub?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between px-4 py-3.5 text-left active:bg-secondary/40 transition">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
      </div>
      <ChevronRight size={15} className="text-muted-foreground shrink-0 ml-2" />
    </button>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="mx-6 mb-3.5 rounded-[20px] bg-card border border-border overflow-hidden divide-y divide-border">{children}</div>;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-6 pt-3 pb-1.5 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{children}</p>;
}

export function Settings({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const currentLanguage = ((profile?.language as SupportedLanguage | null) ?? (i18n.language as SupportedLanguage)) ?? "en";
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const callDeleteMyAccount = useServerFn(deleteMyAccount);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await callDeleteMyAccount();
      // The account and its session are gone server-side; signOut() just
      // clears the local client state so the app falls back to the auth
      // screen instead of showing a broken signed-in-but-deleted UI.
      await signOut();
    } catch (err) {
      setDeleting(false);
      setConfirmingDelete(false);
      toast.error(t("settings.deleteAccountError"));
      console.error("[Settings] deleteMyAccount failed", err);
    }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("profile")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("settings.title")}</p>
        <span className="w-10" />
      </header>

      <GroupLabel>{t("settings.groupAccount")}</GroupLabel>
      <Group>
        <Row label={t("settings.personalInfo")} sub={t("settings.personalInfoSub")} onClick={() => go("settings-personal")} />
        <Row label={t("settings.sizes")} onClick={() => go("settings-sizes")} />
        <Row label={t("settings.stylePrefs")} sub={t("settings.stylePrefsSub")} onClick={() => go("settings-style-prefs")} />
        <Row label={t("settings.language")} sub={LANGUAGE_LABELS[currentLanguage]} onClick={() => go("settings-language")} />
      </Group>

      <GroupLabel>{t("settings.groupWardrobe")}</GroupLabel>
      <Group>
        <Row label={t("settings.wardrobeLocations")} onClick={() => go("settings-wardrobe-locations")} />
        <Row label={t("settings.dressPreferences")} onClick={() => go("settings-dress-preferences")} />
      </Group>

      <GroupLabel>{t("settings.groupApp")}</GroupLabel>
      <Group>
        <Row label={t("settings.notifications")} onClick={() => go("settings-notifications")} />
        <Row label={t("settings.calendar")} onClick={() => go("settings-calendar")} />
        <Row label={t("settings.privacy")} onClick={() => go("settings-privacy")} />
      </Group>

      <Group>
        <button
          onClick={() => void signOut()}
          className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left text-[#b23c3c] active:bg-secondary/40 transition"
        >
          <LogOut size={15} />
          <span className="text-sm">{t("settings.signOut")}</span>
        </button>
      </Group>

      <Group>
        <button
          onClick={() => setConfirmingDelete(true)}
          className="w-full flex flex-col items-start px-4 py-3.5 text-left text-[#b23c3c] active:bg-secondary/40 transition"
        >
          <span className="text-sm">{t("settings.deleteAccount")}</span>
          <span className="text-[11px] text-[#b23c3c]/70 mt-0.5">{t("settings.deleteAccountSub")}</span>
        </button>
      </Group>

      {confirmingDelete && (
        <div className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-luxe">
            <p className="font-serif text-lg italic">{t("settings.deleteAccountConfirmTitle")}</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t("settings.deleteAccountConfirmBody")}</p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="w-full h-12 rounded-full bg-[#b23c3c] text-white flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-60"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
                <span className="text-[10px] uppercase tracking-[0.3em]">{t("settings.deleteAccountConfirmButton")}</span>
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="w-full h-12 rounded-full border border-border flex items-center justify-center active:scale-[0.98] transition disabled:opacity-60"
              >
                <span className="text-[10px] uppercase tracking-[0.3em]">{t("settings.cancel")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
