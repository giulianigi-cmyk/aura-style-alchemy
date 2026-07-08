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

      // Diagnostic: log MIME + (if PNG) IHDR color type so we can tell
      // whether Gemini is actually returning a transparent image or a
      // rasterised checker on RGB. Search logs for "[AURA bgremove]".
      try {
        const m = url.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          const mime = m[1];
          const b64 = m[2];
          // Decode just the PNG header (33 bytes is enough).
          const head = atob(b64.slice(0, 64));
          const bytes = new Uint8Array(head.length);
          for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
          const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
          let info: Record<string, unknown> = { mime, isPng, base64Bytes: b64.length };
          if (isPng && bytes.length >= 26) {
            // IHDR starts at byte 16 after the 8-byte signature + length + "IHDR".
            const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
            const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
            const bitDepth = bytes[24];
            const colorType = bytes[25]; // 0=grey, 2=RGB, 3=palette, 4=greyA, 6=RGBA
            const colorTypeName =
              colorType === 6 ? "RGBA" :
              colorType === 2 ? "RGB (no alpha)" :
              colorType === 4 ? "GreyA" :
              colorType === 3 ? "Palette" :
              colorType === 0 ? "Grey" : `unknown(${colorType})`;
            info = { ...info, width: w, height: h, bitDepth, colorType, colorTypeName };
          }
          console.log("[AURA bgremove] gateway image", JSON.stringify(info));
        }
      } catch (e) {
        console.warn("[AURA bgremove] header inspection failed", e);
      }

      return { ok: true as const, imageDataUrl: url };
    } catch (err) {
      console.error("[AURA bgremove] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "unknown" };
    }
  });
