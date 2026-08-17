import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Download, Loader2, Share2, QrCode as QrIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AURA_APP_URL, dataUrlToBlob, downloadBlob, nativeShareFile, nativeShareText } from "@/lib/aura-share";

export function addFriendUrl(username: string) {
  const origin = typeof window !== "undefined" && window.location.origin.includes("lovable.app")
    ? window.location.origin
    : AURA_APP_URL;
  return `${origin}/add/${username}`;
}

export function useMyUsername(userId: string | undefined) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
      if (!cancelled) {
        setUsername((data as { username?: string | null } | null)?.username ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return { username, loading };
}

function useQrDataUrl(username: string | null) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!username) { setDataUrl(null); return; }
    let cancelled = false;
    QRCode.toDataURL(addFriendUrl(username), {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1A1714", light: "#FFFFFF" },
    })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [username]);
  return dataUrl;
}

async function shareQr(dataUrl: string, username: string) {
  const blob = dataUrlToBlob(dataUrl);
  const file = new File([blob], `aura-${username}.png`, { type: "image/png" });
  const text = `Add me on AURA — @${username}`;
  if (await nativeShareFile(file, `${text}\n${addFriendUrl(username)}`)) return;
  const res = await nativeShareText({ title: "AURA", text, url: addFriendUrl(username) });
  if (res === "copied") toast.success("Link copied");
  if (res === "failed") toast.error("Couldn't share right now");
}

/** Fullscreen dedicated QR view. */
export function QrFullscreen({ userId, onClose }: { userId: string | undefined; onClose: () => void }) {
  const { username, loading } = useMyUsername(userId);
  const dataUrl = useQrDataUrl(username);

  return (
    <div className="absolute inset-0 z-50 bg-background flex flex-col animate-fade-in">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button
          onClick={onClose}
          aria-label="Back"
          className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
        ><ArrowLeft size={16} /></button>
        <h1 className="font-serif text-lg italic">My QR</h1>
        <span className="h-10 w-10" />
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        {loading ? (
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        ) : !username ? (
          <p className="text-sm text-muted-foreground">Set a username in your profile to get your QR code.</p>
        ) : (
          <>
            <div className="rounded-[2rem] bg-white p-5 shadow-luxe animate-scale-in">
              {dataUrl ? (
                <img src={dataUrl} alt={`QR code linking to @${username} on AURA`} className="h-60 w-60" />
              ) : (
                <div className="h-60 w-60 flex items-center justify-center">
                  <Loader2 size={18} className="animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <p className="mt-6 font-serif italic text-lg">@{username}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Scan to add me on Aura
            </p>

            <div className="mt-10 flex items-center gap-3">
              <button
                disabled={!dataUrl}
                onClick={() => dataUrl && downloadBlob(dataUrlToBlob(dataUrl), `aura-${username}.png`)}
                className="h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center gap-2 active:scale-95 disabled:opacity-40"
              ><Download size={13} /> Save</button>
              <button
                disabled={!dataUrl}
                onClick={() => dataUrl && void shareQr(dataUrl, username)}
                className="h-11 px-6 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] flex items-center gap-2 active:scale-95 disabled:opacity-40"
              ><Share2 size={13} /> Share</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Inline "My QR" section for the profile page. */
export function MyQrSection({ userId, onOpen }: { userId: string | undefined; onOpen: () => void }) {
  const { username } = useMyUsername(userId);
  const dataUrl = useQrDataUrl(username);

  return (
    <div className="px-6 mt-8">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">My QR</p>
      <div className="mt-3 rounded-3xl border border-border p-4 flex items-center gap-4">
        <button
          onClick={onOpen}
          aria-label="Open my QR code full screen"
          className="rounded-2xl bg-white p-2 active:scale-95 transition shrink-0"
        >
          {dataUrl ? (
            <img src={dataUrl} alt="My AURA QR code" className="h-20 w-20" />
          ) : (
            <div className="h-20 w-20 flex items-center justify-center text-muted-foreground">
              <QrIcon size={22} />
            </div>
          )}
        </button>
        <div className="min-w-0">
          <p className="font-serif italic text-sm">
            {username ? `@${username}` : "Set a username first"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            Tap the code to open it full screen, then save or share it.
          </p>
        </div>
      </div>
    </div>
  );
}
