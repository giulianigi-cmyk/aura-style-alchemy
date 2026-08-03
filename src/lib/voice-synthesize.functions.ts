import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  text: z.string().min(1).max(2000),
});

/** Sintesi vocale via OpenAI TTS. Voce 'nova': calda, funziona bene su più lingue. */
export const synthesizeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Missing OPENAI_API_KEY");

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "nova",
        input: data.text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[AURA voice-synthesize] OpenAI error", res.status, errText);
      throw new Error("Speech synthesis failed");
    }

    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { audioDataUrl: `data:audio/mpeg;base64,${base64}` };
  });
