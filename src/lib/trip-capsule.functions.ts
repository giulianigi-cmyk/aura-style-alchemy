import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateTripCapsuleCore } from "./trip-capsule.server";

export const generateTripCapsule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    tripId: z.string().uuid(),
    activityIds: z.array(z.string().uuid()).optional(),
  }).parse(input))
  .handler(generateTripCapsuleCore);