import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { DetectInputSchema, type DetectedOutfitItem } from "./outfit-detect-types";

export type { DetectedOutfitItem };

export const analyzeOutfit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DetectInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { detectOutfitItems } = await import("./outfit-detect.server");
    return detectOutfitItems(data.imageDataUrl);
  });
