// Manual JSON extraction + validation for AI text responses.
// Some model/gateway combinations don't reliably honor strict
// "structured output" / function-calling schema modes — they still
// return prose-wrapped or fenced JSON. Instead of depending on that
// provider feature, we ask for plain JSON in the prompt and parse it
// ourselves, with one automatic repair retry.
import type { z } from "zod";

export function extractJsonObject(text: string): unknown {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through to bracket-slice extraction below
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in AI response");
  return JSON.parse(t.slice(start, end + 1));
}

export function parseAiJson<T>(text: string, schema: z.ZodType<T>): T {
  const raw = extractJsonObject(text);
  return schema.parse(raw);
}
