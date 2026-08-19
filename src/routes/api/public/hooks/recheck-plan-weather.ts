// Hourly weather re-check for planned outfits. Called by pg_cron
// (recheck_plan_weather_if_needed) with the shared worker secret — same
// pattern as process-scan-jobs.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/recheck-plan-weather")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Server-only secret: this worker writes for every user with
        // service-role privileges, so it can never be publicly callable.
        const expected = process.env.SCAN_WORKER_SECRET;
        const provided =
          request.headers.get("x-worker-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!expected || provided !== expected) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let limit = 200;
        try {
          const body = (await request.json()) as { limit?: number } | null;
          if (body?.limit && Number.isFinite(body.limit)) {
            limit = Math.max(1, Math.min(500, Math.floor(body.limit)));
          }
        } catch {
          /* empty body is fine */
        }

        try {
          const { runPlanWeatherRecheck } = await import("@/lib/plan-weather.server");
          const result = await runPlanWeatherRecheck(limit);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[AURA plan-weather] worker failed", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : "worker failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
