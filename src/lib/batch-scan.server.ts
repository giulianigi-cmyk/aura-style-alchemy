// Batch Outfit Scan worker core — SERVER ONLY.
// Claims scan_jobs via the service-role RPC, runs the existing
// analyzeOutfit detection engine, and writes suggestions into
// scan_detected_items. Never writes wardrobe_items: every detection
// must be confirmed by the user first.
import { detectOutfitItems } from "./outfit-detect.server";
import { analyzeWardrobeImageCore } from "./ai-analyze.functions";
import { removeBackgroundCore } from "./ai-bgremove.functions";

const MAX_ATTEMPTS = 3;
const BUCKET = "wardrobe";

function toDataUrl(bytes: ArrayBuffer, contentType: string): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  return `data:${contentType || "image/jpeg"};base64,${b64}`;
}

type JobPrefill = { brand?: string | null; priceValue?: number | null; priceCurrency?: string | null; materials?: string[]; sourceUrl?: string } | null;

export type WorkerResult = {
  claimed: number;
  done: number;
  failed: number;
  requeued: number;
  detected: number;
  scans: string[];
};

export async function runScanWorker(limit = 5): Promise<WorkerResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: jobs, error: claimErr } = await supabaseAdmin.rpc("claim_scan_jobs", { _limit: limit });
  if (claimErr) throw new Error(`claim_scan_jobs failed: ${claimErr.message}`);

  const claimed = jobs ?? [];
  const result: WorkerResult = {
    claimed: claimed.length, done: 0, failed: 0, requeued: 0, detected: 0, scans: [],
  };
  const touchedScans = new Set<string>();

  for (const job of claimed) {
    touchedScans.add(job.scan_id);
    try {
      const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(job.image_path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "download failed");

      let dataUrl = toDataUrl(await blob.arrayBuffer(), blob.type || "image/jpeg");
      const prefill = (job as { prefill?: JobPrefill }).prefill ?? null;

            if (prefill) {
        // A single transient failure here (network blip, a momentary
        // remove.bg hiccup) used to silently skip background removal for
        // that one photo — rare enough to go unnoticed at 3-4 photos, but
        // at 100 photos the odds of hitting it at least once approach
        // certainty. Retry before giving up.
        let bg = await removeBackgroundCore(dataUrl);
        let bgAttempt = 1;
        while (!bg.ok && bgAttempt < 3) {
          await new Promise((r) => setTimeout(r, 800 * bgAttempt));
          bg = await removeBackgroundCore(dataUrl);
          bgAttempt++;
        }
        if (bg.ok) {

          const newPath = `${job.user_id}/batch/${Date.now()}-bg-${Math.random().toString(36).slice(2)}.png`;
          const bgBlob = await (await fetch(bg.imageDataUrl)).blob();
          const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(newPath, bgBlob, {
            cacheControl: "3600", upsert: false, contentType: "image/png",
          });
          if (!upErr) {
            await supabaseAdmin.from("scan_jobs").update({ image_path: newPath }).eq("id", job.id);
            job.image_path = newPath;
            dataUrl = bg.imageDataUrl;
          } else {
            console.warn("[AURA batch-scan] bg-removed upload failed, keeping original", upErr.message);
          }
        } else {
          console.warn("[AURA batch-scan] bg removal failed for URL-sourced job", job.id, bg.error);
        }
      }

      let detectedRows: {
        category: string | null; subcategory: string | null; colors: string[]; material: string[];
        season: string | null; style: string | null; occasion: string | null; description: string | null;
        confidence: number; bbox: unknown; brand: string | null; price: number | null; currency: string | null;
      }[];

      if (prefill) {
        // Single product photo from a URL — same engine as manual
        // "Import from URL" single-item add, not the multi-item outfit
        // detector (which is tuned to find several worn garments and can
        // mistake a decorative detail — a buckle, an embellishment — for
        // a second item on an isolated product photo).
        const analysis = await analyzeWardrobeImageCore(dataUrl);
                detectedRows = [{
          category: analysis.category || null,
          subcategory: analysis.subcategory || null,
          colors: analysis.colors,
          material: prefill.materials?.length ? prefill.materials : analysis.materials,
          season: analysis.seasons[0] ?? null,
          style: analysis.styles.join(", ") || null,
          occasion: analysis.occasions.join(", ") || null,
          description: null,
          confidence: 0.9,
          bbox: null,
          brand: analysis.brand || prefill.brand || null,
          price: prefill.priceValue ?? null,
          currency: prefill.priceCurrency ?? null,
          formality: analysis.formality ?? null,
          day_evening: analysis.dayEvening || null,
        }];
      } else {
        const detection = await detectOutfitItems(dataUrl);
        if (!detection.ok) throw new Error(detection.error);
        detectedRows = detection.items.map((it) => ({
          category: it.category || null,
          subcategory: it.subcategory || null,
          colors: it.colors,
          material: it.materials,
          season: it.seasons[0] ?? null,
          style: null,
          occasion: null,
          description: it.description || null,
          confidence: it.confidence,
          bbox: it.bbox,
          brand: null,
          price: null,
          currency: null,
        }));
      }

      await supabaseAdmin.from("scan_detected_items").delete().eq("job_id", job.id);

      if (detectedRows.length) {
        const rows = detectedRows.map((it) => ({
          job_id: job.id,
          scan_id: job.scan_id,
          user_id: job.user_id,
          ...it,
          status: "pending" as const,
        }));
        const { error: insErr } = await supabaseAdmin.from("scan_detected_items").insert(rows as never);
        if (insErr) throw new Error(insErr.message);
        result.detected += rows.length;
      }

      await supabaseAdmin
        .from("scan_jobs")
        .update({ status: "done", error_message: null })
        .eq("id", job.id);
      result.done++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.error("[AURA batch-scan] job failed", job.id, message);
      const giveUp = (job.attempts ?? 1) >= MAX_ATTEMPTS;
      await supabaseAdmin
        .from("scan_jobs")
        .update({
          status: giveUp ? "failed" : "queued",
          claimed_at: null,
          error_message: message.slice(0, 500),
        })
        .eq("id", job.id);
      if (giveUp) result.failed++;
      else result.requeued++;
    }
  }

  for (const scanId of touchedScans) {
    await finalizeScan(scanId);
    result.scans.push(scanId);
  }

  return result;
}

/** Flip a batch to done / done_with_errors once no job is left to process. */
export async function finalizeScan(scanId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: jobs } = await supabaseAdmin
    .from("scan_jobs")
    .select("status, user_id")
    .eq("scan_id", scanId);
  if (!jobs?.length) return;

  const pending = jobs.filter((j) => j.status === "queued" || j.status === "processing").length;
  if (pending > 0) {
    await supabaseAdmin.from("batch_scans").update({ status: "processing" }).eq("id", scanId);
    return;
  }

  const failed = jobs.filter((j) => j.status === "failed").length;
  const status = failed > 0 ? "done_with_errors" : "done";

  const { data: scan } = await supabaseAdmin
    .from("batch_scans")
    .select("id, status, user_id")
    .eq("id", scanId)
    .maybeSingle();
  if (!scan || scan.status === "done" || scan.status === "done_with_errors") return;

  await supabaseAdmin.from("batch_scans").update({ status }).eq("id", scanId);

  const { count } = await supabaseAdmin
    .from("scan_detected_items")
    .select("id", { count: "exact", head: true })
    .eq("scan_id", scanId)
    .eq("status", "pending");

  await supabaseAdmin.from("notifications").insert({
    user_id: scan.user_id,
    type: "batch_scan_ready",
    title: failed > 0 ? "Batch scan finished with errors" : "Batch scan ready to review",
    body: `${count ?? 0} piece${count === 1 ? "" : "s"} detected${failed > 0 ? ` · ${failed} photo${failed === 1 ? "" : "s"} failed` : ""}.`,
    data: { scan_id: scanId, status },
  });
}
