import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Images, Link2, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  createBatchScan,
  createBatchScanFromUrls,
  deleteBatchScan,
  listBatchScans,
  triggerScanWorker,
} from "@/lib/batch-scan.functions";
import { compressImageForUpload } from "@/lib/image-compress";
type JobCounts = { queued: number; processing: number; done: number; failed: number };
type ScanRow = {
  id: string;
  status: string;
  total_photos: number;
  created_at: string;
  jobCounts: JobCounts;
};

const MAX_BATCH_PHOTOS = 150;

type PhotoStatus = "queued" | "compressing" | "uploading" | "uploaded" | "failed";
type PhotoState = { name: string; status: PhotoStatus; error?: string };

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Processing",
  done: "Ready to review",
  done_with_errors: "Ready · some photos failed",
};

export function BatchScan({ go, openReview }: { go: (s: Screen) => void; openReview: (scanId: string) => void }) {
  const { user } = useAuth();
    const create = useServerFn(createBatchScan);
  const createFromUrls = useServerFn(createBatchScanFromUrls);
  const list = useServerFn(listBatchScans);
  const remove = useServerFn(deleteBatchScan);
  const processJobs = useServerFn(triggerScanWorker);
  const fileRef = useRef<HTMLInputElement>(null);

  const [scans, setScans] = useState<ScanRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"photos" | "urls">("photos");
  const [urlRows, setUrlRows] = useState<string[]>([""]);
  const [photoStates, setPhotoStates] = useState<PhotoState[]>([]);

    const refresh = async () => {
    try {
      const rows = (await list()) as unknown as ScanRow[];
      setScans(rows);
    } catch (e) {
      console.error("[AURA batch-scan] list failed", e);
    }
  };

  const deleteScan = async (id: string) => {
    setScans((prev) => prev.filter((s) => s.id !== id));
    try {
      await remove({ data: { scanId: id } });
    } catch (e) {
      console.error("[AURA batch-scan] delete failed", e);
      toast.error("Couldn't remove that batch.");
      refresh();
    }
  };


  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [processingNow, setProcessingNow] = useState(false);

  const runWorker = async (opts: { announce?: boolean } = {}) => {
    let claimed = 0;
    let rounds = 0;
    let totalClaimed = 0;
    setProcessingNow(true);
    try {
      do {
        const res = await processJobs();
        claimed = res?.claimed ?? 0;
        totalClaimed += claimed;
        rounds++;
      } while (claimed > 0 && rounds < 40);
      if (opts.announce) {
        toast(totalClaimed > 0 ? `Processed ${totalClaimed} photo${totalClaimed === 1 ? "" : "s"}` : "Nothing to process right now");
      }
    } catch (e) {
      console.warn("[AURA batch-scan] worker trigger failed", e);
      if (opts.announce) toast.error("Couldn't reach the worker — try again in a moment.");
    } finally {
      setProcessingNow(false);
    }
    refresh();
  };

  useEffect(() => {
    const hasPending = scans.some((s) => s.status === "queued" || s.status === "processing");
    if (!hasPending) return;
    const t = setInterval(runWorker, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scans]);

  const setUrlRow = (i: number, value: string) => {
    setUrlRows((prev) => prev.map((r, idx) => (idx === i ? value : r)));
  };
  const addUrlRow = () => setUrlRows((prev) => [...prev, ""]);
  const removeUrlRow = (i: number) =>
    setUrlRows((prev) => (prev.length === 1 ? [""] : prev.filter((_, idx) => idx !== i)));

  const onSubmitUrls = async () => {
    const urls = Array.from(
      new Set(
        urlRows
          .flatMap((r) => r.split(/\r?\n/))
          .map((u) => u.trim())
          .filter(Boolean),
      ),
    );
    if (!urls.length) return;
    setBusy(true);
    setLabel(`Fetching ${urls.length} image${urls.length === 1 ? "" : "s"}…`);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await createFromUrls({ data: { urls, accessToken: sess.session?.access_token } });
      if (!res.scanId) {
        toast.error(res.error ?? "Could not fetch any of those URLs.");
        return;
      }
      const failedCount = res.failed?.length ?? 0;
      toast.success(
        failedCount
          ? `${res.jobs} queued · ${failedCount} URL${failedCount === 1 ? "" : "s"} failed`
          : `${res.jobs} image${res.jobs === 1 ? "" : "s"} queued`,
      );
      setUrlRows([""]);
      await runWorker();
    } catch (e) {
      console.error("[AURA batch-scan] URL import failed", e);
      toast.error("Could not queue those URLs.");
    } finally {
      setBusy(false);
      setLabel("");
    }
  };

  const onPick = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    const all = Array.from(files);
    const picked = all.slice(0, MAX_BATCH_PHOTOS);
    if (all.length > MAX_BATCH_PHOTOS) {
      toast.warning(`Only the first ${MAX_BATCH_PHOTOS} photos are used per batch — upload the rest as a second batch.`);
    }

    setBusy(true);
    setPhotoStates(picked.map((f) => ({ name: f.name, status: "queued" })));
    const paths: string[] = [];
    const failures: { name: string; error: string }[] = [];

    const setStateAt = (i: number, patch: Partial<PhotoState>) =>
      setPhotoStates((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

    const uploadOne = async (f: File, i: number) => {
      setStateAt(i, { status: "compressing" });
      const compressed = await compressImageForUpload(f);
      setStateAt(i, { status: "uploading" });
      const ext = (compressed.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/batch/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.${ext}`;

      let lastError = "upload failed";
      for (let attempt = 0; attempt < 2; attempt++) {
        const { error } = await supabase.storage.from("wardrobe").upload(path, compressed, {
          cacheControl: "3600", upsert: false, contentType: compressed.type || "image/jpeg",
        });
        if (!error) {
          paths.push(path);
          setStateAt(i, { status: "uploaded" });
          return;
        }
        lastError = error.message;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
      }
      failures.push({ name: f.name, error: lastError });
      setStateAt(i, { status: "failed", error: lastError });
    };

    const CONCURRENCY = 3;
    let next = 0;
    const worker = async () => {
      while (next < picked.length) {
        const i = next++;
        await uploadOne(picked[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, picked.length) }, worker));

    try {
      if (paths.length) {
        setLabel("Queueing…");
        await create({ data: { paths } });
        const failedCount = failures.length;
        toast.success(
          failedCount
            ? `${paths.length} queued · ${failedCount} photo${failedCount === 1 ? "" : "s"} failed to upload`
            : `${paths.length} photo${paths.length === 1 ? "" : "s"} queued`,
        );
        await runWorker();
      } else {
        toast.error("None of those photos could be uploaded.");
      }
    } catch (e) {
      console.error("[AURA batch-scan] queueing failed", e);
      toast.error(
        paths.length
          ? "Photos uploaded but couldn't be queued — tap Process to retry."
          : "Could not queue these photos.",
      );
    } finally {
      setBusy(false);
      setLabel("");
      setPhotoStates([]);
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
        <div className="flex rounded-full border border-border p-1 mb-4">
          <button
            onClick={() => setMode("photos")}
            className={`flex-1 h-9 rounded-full text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 ${mode === "photos" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          ><Images size={12} /> From photos</button>
          <button
            onClick={() => setMode("urls")}
            className={`flex-1 h-9 rounded-full text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 ${mode === "urls" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          ><Link2 size={12} /> From URLs</button>
        </div>

        {mode === "photos" && (
          <>
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
              >{busy
                ? (photoStates.length
                    ? `${photoStates.filter((p) => p.status === "uploaded").length}/${photoStates.length} uploaded…`
                    : label || "Working…")
                : "Choose photos"}</button>
              {busy && photoStates.some((p) => p.status === "failed") && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {photoStates.filter((p) => p.status === "failed").length} photo{photoStates.filter((p) => p.status === "failed").length === 1 ? "" : "s"} failed to upload so far — the rest keep going.
                </p>
              )}
            </div>
            <input
              ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => onPick(e.target.files)}
            />
          </>
        )}

        {mode === "urls" && (
          <div className="rounded-3xl border-2 border-dashed border-border p-6">
            <p className="font-serif text-lg italic text-center">Paste product or image links</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed text-center">
              One link per row — a product page or a direct image link both work. AURA finds the photo, downloads it, and queues each one just like an uploaded photo.
            </p>
            <div className="mt-5 space-y-2">
              {urlRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row}
                    onChange={(e) => setUrlRow(i, e.target.value)}
                    placeholder="https://…"
                    inputMode="url"
                    className="flex-1 h-11 rounded-xl border border-border bg-transparent px-3 text-sm"
                  />
                  <button
                    onClick={() => removeUrlRow(i)}
                    aria-label="Remove this URL"
                    className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center shrink-0 active:scale-90"
                  ><X size={12} /></button>
                </div>
              ))}
            </div>
            <button
              onClick={addUrlRow}
              className="mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
            ><Plus size={12} /> Add URL</button>
            <button
              disabled={busy}
              onClick={onSubmitUrls}
              className="mt-5 h-12 w-full rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] disabled:opacity-50"
            >{busy ? label || "Working…" : "Queue these URLs"}</button>
          </div>
        )}
      </div>

      <div className="mx-6 mt-8">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Your batches</p>
          <button
            onClick={() => runWorker({ announce: true })}
            disabled={processingNow}
            className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-50"
          >
            {processingNow ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Process
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {scans.length === 0 && (
            <p className="text-sm text-muted-foreground">No batches yet.</p>
          )}
                    {scans.map((s) => {
            const c = s.jobCounts;
            const ready = s.status === "done" || s.status === "done_with_errors";
            const reviewable = ready || c.done + c.failed > 0;
            return (
              <div
                key={s.id}
                className="w-full rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3"
              >
                <button
                  onClick={() => reviewable && openReview(s.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-sm">{s.total_photos} photo{s.total_photos === 1 ? "" : "s"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {STATUS_LABEL[s.status] ?? s.status} · {new Date(s.created_at).toLocaleString("en-US")}
                  </p>
                  {!ready && (c.queued + c.processing + c.done + c.failed > 0) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ✓ {c.done} done{c.processing ? ` · ⏳ ${c.processing} processing` : ""}{c.queued ? ` · ${c.queued} queued` : ""}{c.failed ? ` · ⚠ ${c.failed} failed` : ""}
                    </p>
                  )}
                </button>
                {!ready && <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />}
                {reviewable && (
                  <button onClick={() => openReview(s.id)} className="text-[10px] uppercase tracking-[0.25em] shrink-0">
                    Review
                  </button>
                )}
                <button
                  onClick={() => deleteScan(s.id)}
                  aria-label="Remove this batch"
                  className="h-7 w-7 rounded-full bg-secondary/60 flex items-center justify-center shrink-0 active:scale-90"
                ><X size={12} /></button>
              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
}
