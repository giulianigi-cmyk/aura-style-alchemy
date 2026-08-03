import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  audioDataUrl: z.string().min(20), // data:audio/webm;base64,...
});

/**
 * Trascrizione vocale via Whisper (OpenAI).
 * Nessun parametro 'language': lo lasciamo auto-rilevare, così AURA
 * capisce italiano/inglese/tedesco/cinese ecc. senza doverlo specificare.
 */
export const transcribeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.OPENAI_API_KEY;
    console.log("[AURA voice-transcribe] hasApiKey:", !!key);
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const match = data.audioDataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (!match) throw new Error("Invalid audio data");
    const mime = match[1];
    const base64 = match[2];
    const buffer = Buffer.from(base64, "base64");
    const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "wav";
    const fileName = `audio.${ext}`;
    console.log("[AURA voice-transcribe] mime:", mime, "bytes:", buffer.length, "fileName:", fileName);

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mime }), fileName);
    form.append("model", "whisper-1");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    console.log("[AURA voice-transcribe] OpenAI status:", res.status);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[AURA voice-transcribe] OpenAI error body:", res.status, errText);
      throw new Error(`OpenAI ${res.status}: ${errText || "no response body"}`);
    }

    const json = (await res.json()) as { text?: string };
    return { text: (json.text ?? "").trim() };
  });
