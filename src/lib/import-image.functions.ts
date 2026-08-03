import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchImageAsDataUrl } from "./fetch-image";
import { checkPublicUrl } from "./safe-url";

const InputSchema = z.object({
  url: z.string().url().refine((v) => checkPublicUrl(v) === null, "That address is not allowed."),
  // Product page origin — sent as Referer to satisfy hotlink protection.
  referer: z.string().url().refine((v) => checkPublicUrl(v) === null, "That address is not allowed.").optional(),
});

/** Downloads one of the alternative product images surfaced by the URL
 *  import, so the user can swap the auto-picked photo for another shot
 *  (e.g. the flat packshot instead of the on-model image). */
export const downloadImportImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const u = new URL(data.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { ok: false as const, error: "Invalid image URL." };
    }
    const res = await fetchImageAsDataUrl(u.toString(), data.referer);
    if (!res.ok) return { ok: false as const, error: res.error };
    return { ok: true as const, imageDataUrl: res.dataUrl };
  });
