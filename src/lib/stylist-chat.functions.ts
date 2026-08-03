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
  feedbackContext: z.enum(["liked", "disliked", "saved"]).nullable().optional(),
});

const OutputSchema = z.object({
  reply: z.string(),
  item_ids: z.array(z.string()),
  choices: z.array(z.string()).max(4).optional(),
  actions: z.array(z.object({
    type: z.enum(["save_canvas", "add_calendar", "dismiss"]),
    label: z.string(),
  })).max(3).optional(),
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

    const feedbackInstruction = {
      liked: "The user just tapped 'I like this outfit' on your PREVIOUS suggestion. Reply with ONE short, warm line: acknowledge their choice and wish them well for whatever occasion was mentioned earlier in the conversation (if none was mentioned, keep it generic, e.g. 'Enjoy!'). Do NOT re-describe or repeat the outfit. Return an empty item_ids array and empty choices array. In 'actions', return exactly these two: [{\"type\": \"save_canvas\", \"label\": \"Salva sulla tela\"}, {\"type\": \"add_calendar\", \"label\": \"Aggiungi al calendario\"}] (translate the labels to the user's language).",
      disliked: "The user just tapped 'not for me, suggest an alternative' on your PREVIOUS suggestion. Propose a genuinely DIFFERENT outfit using different pieces than the ones you just suggested (check the conversation history for what you already proposed and avoid repeating those exact item_ids).",
      saved: "The user just tapped 'save this outfit' on your PREVIOUS suggestion. Reply with a short one-line confirmation only. Do NOT re-describe the outfit again. Return an empty item_ids array and no choices or actions.",
    } as const;

    const system = [
      ...(data.dressRules ? [data.dressRules, ""] : []),
      "You are AURA, a warm, expert personal stylist chatting with the owner of this wardrobe.",
      "Answer styling questions conversationally, in the same language the user writes in.",
      "When you recommend an outfit or specific pieces, use ONLY items from the wardrobe catalog below and put their ids in item_ids (max 6). If no items apply, return an empty item_ids array.",
      "Never invent items the user does not own. If the wardrobe lacks something, say so honestly and suggest what kind of piece would fill the gap.",
      "When describing a wardrobe piece in your reply, use ONLY the exact 'colors', 'category' and 'subcategory' values given for that item in the catalog below. If subcategory is present (e.g. 'Sandals', 'Boots', 'Pumps / Heels') use that exact word; never invent or guess a more specific color or subtype beyond what the catalog states. If subcategory is empty, stay generic (e.g. just 'shoes') rather than inventing detail.",
      "Use each item's subcategory to judge fit-for-purpose against weather and occasion: e.g. in hot weather prefer sandals/flats over boots; in rain or cold prefer boots over sandals; for formal occasions prefer pumps/heels or loafers over sneakers.",
      "Keep replies short and practical: 2-4 sentences, no lists unless asked.",
      "If you explicitly ask the user to pick between two or more specific options (e.g. two color variants of the same piece), ALSO return those exact option labels as short strings in a 'choices' array (max 4, e.g. [\"Powder Pink\", \"Jet Black\"]). Only populate 'choices' when you are asking a direct pick-one question; otherwise omit it or return an empty array.",
      ...(data.feedbackContext ? [feedbackInstruction[data.feedbackContext]] : []),
      wx,
      `Wardrobe catalog (JSON): ${JSON.stringify(catalog)}`,
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
      '{"reply": "your conversational reply, in the user\'s language", "item_ids": ["id1", "id2"], "choices": ["Option A", "Option B"], "actions": [{"type": "save_canvas", "label": "Salva sulla tela"}]}',
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

      let parsed: z.infer<typeof OutputSchema>;
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
          parsed = { reply: text.trim() || "Sorry, I didn't quite catch that — could you rephrase?", item_ids: [] };
        }
      }

      const validIds = new Set(catalog.map((c) => c.id));
      return {
        ok: true as const,
        reply: (parsed.reply ?? "").slice(0, 1200),
        item_ids: parsed.item_ids.filter((id) => validIds.has(id)).slice(0, 6),
        choices: (parsed.choices ?? []).slice(0, 4),
        actions: (parsed.actions ?? []).slice(0, 3),
      };
    } catch (err) {
      console.error("[AURA stylist-chat] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "AI failed" };
    }
  });
