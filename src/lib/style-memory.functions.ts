import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Soft personalization payload for the AI stylist.
 * Reads user_style_memory_active only — never writes.
 * Writing happens in outfit-feedback.functions.ts -> style-memory-aggregator.server.ts.
 */
export const getActiveStyleMemory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_style_memory_active")
      .select("*")
      .order("effective_confidence", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
