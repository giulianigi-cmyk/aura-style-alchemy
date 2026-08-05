import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "./ai-json";
import { isItemAllowedByDressPreferences, type DressPreferences } from "./dress-preferences";

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
  length: z.string().nullable().optional(),
  sleeveLength: z.string().nullable().optional(),
  fit: z.string().nullable().optional(),
  heelHeight: z.string().nullable().optional(),
  toeShape: z.string().nullable().optional(),
  closure: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  styleTags: z.array(z.string()).nullable().optional(),
});

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const InputSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(30),
  items: z.array(ItemSchema),
  dressRules: z.string().nullable().optional(),
  dressPreferences: z.record(z.string(), z.unknown()).nullable().optional(),
  industry: z.string().nullable().optional(),
  workDressCode: z.string().nullable().optional(),
  personalFormality: z.string().nullable().optional(),
  profession: z.string().nullable().optional(),
  temperature: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  feedbackContext: z.enum(["liked", "disliked", "saved"]).nullable().optional(),
});

const OutputSchema = z.object({
  reply: z.string(),
  item_ids: z.array(z.string()),
  choices: z.array(z.string()).max(4).optional(),
});

const SAVE_ACTIONS = [
  { type: "save_canvas" as const, label: "Salva sulla tela" },
  { type: "add_calendar" as const, label: "Aggiungi al calendario" },
];

/**
 * Difesa contro un errore raro del modello: a volte, invece di restituire
 * l'oggetto richiesto al primo livello, lo incarta due volte — mette
 * l'intero JSON come stringa dentro il campo 'reply' invece che come
 * oggetto vero. Se lo rileviamo, srotoliamo e usiamo l'oggetto interno
 * (quello vero), invece di mostrare il JSON grezzo come testo in chat.
 */
function unwrapIfDoubleEncoded(parsed: z.infer<typeof OutputSchema>): z.infer<typeof OutputSchema> {
  const trimmed = parsed.reply?.trim() ?? "";
  if (!trimmed.startsWith("{") || !trimmed.includes('"reply"')) return parsed;
  try {
    return parseAiJson(trimmed, OutputSchema);
  } catch {
    return parsed;
  }
}

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

    const dressPrefs = (data.dressPreferences ?? null) as DressPreferences | null;
    const allowedItems = data.items.filter((it) => isItemAllowedByDressPreferences(it, dressPrefs));

    const catalog = allowedItems.slice(0, 200).map((it) => ({
      id: it.id,
      category: it.category ?? "",
      subcategory: it.subcategory ?? "",
      colors: it.colors ?? [],
      style: it.style ?? [],
      season: it.season ?? "",
      brand: it.brand ?? "",
      material: it.material ?? [],
      size: it.size ?? "",
      length: it.length ?? "",
      sleeveLength: it.sleeveLength ?? "",
      fit: it.fit ?? "",
      heelHeight: it.heelHeight ?? "",
      toeShape: it.toeShape ?? "",
      closure: it.closure ?? "",
      gender: it.gender ?? "",
      styleTags: it.styleTags ?? [],
    }));

    const feedbackInstruction = {
      liked: "The user just tapped 'I like this outfit' on your PREVIOUS suggestion. Reply with ONE short, warm line: acknowledge their choice and wish them well for whatever occasion was mentioned earlier in the conversation (if none was mentioned, keep it generic, e.g. 'Enjoy!'). Do NOT re-describe or repeat the outfit. Do NOT offer to save it or add it anywhere — that is handled separately. Return an empty item_ids array and empty choices array.",
      disliked: "The user just tapped 'not for me, suggest an alternative' on your PREVIOUS suggestion. Propose a genuinely DIFFERENT outfit using different pieces than the ones you just suggested (check the conversation history for what you already proposed and avoid repeating those exact item_ids).",
      saved: "The user just tapped 'save this outfit' on your PREVIOUS suggestion. Reply with a short one-line confirmation only. Do NOT re-describe the outfit again. Return an empty item_ids array and no choices.",
    } as const;

    const system = [
      ...(data.dressRules ? [data.dressRules, ""] : []),
      "You are AURA, a warm, expert personal stylist chatting with the owner of this wardrobe.",
      "Answer styling questions conversationally, in the same language the user writes in.",
      "When you recommend an outfit or specific pieces, use ONLY items from the wardrobe catalog below and put their ids in item_ids (max 6). If no items apply, return an empty item_ids array.",
      "Never invent items the user does not own. If the wardrobe lacks something, say so honestly and suggest what kind of piece would fill the gap.",
      "When describing a wardrobe piece in your reply, use ONLY the exact 'colors', 'category' and 'subcategory' values given for that item in the catalog below. If subcategory is present (e.g. 'Sandals', 'Boots', 'Pumps') use that exact word; never invent or guess a more specific color or subtype beyond what the catalog states. If subcategory is empty, stay generic (e.g. just 'shoes') rather than inventing detail.",
      "Use each item's subcategory to judge fit-for-purpose against weather and occasion: e.g. in hot weather prefer sandals/flats over boots; in rain or cold prefer boots over sandals; for formal occasions prefer pumps/heels or loafers over sneakers.",
      "Each item also carries separate attribute fields when known: length (garment length, e.g. Mini/Midi/Maxi for dresses and skirts, Short/Mid/Long for coats, Cropped/Regular/Longline for tops), sleeveLength, fit (e.g. Oversized, Slim, Tailored), heelHeight (Flat/Low/Mid/High), toeShape, closure, gender, and styleTags (free-form aesthetic labels like Minimal, Boho, Preppy, Office, Y2K — use these to match the vibe/aesthetic the user asks for). USE THESE DIRECTLY to honor explicit user requests — e.g. 'no long dresses' means excluding items where length is 'Maxi' (or 'Long'); 'only flat shoes' means heelHeight must be 'Flat'; 'oversized sweaters' means fit is 'Oversized'; 'something more minimal/elegant/streetwear' means matching styleTags. These fields are the source of truth for that request, not subcategory.",
      "If the relevant attribute field is empty for an item (older wardrobe pieces not yet re-classified), you cannot confirm that detail — either avoid proposing that item for a constraint you can't verify, or explicitly say so in your reply (e.g. \"I can't confirm this dress's length from what I have on file\").",
      "STRUCTURE RULE — ALWAYS propose a COMPLETE outfit when you propose one at all, never a partial one: either (Tops item_id + Bottoms item_id) OR (Dresses item_id OR Jumpsuits item_id), PLUS a Shoes item_id, PLUS a Bags item_id, every single time. Never suggest only a bottom, only shoes, or any partial combination. Accessories (Accessories category) are optional — include one only if it genuinely elevates the look. If the wardrobe is missing a piece needed to complete the outfit (e.g. no bag available), say so honestly in your reply instead of silently omitting that category.",
      ...(data.industry || data.workDressCode || data.personalFormality || data.profession ? [
        [
          "USER CONTEXT (soft signals only — weigh them together, never as a fixed rule like 'this industry = this outfit'; the user's own words in this conversation always win over these defaults):",
          data.profession ? `- Profession/role: ${data.profession}` : null,
          data.industry ? `- Industry: ${data.industry}` : null,
          data.workDressCode ? `- Usual work dress code: ${data.workDressCode}` : null,
          data.personalFormality ? `- Personal everyday formality preference: ${data.personalFormality} — this matters MOST when it conflicts with the occasion (e.g. someone 'Molto casual' asked for a client dinner still gets something polished, but leans as relaxed as the occasion allows; never push them more formal than necessary just because their industry sounds serious).` : null,
          "Never mention this context back to the user unprompted — it's background reasoning, not a topic.",
        ].filter(Boolean).join("\n")
      ] : []),
     "DRESS CODE CHECK: when the user mentions a specific dinner, party, work event, gala, wedding or similarly formal-sounding occasion WITHOUT stating a dress code, and this is the first time they're describing that occasion in this conversation, ask ONE short clarifying question before proposing an outfit — write it (and the 'choices') in the user's own language, following the same idea as: 'Do you know if there's a specific dress code (e.g. business formal, cocktail, black tie), or should I go for versatile elegance?' with a 'choices' array like ["No dress code", "Business casual", "Business formal", "Cocktail", "Black tie", "Not sure"]. Return an empty item_ids array for that turn. Skip this entirely for casual/everyday occasions, and skip it if a dress code was already stated or already asked about earlier in this conversation. If the user picks the 'not sure' option (or says they don't know), do NOT ask a follow-up question — decide yourself using the USER CONTEXT above (industry, usual work dress code, personal formality) and propose a versatile, safely-elegant outfit right away, briefly noting in your reply that you went with something adaptable since the dress code wasn't specified.",
      "WEDDING GUEST ETIQUETTE: if the user is attending a wedding as a guest (not the couple themselves), avoid recommending white, ivory or cream (reserved for the bride) and avoid an all-red look; avoid all-black unless it's explicitly an evening wedding. This is a social norm, not a hard rule like the dressing rules above — but treat it seriously.",
      "BOLDNESS CHECK: for festive or expressive occasions (wedding guest, cocktail, gala, party, creative/artsy events — NOT everyday or work-formal occasions), if this hasn't been asked yet in the conversation, you may ask ONE short question — write it (and the 'choices') in the user's own language, following the same idea as: 'Do you want to keep it classic, or lean bolder?' with 'choices' ["Classic", "Balanced", "Creative", "Bold"]. Never use technical color-theory language (e.g. never say 'Itten' or 'color wheel' to the user) — keep it conversational. Once answered (or if skipped because it doesn't apply), calibrate internally: the 'classic'/'balanced' pick → favor analogous, harmonious color pairings from the wardrobe; the 'creative'/'bold' pick → favor complementary or contrasting color pairings and one statement accessory, still from items the user actually owns. This is optional flair, never at the expense of the STRUCTURE RULE or any binding dress rule above.",
      "Keep replies short and practical: 2-4 sentences, no lists unless asked.",
      "If you explicitly ask the user to pick between two or more specific options (e.g. two color variants of the same piece), ALSO return those exact option labels as short strings in a 'choices' array (max 4, e.g. [\"Powder Pink\", \"Jet Black\"]). Only populate 'choices' when you are asking a direct pick-one question; otherwise omit it or return an empty array.",
      ...(data.feedbackContext ? [feedbackInstruction[data.feedbackContext]] : []),
      wx,
      `Wardrobe catalog (JSON): ${JSON.stringify(catalog)}`,
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
      '{"reply": "your conversational reply, in the user\'s language", "item_ids": ["id1", "id2"], "choices": ["Option A", "Option B"]}',
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
      parsed = unwrapIfDoubleEncoded(parsed);
      let finalItemIds = parsed.item_ids.filter((id) => validIds.has(id)).slice(0, 6);
      let finalReply = parsed.reply;

      if (finalItemIds.length > 0) {
        const cats = new Set(
          finalItemIds.map((id) => catalog.find((c) => c.id === id)?.category).filter(Boolean)
        );
        const hasCore = (cats.has("Tops") && cats.has("Bottoms")) || cats.has("Dresses") || cats.has("Jumpsuits");
        const missing: string[] = [];
        if (!hasCore) missing.push("a top+bottom pairing OR a dress/jumpsuit");
        if (!cats.has("Shoes")) missing.push("shoes");
        if (!cats.has("Bags")) missing.push("a bag");

        if (missing.length > 0) {
          try {
            const r3 = await generateText({
              model,
              system,
              messages: [
                ...history,
                { role: "assistant", content: text || "(no response)" },
                {
                  role: "user",
                  content: `Your last outfit was incomplete — it's missing ${missing.join(" and ")}. Complete it now using the wardrobe catalog, keeping the pieces you already picked. Reply again with ONLY the JSON object in the required shape.`,
                },
              ],
            });
            const repaired = parseAiJson(r3.text, OutputSchema);
            const repairedIds = repaired.item_ids.filter((id) => validIds.has(id)).slice(0, 6);
            if (repairedIds.length >= finalItemIds.length) {
              finalItemIds = repairedIds;
              finalReply = repaired.reply;
            }
          } catch (err) {
            console.error("[AURA stylist-chat] completeness repair failed, shipping original", err);
          }
        }
      }

      return {
        ok: true as const,
        reply: (finalReply ?? "").slice(0, 1200),
        item_ids: finalItemIds,
        choices: (parsed.choices ?? []).slice(0, 4),
        actions: data.feedbackContext === "liked" ? SAVE_ACTIONS : [],
      };
    } catch (err) {
      console.error("[AURA stylist-chat] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "AI failed" };
    }
  });
