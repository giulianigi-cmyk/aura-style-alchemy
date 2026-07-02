import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageDataUrl: z.string().min(20),
});

/**
 * Remove the background from a garment photo using Google Gemini image editing
 * via the Lovable AI Gateway. Returns a transparent PNG as a data URL.
 * On any failure, returns { ok: false } so the caller can fall back to the
 * original photo without blocking the user.
 */
export const removeBackground = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { ok: false as const, error: "Missing LOVABLE_API_KEY" };

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Lovable-API-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-image",
          modalities: ["image", "text"],
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Remove the background from this photo completely and return ONLY the main clothing/garment/accessory subject on a fully transparent background. Preserve fine edges, fabric texture, drape and original colors exactly. Do not add shadows, do not add a new background, do not crop or resize the subject. Output a transparent PNG.",
                },
                { type: "image_url", image_url: { url: data.imageDataUrl } },
              ],
            },
          ],
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        console.warn("[AURA bgremove] gateway error", resp.status, body.slice(0, 300));
        return { ok: false as const, error: `Gateway ${resp.status}` };
      }

      const json = (await resp.json()) as {
        choices?: Array<{
          message?: {
            images?: Array<{ image_url?: { url?: string } }>;
          };
        }>;
      };

      const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!url || !url.startsWith("data:")) {
        return { ok: false as const, error: "No image returned" };
      }

      return { ok: true as const, imageDataUrl: url };
    } catch (err) {
      console.error("[AURA bgremove] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "unknown" };
    }
  });
