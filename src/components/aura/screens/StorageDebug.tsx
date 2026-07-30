import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type Check = { label: string; status: "pending" | "ok" | "fail"; detail: string; url?: string };

/** TEMPORARY diagnostic screen — not part of the app, remove once the
 *  storage issue is found. Tries to read one real file from each bucket
 *  and shows exactly what happens, so the real error is visible on the
 *  phone instead of needing the Supabase dashboard. */
export function StorageDebug({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const results: Check[] = [];

      // 1. Session sanity check
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      results.push({
        label: "Auth session",
        status: sessionErr || !sessionData.session ? "fail" : "ok",
        detail: sessionErr ? sessionErr.message : sessionData.session ? `Logged in as ${sessionData.session.user.email}` : "No active session",
      });

      // 2. Profile avatar path + signed URL
      const { data: profile, error: profErr } = await supabase
        .from("profiles").select("profile_image").eq("id", user.id).maybeSingle();
      if (profErr) {
        results.push({ label: "Profile row", status: "fail", detail: profErr.message });
      } else {
        const path = (profile as { profile_image?: string | null } | null)?.profile_image;
        if (!path) {
          results.push({ label: "Avatar path", status: "fail", detail: "No profile_image saved on this account yet." });
        } else {
          const { data: signed, error: signErr } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
          results.push({
            label: `Avatar signed URL (avatars/${path})`,
            status: signErr || !signed?.signedUrl ? "fail" : "ok",
            detail: signErr ? signErr.message : "Signed URL created",
            url: signed?.signedUrl,
          });
        }
      }

      // 3. One real wardrobe item image
      const { data: items, error: itemErr } = await supabase
        .from("wardrobe_items").select("image_url").eq("user_id", user.id).limit(1);
      if (itemErr) {
        results.push({ label: "Wardrobe row", status: "fail", detail: itemErr.message });
      } else if (!items?.length) {
        results.push({ label: "Wardrobe item", status: "fail", detail: "No wardrobe items found for this account." });
      } else {
        const raw = (items[0] as { image_url?: string | null }).image_url;
        const path = raw && raw.startsWith("http") ? (raw.split("/wardrobe/")[1] ?? raw) : raw;
        if (!path) {
          results.push({ label: "Wardrobe image path", status: "fail", detail: "image_url is empty on this item." });
        } else {
          const { data: signed, error: signErr } = await supabase.storage.from("wardrobe").createSignedUrl(path, 3600);
          results.push({
            label: `Wardrobe signed URL (wardrobe/${path})`,
            status: signErr || !signed?.signedUrl ? "fail" : "ok",
            detail: signErr ? signErr.message : "Signed URL created",
            url: signed?.signedUrl,
          });
        }
      }

      setChecks(results);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center gap-3">
        <button onClick={() => go("profile")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Temporary</p>
          <h1 className="font-serif text-2xl italic leading-tight">Storage debug</h1>
        </div>
      </header>

      {loading ? (
        <div className="mx-6 mt-10 text-center">
          <Loader2 size={18} className="mx-auto animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mx-6 mt-4 space-y-3">
          {checks.map((c) => (
            <div key={c.label} className={`rounded-2xl border p-4 ${c.status === "ok" ? "border-green-600/40 bg-green-600/5" : "border-red-600/40 bg-red-600/5"}`}>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{c.label}</p>
              <p className="text-sm mt-1 font-medium">{c.status === "ok" ? "✅ OK" : "❌ FAILED"}</p>
              <p className="text-xs text-muted-foreground mt-1 break-words">{c.detail}</p>
              {c.url && (
                <img
                  src={c.url}
                  alt=""
                  className="mt-3 h-24 w-24 rounded-xl object-cover border border-border"
                  onError={(e) => {
                    const p = e.currentTarget.nextElementSibling;
                    if (p) p.textContent = "Signed URL was created but the image itself failed to load (network/CORS).";
                  }}
                />
              )}
              {c.url && <p className="text-[10px] text-muted-foreground mt-1"></p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
