import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageDataUrl: z.string().min(20),
});

function dataUrlToBlob(dataUrl: string): Blob {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid data URL");
  const mime = m[1];
  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Core remove.bg call, usable directly from server-side code (e.g. the
 *  batch scan worker) without going through the client-facing serverFn
 *  wrapper below — the worker already runs with service-role privileges,
 *  it doesn't need a second auth layer around the same API call. */
export async function removeBackgroundCore(imageDataUrl: string): Promise<{ ok: true; imageDataUrl: string } | { ok: false; error: string }> {
  const key = process.env.REMOVEBG_API_KEY;
  if (!key) return { ok: false, error: "Missing REMOVEBG_API_KEY" };

  try {
    const form = new FormData();
    form.append("image_file", dataUrlToBlob(imageDataUrl), "upload.png");
    form.append("size", "auto");

    const resp = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": key },
      body: form,
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.warn("[AURA bgremove] remove.bg error", resp.status, body.slice(0, 300));
      return { ok: false, error: `remove.bg ${resp.status}` };
    }

    const buf = new Uint8Array(await resp.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);
    const url = `data:image/png;base64,${b64}`;

    console.log("[AURA bgremove] remove.bg output bytes", buf.length);
    return { ok: true, imageDataUrl: url };
  } catch (err) {
    console.error("[AURA bgremove] failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

/**
 * Remove the background from a garment photo using remove.bg — a service
 * purpose-built for exactly this (clean, alpha-accurate cutouts around
 * leather, hardware, stitching, hair-like edges), replacing the earlier
 * Gemini-based approach which intermittently returned a baked-in
 * checkerboard instead of real alpha on complex items. Returns a
 * transparent PNG as a data URL.
 */
export const removeBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => removeBackgroundCore(data.imageDataUrl));
