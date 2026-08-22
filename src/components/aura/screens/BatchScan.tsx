import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Images, Link2, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  createBatchScan,
  resolveBatchUrlCandidates,
  createBatchScanFromSelections,
  deleteBatchScan,
  listBatchScans,
  triggerScanWorker,
  type UrlCandidateResult,
} from "@/lib/batch-scan.functions";
import { compressImageForUpload } from "@/lib/image-compress";
import i18n from "@/i18n/config";
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

export function BatchScan({ go, openReview }: { go: (s: Screen) => void; openReview: (scanId: string) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
    const create = useServerFn(createBatchScan);
  const resolveCandidates = useServerFn(resolveBatchUrlCandidates);
  const queueSelections = useServerFn(createBatchScanFromSelections);
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
  const [urlCandidates, setUrlCandidates] = useState<UrlCandidateResult[] | null>(null);
  const [chosenIndex, setChosenIndex] = useState<Record<string, number>>({});
  const [brokenCandidates, setBrokenCandidates] = useState<Record<string, boolean>>({});

  const statusLabel = (status: string): string => {
    switch (status) {
      case "queued": return t("batchScan.statusQueued");
      case "processing": return t("batchScan.statusProcessing");
      case "done": return t("batchScan.statusDone");
      case "done_with_errors": return t("batchScan.statusDoneWithErrors");
      default: return status;
    }
  };

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
      toast.error(t("batchScan.couldntRemoveBatch"));
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
        toast(totalClaimed > 0 ? t("batchScan.processedPhotos", { count: totalClaimed }) : t("batchScan.nothingToProcess"));
      }
    } catch (e) {
      console.warn("[AURA batch-scan] worker trigger failed", e);
      if (opts.announce) toast.error(t("batchScan.couldntReachWorker"));
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

  const onFindPhotos = async () => {
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
    setLabel(t("batchScan.lookingForPhotosOnLinks", { count: urls.length }));
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await resolveCandidates({ data: { urls, accessToken: sess.session?.access_token } });
      setUrlCandidates(res.results);
      const defaults: Record<string, number> = {};
      res.results.forEach((r) => { if (r.ok) defaults[r.url] = 0; });
      setChosenIndex(defaults);
      const failedCount = res.results.filter((r) => !r.ok).length;
      if (failedCount) toast.warning(t("batchScan.linksCouldntBeRead", { count: failedCount }));
    } catch (e) {
      console.error("[AURA batch-scan] candidate lookup failed", e);
      toast.error(t("batchScan.couldntLookUpLinks"));
    } finally {
      setBusy(false);
      setLabel("");
    }
  };

  const onQueueSelections = async () => {
    if (!urlCandidates) return;
    const selections = urlCandidates
      .filter((r): r is Extract<UrlCandidateResult, { ok: true }> => r.ok)
      .map((r) => ({
        sourceUrl: r.url,
        chosenImageUrl: r.candidates[chosenIndex[r.url] ?? 0] ?? r.candidates[0],
        brand: r.brand,
        priceValue: r.priceValue,
        priceCurrency: r.priceCurrency,
        materials: r.materials,
      }));
    if (!selections.length) return;
    setBusy(true);
    setLabel(t("batchScan.queueingPhotos", { count: selections.length }));
    try {
      const res = await queueSelections({ data: { selections } });
      if (!res.scanId) {
        toast.error(res.error ?? t("batchScan.couldNotQueuePhotos"));
        return;
      }
      const failedCount = res.failed?.length ?? 0;
      toast.success(
        failedCount
          ? t("batchScan.queuedSomeFailed", { queued: res.jobs, failed: failedCount })
          : t("batchScan.photosQueued", { count: res.jobs }),
      );
      setUrlRows([""]);
      setUrlCandidates(null);
      setChosenIndex({});
      await runWorker();
    } catch (e) {
      console.error("[AURA batch-scan] queueing selections failed", e);
      toast.error(t("batchScan.couldNotQueuePhotos"));
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
      toast.warning(t("batchScan.onlyFirstNPhotosUsed", { count: MAX_BATCH_PHOTOS }));
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
        const CONCURRENCY = picked.length > 40 ? 2 : 3;
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
        setLabel(t("batchScan.queueing"));
        await create({ data: { paths } });
        const failedCount = failures.length;
        toast.success(
          failedCount
            ? t("batchScan.uploadedSomeFailed", { queued: paths.length, failed: failedCount })
            : t("batchScan.photosQueued", { count: paths.length }),
        );
        await runWorker();
      } else {
        toast.error(t("batchScan.noneCouldBeUploaded"));
      }
    } catch (e) {
      console.error("[AURA batch-scan] queueing failed", e);
      toast.error(
        paths.length
          ? t("batchScan.uploadedButNotQueued")
          : t("batchScan.couldNotQueuePhotos"),
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
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("batchScan.wardrobe")}</p>
          <h1 className="font-serif text-2xl italic leading-tight">{t("batchScan.batchScan")}</h1>
        </div>
      </header>

      <div className="mx-6 mt-6">
        <div className="flex rounded-full border border-border p-1 mb-4">
          <button
            onClick={() => setMode("photos")}
            className={`flex-1 h-9 rounded-full text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 ${mode === "photos" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          ><Images size={12} /> {t("batchScan.fromPhotos")}</button>
          <button
            onClick={() => setMode("urls")}
            className={`flex-1 h-9 rounded-full text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 ${mode === "urls" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          ><Link2 size={12} /> {t("batchScan.fromUrls")}</button>
        </div>

        {mode === "photos" && (
          <>
            <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center">
              <Images size={22} className="mx-auto text-muted-foreground" />
              <p className="mt-4 font-serif text-lg italic">{t("batchScan.uploadSeveralPhotos")}</p>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {t("batchScan.uploadHint")}
              </p>
              <button
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="mt-6 h-12 w-full rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] disabled:opacity-50"
              >{busy
                ? (photoStates.length
                    ? t("batchScan.nOfMUploaded", { done: photoStates.filter((p) => p.status === "uploaded").length, total: photoStates.length })
                    : label || t("batchScan.working"))
                : t("batchScan.choosePhotos")}</button>
              {busy && photoStates.some((p) => p.status === "failed") && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {t("batchScan.photosFailedSoFar", { count: photoStates.filter((p) => p.status === "failed").length })}
                </p>
              )}
            </div>
            <input
              ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => onPick(e.target.files)}
            />
          </>
        )}

        {mode === "urls" && !urlCandidates && (
          <div className="rounded-3xl border-2 border-dashed border-border p-6">
            <p className="font-serif text-lg italic text-center">{t("batchScan.pastLinks")}</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed text-center">
              {t("batchScan.pasteLinksHint")}
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
                    aria-label={t("batchScan.removeUrlAria")}
                    className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center shrink-0 active:scale-90"
                  ><X size={12} /></button>
                </div>
              ))}
            </div>
            <button
              onClick={addUrlRow}
              className="mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
            ><Plus size={12} /> {t("batchScan.addUrl")}</button>
            <button
              disabled={busy}
              onClick={onFindPhotos}
              className="mt-5 h-12 w-full rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] disabled:opacity-50"
            >{busy ? label || t("batchScan.working") : t("batchScan.findPhotos")}</button>
          </div>
        )}

        {mode === "urls" && urlCandidates && (
          <div className="rounded-3xl border-2 border-dashed border-border p-5">
            <div className="flex items-center justify-between">
              <p className="font-serif text-lg italic">{t("batchScan.chooseAPhotoForEach")}</p>
              <button
                onClick={() => { setUrlCandidates(null); setChosenIndex({}); }}
                className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
              >{t("batchScan.startOver")}</button>
            </div>
            <div className="mt-4 space-y-4">
              {urlCandidates.map((r) => (
                <div key={r.url} className="rounded-2xl border border-border/60 p-3">
                  <p className="text-[11px] text-muted-foreground truncate mb-2">{r.url}</p>
                  {!r.ok ? (
                    <p className="text-xs text-destructive">{r.error}</p>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto no-scrollbar">
                      {r.candidates.map((c, idx) => {
                        const key = `${r.url}::${c}`;
                        const broken = brokenCandidates[key];
                        const selected = (chosenIndex[r.url] ?? 0) === idx;
                        return (
                          <button
                            key={c}
                            disabled={broken}
                            onClick={() => setChosenIndex((prev) => ({ ...prev, [r.url]: idx }))}
                            className={`shrink-0 h-20 w-20 rounded-xl overflow-hidden border-2 flex items-center justify-center ${selected && !broken ? "border-foreground" : "border-transparent"} ${broken ? "opacity-40" : ""}`}
                            style={{ background: "#FFFFFF" }}
                          >
                            {broken ? (
                              <span className="text-[9px] text-muted-foreground px-1 text-center leading-tight">{t("batchScan.unavailable")}</span>
                            ) : (
                              <img
                                src={c}
                                alt=""
                                className="h-full w-full object-contain p-1"
                                loading="lazy"
                                onError={() => {
                                  setBrokenCandidates((prev) => ({ ...prev, [key]: true }));
                                  setChosenIndex((prev) => (prev[r.url] === idx ? { ...prev, [r.url]: 0 } : prev));
                                }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {r.ok && r.brand && (
                    <p className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground">{r.brand}</p>
                  )}
                </div>
              ))}
            </div>
            <button
              disabled={busy || !urlCandidates.some((r) => r.ok)}
              onClick={onQueueSelections}
              className="mt-5 h-12 w-full rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] disabled:opacity-50"
            >{busy ? label || t("batchScan.working") : t("batchScan.queueNPhotos", { count: urlCandidates.filter((r) => r.ok).length })}</button>
          </div>
        )}
      </div>

      <div className="mx-6 mt-8">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("batchScan.yourBatches")}</p>
          <button
            onClick={() => runWorker({ announce: true })}
            disabled={processingNow}
            className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-50"
          >
            {processingNow ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {t("batchScan.process")}
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {scans.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("batchScan.noBatchesYet")}</p>
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
                  <p className="text-sm">{t("batchScan.photosCount", { count: s.total_photos })}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {statusLabel(s.status)} · {new Date(s.created_at).toLocaleString(i18n.language)}
                  </p>
                  {!ready && (c.queued + c.processing + c.done + c.failed > 0) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ✓ {t("batchScan.doneCount", { count: c.done })}{c.processing ? ` · ⏳ ${t("batchScan.processingCount", { count: c.processing })}` : ""}{c.queued ? ` · ${t("batchScan.queuedCount", { count: c.queued })}` : ""}{c.failed ? ` · ⚠ ${t("batchScan.failedCount", { count: c.failed })}` : ""}
                    </p>
                  )}
                </button>
                {!ready && <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />}
                {reviewable && (
                  <button onClick={() => openReview(s.id)} className="text-[10px] uppercase tracking-[0.25em] shrink-0">
                    {t("batchScan.review")}
                  </button>
                )}
                <button
                  onClick={() => deleteScan(s.id)}
                  aria-label={t("batchScan.removeBatchAria")}
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
