import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { checkPublicUrl } from "./safe-url";
import { fetchImageAsDataUrl } from "./fetch-image";
import { resolveProductImageUrl } from "./import-url.functions";
import {
  ConfirmDetectedItemsSchema,
  CreateBatchScanSchema,
  CreateBatchScanFromUrlsSchema,
  ResolveBatchUrlCandidatesSchema,
  CreateBatchScanFromSelectionsSchema,
  DetectedIdSchema,
  ScanIdSchema,
} from "./batch-scan-schemas";

async function insertBatchAndJobs(
  supabase: any, userId: string, paths: string[],
  prefillByPath?: Record<string, { brand?: string | null; priceValue?: number | null; priceCurrency?: string | null; materials?: string[]; sourceUrl?: string }>,
) {
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
    prefill: prefillByPath?.[p] ?? null,
  }));
  const { error: jobErr } = await supabase.from("scan_jobs").insert(jobs);
  if (jobErr) throw new Error(jobErr.message);

  return { scanId: scan.id as string, jobs: jobs.length };
}

export const createBatchScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateBatchScanSchema.parse(input))
  .handler(async ({ data, context }) => {
    return insertBatchAndJobs(context.supabase, context.userId, data.paths);
  });

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

export const createBatchScanFromUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateBatchScanFromUrlsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const urls = Array.from(new Set(data.urls.filter(Boolean)));

    type Prefill = { brand?: string | null; priceValue?: number | null; priceCurrency?: string | null; materials?: string[]; sourceUrl?: string };
    type Outcome =
      | { url: string; ok: true; path: string; prefill?: Prefill }
      | { url: string; ok: false; error: string };

    const outcomes: Outcome[] = await mapWithConcurrency(urls, 4, async (rawUrl, i): Promise<Outcome> => {
      const publicErr = checkPublicUrl(rawUrl);
      if (publicErr) return { url: rawUrl, ok: false, error: publicErr };

      let dl = await fetchImageAsDataUrl(rawUrl);
      let prefill: Prefill | undefined;
      if (!dl.ok || !/^data:image\//.test(dl.dataUrl)) {
        const originalError = dl.ok ? "That link isn't a product page with a usable image." : dl.error;
        const resolved = await resolveProductImageUrl(rawUrl, data.accessToken);
        if (!resolved.ok) {
          return { url: rawUrl, ok: false, error: originalError };
        }
        dl = await fetchImageAsDataUrl(resolved.imageUrl, rawUrl);
        if (!dl.ok || !/^data:image\//.test(dl.dataUrl)) {
          return { url: rawUrl, ok: false, error: dl.ok ? "Found the page but couldn't download its image." : dl.error };
        }
        prefill = {
          brand: resolved.brand || null,
          priceValue: resolved.priceValue,
          priceCurrency: resolved.priceCurrency,
          materials: resolved.materials,
          sourceUrl: rawUrl,
        };
      }

      try {
        const { bytes, contentType } = dataUrlToBytes(dl.dataUrl);
        const path = `${userId}/batch/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.${extFromContentType(contentType)}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("wardrobe")
          .upload(path, bytes, { cacheControl: "3600", upsert: false, contentType });
        if (upErr) return { url: rawUrl, ok: false, error: upErr.message };
        return { url: rawUrl, ok: true, path, prefill };
      } catch (err) {
        return { url: rawUrl, ok: false, error: err instanceof Error ? err.message : "download failed" };
      }
    });

    const succeeded = outcomes.filter((o): o is Extract<Outcome, { ok: true }> => o.ok);
    const paths = succeeded.map((o) => o.path);
    const failed = outcomes.filter((o): o is Extract<Outcome, { ok: false }> => !o.ok);

    if (!paths.length) {
      return { scanId: null, jobs: 0, failed, error: "None of those URLs could be downloaded." };
    }

    const prefillByPath: Record<string, Prefill> = {};
    for (const o of succeeded) if (o.prefill) prefillByPath[o.path] = o.prefill;

    const { scanId, jobs } = await insertBatchAndJobs(supabase, userId, paths, prefillByPath);
    return { scanId, jobs, failed };
  });

export type UrlCandidateResult =
  | { url: string; ok: true; candidates: string[]; brand: string | null; priceValue: number | null; priceCurrency: string | null; materials: string[] }
  | { url: string; ok: false; error: string };

/**
 * Step 1 of the "choose your photo" flow — finds candidate images for
 * each URL WITHOUT downloading or uploading anything yet, so the person
 * can pick before any storage/AI cost is spent. Mirrors what the
 * single-item "Import from URL" flow already offers (multiple photo
 * candidates to choose from) instead of silently auto-picking one.
 */
export const resolveBatchUrlCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResolveBatchUrlCandidatesSchema.parse(input))
  .handler(async ({ data }) => {
    const urls = Array.from(new Set(data.urls.filter(Boolean)));

    const results: UrlCandidateResult[] = await mapWithConcurrency(urls, 4, async (rawUrl): Promise<UrlCandidateResult> => {
      const publicErr = checkPublicUrl(rawUrl);
      if (publicErr) return { url: rawUrl, ok: false, error: publicErr };

      const dl = await fetchImageAsDataUrl(rawUrl);
      if (dl.ok && /^data:image\//.test(dl.dataUrl)) {
        return { url: rawUrl, ok: true, candidates: [rawUrl], brand: null, priceValue: null, priceCurrency: null, materials: [] };
      }

      const resolved = await resolveProductImageUrl(rawUrl, data.accessToken);
      if (!resolved.ok) {
        return { url: rawUrl, ok: false, error: dl.ok ? "That link isn't a product page with a usable image." : resolved.error };
      }
      return {
        url: rawUrl, ok: true, candidates: resolved.candidates,
        brand: resolved.brand || null, priceValue: resolved.priceValue, priceCurrency: resolved.priceCurrency,
        materials: resolved.materials,
      };
    });

    return { results };
  });

/**
 * Step 2 — once the person has picked a photo per URL (see
 * resolveBatchUrlCandidates above), this actually downloads and queues
 * them. No re-resolution happens here — the chosen image and metadata
 * are taken as given.
 */
export const createBatchScanFromSelections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateBatchScanFromSelectionsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    type Prefill = { brand?: string | null; priceValue?: number | null; priceCurrency?: string | null; materials?: string[]; sourceUrl?: string };
    type Outcome =
      | { url: string; ok: true; path: string; prefill: Prefill }
      | { url: string; ok: false; error: string };

    const outcomes: Outcome[] = await mapWithConcurrency(data.selections, 4, async (sel, i): Promise<Outcome> => {
      const publicErr = checkPublicUrl(sel.chosenImageUrl);
      if (publicErr) return { url: sel.sourceUrl, ok: false, error: publicErr };

      const dl = await fetchImageAsDataUrl(sel.chosenImageUrl, sel.sourceUrl);
      if (!dl.ok || !/^data:image\//.test(dl.dataUrl)) {
        return { url: sel.sourceUrl, ok: false, error: dl.ok ? "Couldn't download that image." : dl.error };
      }

      try {
        const { bytes, contentType } = dataUrlToBytes(dl.dataUrl);
        const path = `${userId}/batch/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.${extFromContentType(contentType)}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("wardrobe")
          .upload(path, bytes, { cacheControl: "3600", upsert: false, contentType });
        if (upErr) return { url: sel.sourceUrl, ok: false, error: upErr.message };
        return {
          url: sel.sourceUrl, ok: true, path,
          prefill: { brand: sel.brand, priceValue: sel.priceValue, priceCurrency: sel.priceCurrency, materials: sel.materials, sourceUrl: sel.sourceUrl },
        };
      } catch (err) {
        return { url: sel.sourceUrl, ok: false, error: err instanceof Error ? err.message : "download failed" };
      }
    });

    const succeeded = outcomes.filter((o): o is Extract<Outcome, { ok: true }> => o.ok);
    const paths = succeeded.map((o) => o.path);
    const failed = outcomes.filter((o): o is Extract<Outcome, { ok: false }> => !o.ok);

    if (!paths.length) {
      return { scanId: null, jobs: 0, failed, error: "None of those photos could be downloaded." };
    }

    const prefillByPath: Record<string, Prefill> = {};
    for (const o of succeeded) prefillByPath[o.path] = o.prefill;

    const { scanId, jobs } = await insertBatchAndJobs(supabase, userId, paths, prefillByPath);
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
    const { data: row, error: findErr } = await supabaseAdmin
      .from("scan_detected_items").select("id").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!row) throw new Error("Item not found");

    const { error } = await supabaseAdmin
      .from("scan_detected_items").update({ status: "rejected" }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const confirmDetectedItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConfirmDetectedItemsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: { id: string; ok: boolean; error?: string }[] = [];

        const ids = data.items.map((it) => it.id);
    const { data: owned, error: ownErr } = await supabaseAdmin
      .from("scan_detected_items").select("id").in("id", ids).eq("user_id", userId);
    if (ownErr) throw new Error(ownErr.message);
    const ownedIds = new Set((owned ?? []).map((r) => r.id));

    const { data: profileRow } = await (supabase.from("profiles" as never) as any)
      .select("active_location_id").eq("id", userId).maybeSingle();
    const activeLocationId = (profileRow as { active_location_id: string | null } | null)?.active_location_id ?? null;

    for (const it of data.items) {
      if (!ownedIds.has(it.id)) {
        results.push({ id: it.id, ok: false, error: "Item not found" });
        continue;
      }
      try {
                        const { error: insErr } = await supabase.from("wardrobe_items").insert({
          user_id: userId,
          image_url: it.image_path,
          thumbnail_path: it.thumbnail_path ?? null,
          category: it.category || null,
          subcategory: it.subcategory || null,
          brand: it.brand?.trim() || null,
          color: it.colors[0] ?? null,
          colors: it.colors,
          material: it.material,
          season: it.season || null,
          style: it.style || null,
          occasion: it.occasion || null,
                    formality: it.formality ?? null,
          day_evening: it.day_evening || null,
          sleeve_length: it.sleeve_length || null,
         price: it.price ?? null,
          currency: it.price != null ? it.currency || null : null,
          size: it.size || null,
          purchase_date: it.purchase_date || null,
          source: "batch_scan",
          location_id: activeLocationId,
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

export const triggerScanWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { runScanWorker } = await import("./batch-scan.server");
    return await runScanWorker(10);
  });
