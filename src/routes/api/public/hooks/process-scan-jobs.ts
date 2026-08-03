// Manually callable Batch Outfit Scan worker.
// No cron yet: POST here with the project apikey header to drain queued jobs.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/process-scan-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Must be a real server-only secret: the publishable key ships in
        // the browser bundle and is not a credential.
        const expected = process.env.SCAN_WORKER_SECRET;
        const provided =
          request.headers.get("x-worker-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!expected || provided !== expected) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let limit = 5;
        try {
          const body = (await request.json()) as { limit?: number } | null;
          if (body?.limit && Number.isFinite(body.limit)) {
            limit = Math.max(1, Math.min(20, Math.floor(body.limit)));
          }
        } catch {
          /* empty body is fine */
        }

        try {
          const { runScanWorker } = await import("@/lib/batch-scan.server");
          const result = await runScanWorker(limit);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[AURA batch-scan] worker failed", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "worker failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
