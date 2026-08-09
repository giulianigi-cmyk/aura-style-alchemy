import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { parseAiJson } from "./ai-json";
import { isItemAtLocation } from "./wardrobe-location";

const ItemSchema = z.object({
  id: z.string(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  colors: z.array(z.string()).nullable().optional(),
  style: z.array(z.string()).nullable().optional(),
  season: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
});

const InputSchema = z.object({
  temperature: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  occasion: z.string().nullable().optional(),
  dressRules: z.string().nullable().optional(),
  items: z.array(ItemSchema).min(1),
  avoidItemIds: z.array(z.string()).optional(),
});

const OutputSchema = z.object({
  item_ids: z.array(z.string()),
  explanation: z.string(),
});

export type SuggestOutfitItem = z.infer<typeof ItemSchema>;

export async function suggestOutfitCore(params: {
  supabase: any;
  userId: string;
  temperature: number | null;
  condition: string | null;
  occasion: string | null;
  dressRules: string | null;
  items: SuggestOutfitItem[];
  avoidItemIds?: string[];
  locationIdOverride?: string | null;
}): Promise<{ ok: true; item_ids: string[]; explanation: string } | { ok: false; error: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-2.5-flash");

  // A caller (like the weekly generator) can explicitly choose which
  // location to build from for this run, rather than always defaulting
  // to whatever's currently active — useful when generating outfits for
  // a period spent somewhere other than the active location.
  let locationId = params.locationIdOverride;
  if (locationId === undefined) {
    const { data: profileRow } = await (params.supabase.from("profiles" as never) as any)
      .select("active_location_id").eq("id", params.userId).maybeSingle();
    locationId = (profileRow as { active_location_id: string | null } | null)?.active_location_id ?? null;
  }
  let activeLocation: { id: string; is_primary: boolean } | null = null;
  if (locationId) {
    const { data: locRow } = await (params.supabase.from("wardrobe_locations" as never) as any)
      .select("id, is_primary").eq("id", locationId).eq("user_id", params.userId).maybeSingle();
    if (locRow) activeLocation = locRow as { id: string; is_primary: boolean };
  }
  let eligibleItems = params.items.filter((it) =>
    isItemAtLocation({ location_id: it.locationId ?? null }, activeLocation));

  // Excluding items already used earlier in a multi-day batch is how
  // repeats get avoided across a generated week — but if that would
  // leave too little to compose a real outfit from, allow them back in
  // rather than fail to produce anything for that day.
  if (params.avoidItemIds?.length) {
    const withoutRecent = eligibleItems.filter((it) => !params.avoidItemIds!.includes(it.id));
    if (withoutRecent.length >= 3) eligibleItems = withoutRecent;
  }

  const wx = params.temperature != null
    ? `Weather: ${Math.round(params.temperature)}°C, ${params.condition ?? "unknown"}.`
    : "Weather: unknown.";
  const occ = params.occasion ? `Occasion: ${params.occasion}.` : "Occasion: everyday.";

  const catalog = eligibleItems.slice(0, 200).map((it) => ({
    id: it.id,
    category: it.category ?? "",
    subcategory: it.subcategory ?? "",
    colors: it.colors ?? [],
    style: it.style ?? [],
    season: it.season ?? "",
    brand: it.brand ?? "",
  }));

  const system = [
    ...(params.dressRules ? [params.dressRules, ""] : []),
    "You are a personal stylist. Compose ONE coherent outfit from the user's wardrobe.",
    "Pick 3-5 items that work together (typically 1 top + 1 bottom OR 1 dress, + 1 shoes, optionally 1 outerwear and 1 accessory/bag).",
    "Match the weather and occasion. Prefer colors that harmonize and consistent style.",
    "Use each item's subcategory when present to judge fit-for-purpose: e.g. in hot weather prefer sandals/flats over boots; in rain or cold prefer boots over sandals; for formal occasions prefer pumps/heels over sneakers. When subcategory is empty, judge from category alone.",
    "Return ONLY item ids that exist in the provided catalog. Never invent ids.",
    "Explanation: 1-2 short sentences (max 200 chars) on why these pieces work.",
    "",
    "Respond with ONLY a single valid JSON object, no markdown fences, no extra text, in exactly this shape:",
    '{"item_ids": ["id1", "id2"], "explanation": "short reason"}',
  ].join("\n");

  const userContent = `${wx} ${occ}\nWardrobe:\n${JSON.stringify(catalog)}`;
  try {
    let text: string;
    try {
      const r1 = await generateText({
        model,
        system,
        messages: [{ role: "user", content: userContent }],
      });
      text = r1.text;
    } catch (err) {
      console.error("[AURA suggest-outfit] first call failed", err);
      text = "";
    }

    let parsed: z.infer<typeof OutputSchema>;
    try {
      parsed = parseAiJson(text, OutputSchema);
    } catch {
      const r2 = await generateText({
        model,
        system,
        messages: [
          { role: "user", content: userContent },
          { role: "assistant", content: text || "(no response)" },
          {
            role: "user",
            content: "That was not a single valid JSON object matching the required shape. Reply again with ONLY the JSON object, nothing else.",
          },
        ],
      });
      parsed = parseAiJson(r2.text, OutputSchema);
    }

    const validIds = new Set(catalog.map((c) => c.id));
    const item_ids = parsed.item_ids.filter((id) => validIds.has(id)).slice(0, 5);
    return {
      ok: true as const,
      item_ids,
      explanation: (parsed.explanation ?? "").slice(0, 240),
    };
  } catch (err) {
    console.error("[AURA suggest-outfit] failed", err);
    return { ok: false as const, error: err instanceof Error ? err.message : "AI failed" };
  }
}

export const suggestOutfitAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => suggestOutfitCore({
    supabase: context.supabase,
    userId: context.userId,
    temperature: data.temperature ?? null,
    condition: data.condition ?? null,
    occasion: data.occasion ?? null,
    dressRules: data.dressRules ?? null,
    items: data.items,
    avoidItemIds: data.avoidItemIds,
  }));
