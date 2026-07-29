import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Images, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { createBatchScan, listBatchScans } from "@/lib/batch-scan.functions";

type ScanRow = {
  id: string;
  status: string;
  total_photos: number;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Processing",
  done: "Ready to review",
  done_with_errors: "Ready · some photos failed",
};

export function BatchScan({ go, openReview }: { go: (s: Screen) => void; openReview: (scanId: string) => void }) {
  const { user } = useAuth();
  const create = useServerFn(createBatchScan);
  const list = useServerFn(listBatchScans);
  const fileRef = useRef<HTMLInputElement>(null);

  const [scans, setScans] = useState<ScanRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");

  const refresh = async () => {
    try {
      const rows = (await list()) as unknown as ScanRow[];
      setScans(rows);
    } catch (e) {
      console.error("[AURA batch-scan] list failed", e);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runWorker = async () => {
    try {
      await fetch("/api/public/hooks/process-scan-jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ limit: 5 }),
      });
    } catch (e) {
      console.warn("[AURA batch-scan] worker trigger failed", e);
    }
    refresh();
  };

  const onPick = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    const picked = Array.from(files).slice(0, 20);
    setBusy(true);
    const paths: string[] = [];
    try {
      for (let i = 0; i < picked.length; i++) {
        setLabel(`Uploading photo ${i + 1} of ${picked.length}…`);
        const f = picked[i];
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${user.id}/batch/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from("wardrobe").upload(path, f, {
          cacheControl: "3600", upsert: false, contentType: f.type || "image/jpeg",
        });
        if (error) throw error;
        paths.push(path);
      }
      setLabel("Queueing…");
      await create({ data: { paths } });
      toast.success(`${paths.length} photo${paths.length === 1 ? "" : "s"} queued`);
      await runWorker();
    } catch (e) {
      console.error("[AURA batch-scan] upload failed", e);
      toast.error("Could not queue these photos.");
    } finally {
      setBusy(false);
      setLabel("");
    }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center gap-3">
        <button onClick={() => go("wardrobe")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Wardrobe</p>
          <h1 className="font-serif text-2xl italic leading-tight">Batch scan</h1>
        </div>
      </header>

      <div className="mx-6 mt-6">
        <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center">
          <Images size={22} className="mx-auto text-muted-foreground" />
          <p className="mt-4 font-serif text-lg italic">Upload several outfit photos</p>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            AURA analyses them in the background and prepares a list of suggested pieces.
            Nothing enters your closet until you review and confirm.
          </p>
          <button
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="mt-6 h-12 w-full rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] disabled:opacity-50"
          >{busy ? label || "Working…" : "Choose photos"}</button>
        </div>
        <input
          ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
      </div>

      <div className="mx-6 mt-8">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Your batches</p>
          <button onClick={runWorker} className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <RefreshCw size={12} /> Process
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {scans.length === 0 && (
            <p className="text-sm text-muted-foreground">No batches yet.</p>
          )}
          {scans.map((s) => {
            const ready = s.status === "done" || s.status === "done_with_errors";
            return (
              <button
                key={s.id}
                onClick={() => ready && openReview(s.id)}
                className="w-full text-left rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{s.total_photos} photo{s.total_photos === 1 ? "" : "s"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {STATUS_LABEL[s.status] ?? s.status} · {new Date(s.created_at).toLocaleString()}
                  </p>
                </div>
                {!ready && <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />}
                {ready && <span className="text-[10px] uppercase tracking-[0.25em] shrink-0">Review</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
