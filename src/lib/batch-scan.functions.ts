import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import {
  ConfirmDetectedItemsSchema,
  CreateBatchScanSchema,
  DetectedIdSchema,
  ScanIdSchema,
} from "./batch-scan-schemas";

/** Create a batch after the client has uploaded the originals to storage. */
export const createBatchScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateBatchScanSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: scan, error } = await supabase
      .from("batch_scans")
      .insert({ user_id: userId, status: "queued", total_photos: data.paths.length })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const jobs = data.paths.map((p) => ({
      scan_id: scan.id,
      user_id: userId,
      image_path: p,
      status: "queued" as const,
    }));
    const { error: jobErr } = await supabase.from("scan_jobs").insert(jobs);
    if (jobErr) throw new Error(jobErr.message);

    return { scanId: scan.id as string, jobs: jobs.length };
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
    const { data, error } = await context.supabase
      .from("batch_scans")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
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
    return await runScanWorker(5);
  });
