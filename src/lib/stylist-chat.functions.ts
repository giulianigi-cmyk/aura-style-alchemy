import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "./ai-json";

const ItemSchema = z.object({
  id: z.string(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  colors: z.array(z.string()).nullable().optional(),
  style: z.array(z.string()).nullable().optional(),
  season: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  material: z.array(z.string()).nullable().optional(),
  size: z.string().nullable().optional(),
});

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const InputSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(30),
  items: z.array(ItemSchema),
  dressRules: z.string().nullable().optional(),
  temperature: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
});

const OutputSchema = z.object({
  reply: z.string(),
  item_ids: z.array(z.string()),
});

export const stylistChat = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const wx = data.temperature != null
      ? `Current weather: ${Math.round(data.temperature)}°C, ${data.condition ?? "unknown"}.`
      : "Current weather: unknown.";

    const catalog = data.items.slice(0, 200).map((it) => ({
      id: it.id,
      category: it.category ?? "",
      subcategory: it.subcategory ?? "",
      colors: it.colors ?? [],
      style: it.style ?? [],
      season: it.season ?? "",
      brand: it.brand ?? "",
      material: it.material ?? [],
      size: it.size ?? "",
    }));

    const system = [
      ...(data.dressRules ? [data.dressRules, ""] : []),
      "You are AURA, a warm, expert personal stylist chatting with the owner of this wardrobe.",
      "Answer styling questions conversationally, in the same language the user writes in.",
      "When you recommend an outfit or specific pieces, use ONLY items from the wardrobe catalog below and put their ids in item_ids (max 6). If no items apply, return an empty item_ids array.",
      "Never invent items the user does not own. If the wardrobe lacks something, say so honestly and suggest what kind of piece would fill the gap.",
      "When describing a wardrobe piece in your reply, use ONLY the exact 'colors', 'category' and 'subcategory' values given for that item in the catalog below. If subcategory is present (e.g. 'Sandals', 'Boots', 'Pumps / Heels') use that exact word; never invent or guess a more specific color or subtype beyond what the catalog states. If subcategory is empty, stay generic (e.g. just 'shoes') rather than inventing detail.",
      "Use each item's subcategory to judge fit-for-purpose against weather and occasion: e.g. in hot weather prefer sandals/flats over boots; in rain or cold prefer boots over sandals; for formal occasions prefer pumps/heels or loafers over sneakers.",
      "Keep replies short and practical: 2-4 sentences, no lists unless asked.",
      wx,
      `Wardrobe catalog (JSON): ${JSON.stringify(catalog)}`,
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
      '{"reply": "your conversational reply, in the user\'s language", "item_ids": ["id1", "id2"]}',
    ].join("\n");
    try {
      const history = data.messages.map((m) => ({ role: m.role, content: m.content }));

      let text: string;
      try {
        const r1 = await generateText({ model, system, messages: history });
        text = r1.text;
      } catch (err) {
        console.error("[AURA stylist-chat] first call failed", err);
        text = "";
      }

            let parsed: z.infer<typeof OutputSchema> | null = null;
      try {
        parsed = parseAiJson(text, OutputSchema);
      } catch {
        try {
          const r2 = await generateText({
            model,
            system,
            messages: [
              ...history,
              { role: "assistant", content: text || "(no response)" },
              {
                role: "user",
                content: "That was not a single valid JSON object matching the required shape. Reply again with ONLY the JSON object, nothing else.",
              },
            ],
          });
          parsed = parseAiJson(r2.text, OutputSchema);
        } catch {
          // Graceful degradation: the model ignored the JSON format after
          // a retry too (can happen over long conversations). Rather than
          // showing an error, fall back to its plain-text reply with no
          // item thumbnails — the conversation still works for the user.
          parsed = { reply: text.trim() || "Sorry, I didn't quite catch that — could you rephrase?", item_ids: [] };
        }
      }

      const validIds = new Set(catalog.map((c) => c.id));
      return {
        ok: true as const,
        reply: (parsed.reply ?? "").slice(0, 1200),
        item_ids: parsed.item_ids.filter((id) => validIds.has(id)).slice(0, 6),
      };
    } catch (err) {
      console.error("[AURA stylist-chat] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "AI failed" };
    }
  });
