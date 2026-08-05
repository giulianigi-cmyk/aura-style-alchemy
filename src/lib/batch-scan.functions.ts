import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { checkPublicUrl } from "./safe-url";
import { fetchImageAsDataUrl } from "./fetch-image";
import {
  ConfirmDetectedItemsSchema,
  CreateBatchScanSchema,
  CreateBatchScanFromUrlsSchema,
  DetectedIdSchema,
  ScanIdSchema,
} from "./batch-scan-schemas";

/** Shared by both intake paths (file upload, URL import): register a
 *  batch_scans row plus one scan_jobs row per already-stored image path.
 *  Runs under the caller's own RLS-scoped client — never service role. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertBatchAndJobs(supabase: any, userId: string, paths: string[]) {
  const { data: scan, error } = await supabase
    .from("batch_scans")
    .insert({ user_id: userId, status: "queued", total_photos: paths.length })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const jobs = paths.map((p) => ({
    scan_id: scan.id,
    user_id: userId,
    image_path: p,
    status: "queued" as const,
  }));
  const { error: jobErr } = await supabase.from("scan_jobs").insert(jobs);
  if (jobErr) throw new Error(jobErr.message);

  return { scanId: scan.id as string, jobs: jobs.length };
}

/** Create a batch after the client has uploaded the originals to storage. */
export const createBatchScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateBatchScanSchema.parse(input))
  .handler(async ({ data, context }) => {
    return insertBatchAndJobs(context.supabase, context.userId, data.paths);
  });

/** data:URL -> raw bytes, mirroring the encode side in batch-scan.server.ts.
 *  No Buffer here: this runs on the same Worker-style runtime as the rest
 *  of the scan pipeline. */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data URL");
  const contentType = match[1] || "image/jpeg";
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

/** Small concurrency-limited map: 150 URLs fetched 4-at-a-time so we don't
 *  hold ~150 x up to 8MB of image data in memory at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Create a batch from pasted image URLs: fetch + upload server-side,
 *  then feed into the same batch_scans/scan_jobs pipeline as file uploads —
 *  the worker (detection, dedupe, categorisation) doesn't know or care
 *  which intake path produced the stored image. A URL that fails to
 *  download is reported back and skipped; it never fails the whole batch. */
export const createBatchScanFromUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateBatchScanFromUrlsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // De-dupe pasted lines up front (users often paste the same link twice).
    const urls = Array.from(new Set(data.urls.filter(Boolean)));

    const outcomes = await mapWithConcurrency(urls, 4, async (rawUrl, i) => {
      const publicErr = checkPublicUrl(rawUrl);
      if (publicErr) return { url: rawUrl, ok: false as const, error: publicErr };

      const dl = await fetchImageAsDataUrl(rawUrl);
      if (!dl.ok) return { url: rawUrl, ok: false as const, error: dl.error };

      try {
        const { bytes, contentType } = dataUrlToBytes(dl.dataUrl);
        const path = `${userId}/batch/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.${extFromContentType(contentType)}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("wardrobe")
          .upload(path, bytes, { cacheControl: "3600", upsert: false, contentType });
        if (upErr) return { url: rawUrl, ok: false as const, error: upErr.message };
        return { url: rawUrl, ok: true as const, path };
      } catch (err) {
        return { url: rawUrl, ok: false as const, error: err instanceof Error ? err.message : "download failed" };
      }
    });

    const paths = outcomes.filter((o) => o.ok).map((o) => (o as { path: string }).path);
    const failed = outcomes.filter((o) => !o.ok) as { url: string; ok: false; error: string }[];

    if (!paths.length) {
      return { scanId: null, jobs: 0, failed, error: "None of those URLs could be downloaded." };
    }

    const { scanId, jobs } = await insertBatchAndJobs(supabase, userId, paths);
    return { scanId, jobs, failed };
  });

export const deleteBatchScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ScanIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("batch_scans").delete().eq("id", data.scanId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listBatchScans = createServerFn({ method: "GET" })

  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: scans, error } = await context.supabase
      .from("batch_scans")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);

    const ids = (scans ?? []).map((s) => s.id);
    type Counts = { queued: number; processing: number; done: number; failed: number };
    const countsByScan: Record<string, Counts> = {};

    if (ids.length) {
      // One extra query for ALL jobs across the visible batches, instead of
      // one count query per batch — keeps this at 2 round-trips regardless
      // of how many batches are shown.
      const { data: jobs, error: jobErr } = await context.supabase
        .from("scan_jobs")
        .select("scan_id, status")
        .in("scan_id", ids);
      if (jobErr) throw new Error(jobErr.message);
      for (const j of jobs ?? []) {
        const c = (countsByScan[j.scan_id] ??= { queued: 0, processing: 0, done: 0, failed: 0 });
        if (j.status === "queued") c.queued++;
        else if (j.status === "processing") c.processing++;
        else if (j.status === "done") c.done++;
        else if (j.status === "failed") c.failed++;
      }
    }

    return (scans ?? []).map((s) => ({
      ...s,
      jobCounts: countsByScan[s.id] ?? { queued: 0, processing: 0, done: 0, failed: 0 },
    }));
  });

export const getBatchScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ScanIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: scan, error } = await supabase
      .from("batch_scans").select("*").eq("id", data.scanId).maybeSingle();
    if (error) throw new Error(error.message);
    const { data: jobs, error: jobErr } = await supabase
      .from("scan_jobs").select("*").eq("scan_id", data.scanId).order("created_at");
    if (jobErr) throw new Error(jobErr.message);
    return { scan, jobs: jobs ?? [] };
  });

export const listDetectedItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ScanIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: items, error } = await context.supabase
      .from("scan_detected_items")
      .select("*")
      .eq("scan_id", data.scanId)
      .eq("status", "pending")
      .order("created_at");
    if (error) throw new Error(error.message);
    const { data: jobs } = await context.supabase
      .from("scan_jobs").select("id, image_path").eq("scan_id", data.scanId);
    return { items: items ?? [], jobs: jobs ?? [] };
  });

export const rejectDetectedItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DetectedIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Verify the caller actually owns this detected item before touching it —
    // scan_detected_items has no client-side update policy, so this check
    // (plus the .eq("user_id", ...) below) is what stands between "your own
    // item" and "any item".
    const { data: row, error: findErr } = await supabaseAdmin
      .from("scan_detected_items").select("id").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!row) throw new Error("Item not found");

    const { error } = await supabaseAdmin
      .from("scan_detected_items").update({ status: "rejected" }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Human-confirmed detections become real wardrobe items. */
export const confirmDetectedItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConfirmDetectedItemsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: { id: string; ok: boolean; error?: string }[] = [];

    // Verify every submitted id actually belongs to this user up front —
    // scan_detected_items has no client-side update policy, so this is the
    // only check standing between "your own detections" and "any row".
    const ids = data.items.map((it) => it.id);
    const { data: owned, error: ownErr } = await supabaseAdmin
      .from("scan_detected_items").select("id").in("id", ids).eq("user_id", userId);
    if (ownErr) throw new Error(ownErr.message);
    const ownedIds = new Set((owned ?? []).map((r) => r.id));

    for (const it of data.items) {
      if (!ownedIds.has(it.id)) {
        results.push({ id: it.id, ok: false, error: "Item not found" });
        continue;
      }
      try {
        const { error: insErr } = await supabase.from("wardrobe_items").insert({
          user_id: userId,
          image_url: it.image_path,
          category: it.category || null,
          subcategory: it.subcategory || null,
          brand: it.brand?.trim() || null,
          color: it.colors[0] ?? null,
          colors: it.colors,
          material: it.material,
          season: it.season || null,
          style: it.style || null,
          occasion: it.occasion || null,
         price: it.price ?? null,
          currency: it.price != null ? it.currency || null : null,
          size: it.size || null,
          purchase_date: it.purchase_date || null,
          source: "batch_scan",
        } as never);
        if (insErr) throw new Error(insErr.message);

        const { error: updErr } = await supabaseAdmin
          .from("scan_detected_items").update({ status: "confirmed" }).eq("id", it.id).eq("user_id", userId);
        if (updErr) throw new Error(updErr.message);

        results.push({ id: it.id, ok: true });
      } catch (err) {
        results.push({ id: it.id, ok: false, error: err instanceof Error ? err.message : "failed" });
      }
    }

    return { results, confirmed: results.filter((r) => r.ok).length };
  });

/** Authenticated in-app trigger for the scan worker.
 *  The public /api/public/hooks/process-scan-jobs route stays reserved for
 *  trusted callers holding SCAN_WORKER_SECRET (cron/ops). */
export const triggerScanWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { runScanWorker } = await import("./batch-scan.server");
    return await runScanWorker(10);
  });
