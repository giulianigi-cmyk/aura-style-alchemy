import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  formality: z.number().nullable().optional(),
    dayEvening: z.string().nullable().optional(),
  styleTags: z.array(z.string()).nullable().optional(),
   // Skirt/dress length ("Mini" | "Midi" | "Maxi"), needed to hard-enforce
  // the "no short skirts for Work" rule below — without it, a Mini skirt
  // and a Maxi skirt are indistinguishable to both the model and the code.
  length: z.string().nullable().optional(),
  sleeveLength: z.string().nullable().optional(),
  // The piece's OWN occasion tags (Wardrobe → edit → Occasion) — never
  // sent to this engine before, so a bag tagged only "Travel" could
  // freely surface in the Work curated look here, same gap already
  // closed in the on-demand/weekly engine and the stylist chat.
  occasion: z.string().nullable().optional(),
});

const InputSchema = z.object({

  temperature: z.number().nullable().optional(),
  condition: z.string().nullable().optional(),
  dressRules: z.string().nullable().optional(),
  items: z.array(ItemSchema).min(3),
});

const LookSchema = z.object({
  item_ids: z.array(z.string()),
  occasion: z.string().min(1),
  explanation: z.string(),
});
const OutputSchema = z.object({
  today: LookSchema,
  curated: z.array(LookSchema).min(1).max(4),
});
export type DailyLook = z.infer<typeof LookSchema>;
export type DailyLooksResult = z.infer<typeof OutputSchema>;

/**
 * Generates real outfit recommendations from the user's ACTUAL wardrobe in
 * a single AI call: one "today" look (weather-aware, for right now) plus
 * a small set of "curated" looks spanning a few different real occasions.
 * All items referenced must exist in the provided catalog — nothing is
 * invented. Intended to be called once per day and cached by the caller
 * (see home_suggestions table), not re-generated on every page view.
 */
export const suggestDailyLooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (data.items.length < 3) {
      return { ok: false as const, error: "Not enough wardrobe pieces to compose a look yet." };
    }

    const { data: profileRow } = await (context.supabase.from("profiles" as never) as any)
      .select("gender").eq("id", context.userId).maybeSingle();
    const gender = (profileRow as { gender?: string | null } | null)?.gender ?? null;

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const wx = data.temperature != null
      ? `Today's weather: ${Math.round(data.temperature)}°C, ${data.condition ?? "unknown"}.`
      : "Today's weather: unknown.";

    const catalog = data.items.slice(0, 200).map((it) => ({
      id: it.id,
      category: it.category ?? "",
      subcategory: it.subcategory ?? "",
      colors: it.colors ?? [],
      style: it.style ?? [],
      season: it.season ?? "",
      brand: it.brand ?? "",
      formality: it.formality ?? null,
            dayEvening: it.dayEvening ?? "",
      styleTags: it.styleTags ?? [],
            length: it.length ?? "",
      sleeveLength: it.sleeveLength ?? "",
      occasion: it.occasion ?? "",
    }));


    const system = [
      ...(data.dressRules ? [data.dressRules, ""] : []),
      "You are a personal stylist. Compose REAL outfits using ONLY items from the",
      "user's own wardrobe catalog below. Never invent an item id.",
      "",
      "Produce TWO things:",
      "1. \"today\": ONE outfit specifically appropriate for today's actual weather",
      "   (see below), for a general everyday occasion.",
      "2. \"curated\": build toward THREE specific occasions, in this order:",
      "   \"Work\", \"Weekend\", \"Evening\". Each one is a genuinely different brief —",
      "   Work = put-together and professional, Weekend = relaxed and casual,",
      "   Evening = dressier or more elevated. Give each its own distinct outfit,",
      "   built for that specific brief, not a minor variation of another one.",
      "   Set each look's \"occasion\" field to exactly that label. Avoid reusing",
      "   the exact same combination as \"today\" or as another curated look.",
      "",
      "Today's actual weather (see below) applies to EVERY look you produce —",
      "\"today\" AND all three curated occasions, no exceptions. A look is never",
      "\"for some future day\" or \"aspirational\": Work/Weekend/Evening must all",
      "be wearable outside right now. If it's hot, no coats, wool knits, heavy",
      "layering or boots in ANY look, including Work. If it's cold or rainy, no",
      "bare tanks or thin sandals in ANY look, including Evening. Weather is a",
      "hard constraint like formality, not a decorative detail for \"today\" only.",
      "",
      "   Formality and day/evening context outrank color or style match — a",
      "   great color pairing never justifies the wrong occasion.",
            "   \"Work\" must EXCLUDE: off-shoulder or bare-shoulder tops, strappy or",
      "   embellished/rhinestone/metallic heeled sandals, clutches or evening bags,",
      "   cocktail-style dresses, anything overtly evening-coded, shorts of any",
      "   kind, and mini or above-the-knee skirts/dresses (length \"Mini\") — use",
      "   knee-length or longer only. Prefer covered shoulders, closed-toe or",
      "   block-heel shoes, structured bags for Work.",
      "   \"Evening\" is where those bare-shoulder or dressy-sandal pieces belong",
      "   instead — reserve them for that occasion, not Work.",
      "",
      "Each outfit: pick 3-5 items that work together (typically 1 top + 1 bottom OR",
      "1 dress, + shoes, optionally outerwear/accessory). Match colors and style",
      "coherently. A dress or jumpsuit is a complete base on its own and REPLACES",
      "both top and bottom — NEVER combine a dress or jumpsuit with a separate",
      "Bottoms item (trousers, jeans, shorts, skirt) in the same look. If you pick",
      "a dress or jumpsuit, do not also pick anything from the Bottoms category.",
      "Use subcategory to judge fit-for-purpose when present (e.g. prefer",
      "sandals over boots in hot weather; heels over sneakers for formal occasions).",
      "NEVER use subcategory \"Running Shoes\" in any look, for any occasion — this",
      "is a styling engine, not a workout planner. \"Sneakers\" (lifestyle) remain",
      "fine for casual/Weekend looks.",
      "If the wardrobe genuinely can't support a distinct, coherent look for one of",
      "the three occasions without being repetitive or nonsensical, skip that",
      "occasion rather than forcing a bad or near-identical combination — quality",
      "over hitting the count of three.",
      "A belt is a genuine styling option, not just a functional afterthought —",
      "actively consider one from Accessories when the look has a waist to define",
      "(high-rise bottom with a tucked/cropped top, a Relaxed/Oversized dress or",
      "jumpsuit with no built-in waist definition). Skip it when the piece is",
      "already fitted at the waist (Slim/Tailored) or is a Wrap style.",
      "LAYERING — two techniques to actively consider, not just default to a",
      "single top: (1) a denim shirt/jacket worn OPEN over a well-fitted",
      "(Slim/Tailored/Regular, never Oversized/Cropped) tank or t-shirt; (2) a",
      "lace bra/bralette visible under a sheer/semi-sheer shirt or sweater, an",
      "open blazer, or a low/plunging neckline — for Weekend/Evening looks only,",
      "never Work. Only when the wardrobe actually has pieces that fit it.",
      "occasion: exactly \"Work\", \"Weekend\", or \"Evening\" for curated looks; any",
      "short label for \"today\".",
      "explanation: 1 short sentence (max 160 chars) on why it works.",
      "",
      "Respond with ONLY a single valid JSON object, no markdown fences, no extra text,",
      "in exactly this shape:",
      '{"today":{"item_ids":[],"occasion":"","explanation":""},"curated":[{"item_ids":[],"occasion":"","explanation":""}]}',
    ].join("\n");

    const userContent = `${wx}\nWardrobe:\n${JSON.stringify(catalog)}`;
    const validIds = new Set(catalog.map((c) => c.id));

    /** Fraction of overlap between two item sets (0 = nothing shared,
     *  1 = identical sets). Simple, explainable, no scoring system needed. */
    const jaccard = (a: string[], b: string[]): number => {
      const setA = new Set(a);
      const setB = new Set(b);
      const intersection = [...setA].filter((x) => setB.has(x)).length;
      const union = new Set([...setA, ...setB]).size;
      return union === 0 ? 0 : intersection / union;
    };
    const TOO_SIMILAR = 0.7; // 70%+ shared items counts as "practically the same look"

    const SLOT_LIMITS: Record<string, number> = {
      Tops: 1, Bottoms: 1, Dresses: 1, Jumpsuits: 1, Shoes: 1, Bags: 1, Outerwear: 1,
    };
    /** Rejects a look with more than one item in a single-per-outfit slot
     *  (e.g. two Bottoms, a skirt AND trousers) — structural coherence is a
     *  hard requirement, never left to the model's judgment alone. */
    const hasSlotViolation = (ids: string[]): boolean => {
      const counts: Record<string, number> = {};
      for (const id of ids) {
        const cat = catalog.find((c) => c.id === id)?.category;
        if (!cat) continue;
        counts[cat] = (counts[cat] ?? 0) + 1;
      }
      return Object.entries(SLOT_LIMITS).some(([cat, limit]) => (counts[cat] ?? 0) > limit);
    };

    const EVENING_SIGNAL = /rhinestone|embellish|diamant|strappy|metallic|clutch|cocktail|sequin|paillette/i;
    /** Hard exclusion for "Work": evening-coded pieces never pass, enforced
     *  in code — not just requested in the prompt. */
    const violatesWorkFormality = (ids: string[]): boolean =>
      ids.some((id) => {
        const item = catalog.find((c) => c.id === id);
        if (!item) return false;
        const text = `${item.subcategory} ${(item.styleTags ?? []).join(" ")}`;
        if (EVENING_SIGNAL.test(text)) return true;
                if (item.dayEvening === "evening" && (item.formality ?? 0) >= 4) return true;
        return false;
      });

    const SHORTS_SUBCATEGORIES = new Set(["Shorts", "Bermuda Shorts"]);
    /** Hard exclusion for "Work": shorts and mini/above-the-knee skirts or
     *  dresses never pass, enforced in code — not just requested in the
     *  prompt, since the LLM can otherwise ignore a text-only instruction.
     *  Mirrors the "cover legs" logic in dress-preferences.ts, but scoped
     *  to the Work occasion specifically rather than as a global rule. */
    const violatesWorkModesty = (ids: string[]): boolean =>
      ids.some((id) => {
        const item = catalog.find((c) => c.id === id);
        if (!item) return false;
        if (item.category === "Bottoms" && SHORTS_SUBCATEGORIES.has(item.subcategory)) return true;
        const isSkirtBottom = item.category === "Bottoms" && item.subcategory === "Skirt";
        const isDressOrSkirt = item.category === "Dresses" || isSkirtBottom;
        if (isDressOrSkirt && item.length === "Mini") return true;
        return false;
      });

    /** Hard exclusion for EVERY occasion: a Dress or Jumpsuit already
     *  covers top + bottom, so pairing it with a separate Bottoms item
     *  (shorts, jeans, skirt, trousers) is never a real outfit, no matter
     *  how well the prompt is worded — enforced in code so the model
     *  cannot silently ignore it. */
    const violatesDressPlusBottoms = (ids: string[]): boolean => {
      const hasFullBody = ids.some((id) => {
        const item = catalog.find((c) => c.id === id);
        return item?.category === "Dresses" || item?.category === "Jumpsuits";
      });
      if (!hasFullBody) return false;
      return ids.some((id) => catalog.find((c) => c.id === id)?.category === "Bottoms");
    };


    // Weather is a hard constraint for EVERY look (today + all curated
    // occasions), not just "today" — enforced in code, mirroring
    // violatesWorkFormality above. A great Work outfit is not an excuse to
    // wear a wool coat at 39°C.
    const HOT_THRESHOLD_C = 26;
    const COLD_THRESHOLD_C = 10;
    const HEAVY_SIGNAL = /coat|cappotto|piumino|parka|overcoat|puffer|shearling|montone|wool knit|maglione|sweater|felted|fleece|boots?\b|stivali/i;
    const LIGHT_SIGNAL = /tank|canotta|sandal|sandalo|shorts?\b|infradito|flip.?flop|sleeveless|senza maniche/i;
    /** Hard exclusion for weather: heavy pieces never pass when it's hot,
     *  bare/light pieces never pass when it's cold — for ANY occasion. */
    const violatesWeather = (ids: string[]): boolean => {
      if (data.temperature == null) return false;
      const hot = data.temperature >= HOT_THRESHOLD_C;
      const cold = data.temperature <= COLD_THRESHOLD_C;
      if (!hot && !cold) return false;
      return ids.some((id) => {
        const item = catalog.find((c) => c.id === id);
        if (!item) return false;
        const text = `${item.category} ${item.subcategory} ${(item.styleTags ?? []).join(" ")}`;
        const season = (item.season ?? "").toLowerCase();
        if (hot) {
          if (season === "winter") return true;
          if (HEAVY_SIGNAL.test(text)) return true;
        }
        if (cold) {
          if (season === "summer" && LIGHT_SIGNAL.test(text)) return true;
        }
        return false;
      });
    };

    // Technical/running shoes are a hard exclusion from every look this
    // engine produces — this engine styles outfits (Today's edit, Work,
    // Weekend, Evening), never a workout fit. Formality alone doesn't
    // catch this: a performance running shoe and a canvas lifestyle
    // sneaker can both read as formality 1, but only one belongs in a
    // styled outfit. The taxonomy already separates the two at
    // classification time (subcategory "Running Shoes" vs "Sneakers" —
    // see ai-analyze.functions.ts), so this just has to trust that field.
    const violatesStylingFootwear = (ids: string[]): boolean =>
      ids.some((id) => catalog.find((c) => c.id === id)?.subcategory === "Running Shoes");

    // A piece tagged ONLY "Travel" or ONLY "Sport" (the person's own
    // explicit tag) is situational — it shouldn't surface in an
    // unrelated curated look, e.g. a travel-only bag proposed for the
    // Work look. "General" (today's everyday look) is intentionally
    // exempt: it's not tied to one of the three named occasions, so
    // there's no specific occasion to check the tag against.
    const SPECIALIZED_OCCASION_TAGS = ["Travel", "Sport"];
    const violatesOccasionTag = (occasion: string, ids: string[]): boolean => {
      if (occasion === "General") return false;
      return ids.some((id) => {
        const item = catalog.find((c) => c.id === id);
        if (!item?.occasion) return false;
        const tags = item.occasion.split(",").map((s) => s.trim()).filter(Boolean);
        const hasSpecialized = tags.some((tg) => SPECIALIZED_OCCASION_TAGS.includes(tg));
        if (!hasSpecialized) return false;
        return !tags.includes(occasion);
      });
    };

        const REQUIRED_OCCASIONS = ["Work", "Weekend", "Evening"] as const;

    /** Single-look validation, reused both by the first pass and by the
     *  retry below — same hard rules, just callable per-look against a
     *  running "seen" list instead of only inside one big filter chain. */
    const isValidCuratedLook = (l: DailyLook, seen: string[][]): boolean => {
      if (!l.item_ids.every((id) => validIds.has(id))) return false;
      if (l.item_ids.length < 2) return false;
      if (hasSlotViolation(l.item_ids)) return false;
      if (l.occasion === "Work" && violatesWorkFormality(l.item_ids)) return false;
      if (l.occasion === "Work" && violatesWorkModesty(l.item_ids)) return false;
      if (violatesDressPlusBottoms(l.item_ids)) return false;
      if (violatesWeather(l.item_ids)) return false;
      if (violatesStylingFootwear(l.item_ids)) return false;
      if (violatesOccasionTag(l.occasion, l.item_ids)) return false;
      if (seen.some((s) => jaccard(l.item_ids, s) >= TOO_SIMILAR)) return false;
      return true;
    };

    // Bags are mandatory for Woman — the same hard rule already enforced
    // in the on-demand/weekly outfit engine (ai-suggest-outfit.functions.ts).
    // This curated-looks engine (Home's "Selezionati per te") runs
    // completely independently and never inherited it, which is why an
    // Evening look could come back with a dress, shoes, and jewelry but
    // no bag. Appended after the fact rather than rejecting a look that's
    // missing one — that would just trigger an unnecessary retry for an
    // otherwise-good look instead of simply completing it.
    const NO_BAG_OCCASION_SIGNAL = /sport|gym|yoga|running|hiking|training|pilates|tennis|cycling|pool|piscina|swim|beach|spiaggia|mare|snorkeling/i;
    const catalogHasBag = catalog.some((c) => c.category === "Bags");
    const ensureBag = (occasion: string, ids: string[]): string[] => {
      if (gender !== "Woman") return ids;
      if (!catalogHasBag) return ids;
      if (NO_BAG_OCCASION_SIGNAL.test(occasion)) return ids;
      if (ids.some((id) => catalog.find((c) => c.id === id)?.category === "Bags")) return ids;
      const bag = catalog.find((c) => c.category === "Bags" && !ids.includes(c.id));
      return bag ? [...ids, bag.id] : ids;
    };

    const sanitize = (r: DailyLooksResult): DailyLooksResult => {
      // "today" is singular — a violation strips just the offending
      // item(s) rather than discarding the whole look (there's no second
      // candidate to fall back to for "today").
      const todayIds = r.today.item_ids.filter((id) => validIds.has(id));
      const todayHasFullBody = todayIds.some((id) => {
        const item = catalog.find((c) => c.id === id);
        return item?.category === "Dresses" || item?.category === "Jumpsuits";
      });
      const today = {
        ...r.today,
        item_ids: todayIds.filter((id) => {
          if (violatesWeather([id]) || violatesStylingFootwear([id])) return false;
          // If a dress/jumpsuit is present, drop any separate Bottoms item
          // instead of the whole look — a dress alone is still valid,
          // while removing it would leave an incomplete outfit.
          if (todayHasFullBody && catalog.find((c) => c.id === id)?.category === "Bottoms") return false;
          return true;
        }),
      };
      const seen = [today.item_ids];
      const curated: DailyLook[] = [];
      for (const l of r.curated) {
        if (isValidCuratedLook(l, seen)) {
          curated.push(l);
          seen.push(l.item_ids);
        }
      }
      return { today, curated };
    };

    try {
      let text: string;
      try {
        text = (await generateText({ model, system, messages: [{ role: "user", content: userContent }] })).text;
      } catch (err) {
        console.error("[AURA daily-looks] first call failed", err);
        text = "";
      }

      let parsed: DailyLooksResult;
      try {
        parsed = parseAiJson(text, OutputSchema);
      } catch {
        const r2 = await generateText({
          model,
          system,
          messages: [
            { role: "user", content: userContent },
            { role: "assistant", content: text || "(no response)" },
            { role: "user", content: "That was not a single valid JSON object matching the required shape. Reply again with ONLY the JSON object, nothing else." },
          ],
        });
        parsed = parseAiJson(r2.text, OutputSchema);
      }

          const clean = sanitize(parsed);
      if (clean.today.item_ids.length < 2) {
        return { ok: false as const, error: "Couldn't compose a valid look from your wardrobe." };
      }

      // Retry once for any required occasion that didn't survive sanitize
      // — either the model skipped it or a hard filter rejected it. Gives
      // the wardrobe a second, more targeted shot before settling for a
      // partial set of looks.
      const missingOccasions = REQUIRED_OCCASIONS.filter(
        (occ) => !clean.curated.some((l) => l.occasion === occ),
      );

      if (missingOccasions.length > 0) {
        const seenSoFar = [clean.today.item_ids, ...clean.curated.map((l) => l.item_ids)];
        const retrySystem = [
          system,
          "",
          `IMPORTANT — this is a retry. Produce ONLY curated looks for these missing occasions: ${missingOccasions.join(", ")}. Do not repeat "today" or any curated look already produced.`,
        ].join("\n");
        const RetryOutputSchema = z.object({
          curated: z.array(LookSchema).min(1).max(missingOccasions.length),
        });

        try {
          const retryText = (await generateText({
            model,
            system: retrySystem,
            messages: [{ role: "user", content: userContent }],
          })).text;
          const retryParsed = parseAiJson(retryText, RetryOutputSchema);
          for (const l of retryParsed.curated) {
            if ((missingOccasions as string[]).includes(l.occasion) && isValidCuratedLook(l, seenSoFar)) {
              clean.curated.push(l);
              seenSoFar.push(l.item_ids);
            }
          }
        } catch (err) {
          console.error("[AURA daily-looks] retry failed", err);
          // Best-effort: fall through with whatever survived the first pass.
        }
      }

      clean.today = { ...clean.today, item_ids: ensureBag(clean.today.occasion, clean.today.item_ids) };
      clean.curated = clean.curated.map((l) => ({ ...l, item_ids: ensureBag(l.occasion, l.item_ids) }));

      return { ok: true as const, result: clean };

    } catch (err) {
      console.error("[AURA daily-looks] failed", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "Generation failed" };
    }
  });
