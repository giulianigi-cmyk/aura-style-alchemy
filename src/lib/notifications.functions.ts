import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MarkReadSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

/**
 * Marks the caller's own notifications as read. Kept as a dedicated
 * function (rather than a client-side UPDATE policy) purely for
 * consistency with the rest of the app's write pattern — the actual risk
 * of a direct policy here was low (a user can only ever touch their own
 * private notification rows), unlike scan_detected_items.
 */
export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MarkReadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
