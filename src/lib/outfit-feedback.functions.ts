import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  itemIds: z.array(z.string()).min(1).max(20),
  feedbackType: z.enum(["worn", "saved", "liked", "disliked", "opened", "viewed"]),
  sessionId: z.string().uuid().nullable().optional(),
  outfitId: z.string().uuid().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  context: z.record(z.string(), z.string()).nullable().optional(),
  // es. { occasion: "cena elegante", season: "estate" }
});

export const submitOutfitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error: insertErr } = await context.supabase.from("outfit_feedback").insert({
      user_id: context.userId,
      session_id: data.sessionId ?? null,
      outfit_id: data.outfitId ?? null,
      item_ids: data.itemIds,
      feedback_type: data.feedbackType,
      rating: data.rating ?? null,
      feedback_reason: data.reason ?? null,
      context: data.context ?? null,
    });
    if (insertErr) throw new Error(`outfit_feedback insert failed: ${insertErr.message}`);

    // Aggregazione sincrona, poche righe: evita di dover mettere su un
    // worker/cron per un MVP a basso volume (stesso principio del D6 —
    // niente infrastruttura in più del necessario).
    const { runStyleMemoryAggregator } = await import("./style-memory-aggregator.server");
    try {
      await runStyleMemoryAggregator(20);
    } catch (err) {
      // Il feedback è comunque salvato; l'aggregazione recupera al
      // prossimo giro — non deve mai bloccare l'azione dell'utente.
      console.error("[submitOutfitFeedback] aggregator run failed", err);
    }

    return { ok: true as const };
  });
