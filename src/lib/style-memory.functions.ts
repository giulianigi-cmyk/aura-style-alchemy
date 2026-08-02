import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Style Memory aggregator.
 *
 * SOFT PERSONALIZATION ONLY — never a blocking filter.
 * dress_preferences remains the HARD RULES layer.
 *
 * Flow: outfit_feedback (event log) -> candidate patterns -> user_style_memory
 * -> user_style_memory_active (view, read by the AI stylist).
 */

type MemoryType =
  | "style_archetype"
  | "silhouette"
  | "color_preferred"
  | "color_avoided"
  | "material"
  | "brand"
  | "category"
  | "combination"
  | "avoided_combination"
  | "lifestyle_context";

type ContextAxis = "occasion" | "season" | "weather" | "time_of_day";

type Candidate = {
  memory_type: MemoryType;
  value: string;
};

const CONCENTRATION_RATIO = 0.75;
const MIN_CONTEXT_EVIDENCE = 3;

const norm = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;

/** Deterministic pattern extraction from the items involved in a feedback event. */
function extractCandidates(
  items: Array<{
    category: string | null;
    subcategory: string | null;
    brand: string | null;
    color: string | null;
    colors: string[] | null;
    material: string[] | null;
    style: string | null;
  }>,
  negative: boolean,
): Candidate[] {
  const out = new Map<string, Candidate>();
  const push = (memory_type: MemoryType, value: string | null) => {
    if (!value) return;
    out.set(`${memory_type}::${value}`, { memory_type, value });
  };

  const categories: string[] = [];

  for (const it of items) {
    const cat = norm(it.subcategory) ?? norm(it.category);
    if (cat) categories.push(cat);
    push("category", cat);
    push("brand", norm(it.brand));
    push("style_archetype", norm(it.style));
    for (const m of it.material ?? []) push("material", norm(m));
    const colors = (it.colors?.length ? it.colors : [it.color]).filter(Boolean);
    for (const c of colors) {
      push(negative ? "color_avoided" : "color_preferred", norm(c));
    }
  }

  // Pairwise combinations of distinct categories, sorted for determinism.
  const uniqueCats = Array.from(new Set(categories)).sort();
  for (let i = 0; i < uniqueCats.length; i++) {
    for (let j = i + 1; j < uniqueCats.length; j++) {
      push(
        negative ? "avoided_combination" : "combination",
        `${uniqueCats[i]} + ${uniqueCats[j]}`,
      );
    }
  }

  return Array.from(out.values());
}

function pickContext(
  ctx: Record<string, unknown> | null,
  occasion: string | null,
): { axis: ContextAxis; value: string } | null {
  const occ = norm(occasion) ?? norm(ctx?.["occasion"]);
  if (occ) return { axis: "occasion", value: occ };
  const season = norm(ctx?.["season"]);
  if (season) return { axis: "season", value: season };
  const weather = norm(ctx?.["weather"]) ?? norm(ctx?.["weather_condition"]);
  if (weather) return { axis: "weather", value: weather };
  const tod = norm(ctx?.["time_of_day"]);
  if (tod) return { axis: "time_of_day", value: tod };
  return null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export const aggregateStyleMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { feedbackId: string }) => {
    if (!input?.feedbackId || typeof input.feedbackId !== "string") {
      throw new Error("feedbackId is required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. CLAIM the feedback event atomically (exactly-once guard).
    //    A single UPDATE ... WHERE processed_at IS NULL RETURNING * takes the
    //    row lock; a concurrent second call gets zero rows and exits.
    const { data: claimed, error: claimErr } = await supabase
      .from("outfit_feedback")
      .update({ processed_at: new Date().toISOString(), aggregation_version: AGGREGATION_VERSION })
      .eq("id", data.feedbackId)
      .is("processed_at", null)
      .select("id, user_id, session_id, outfit_id, item_ids, feedback_type, rating, context")
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) {
      // Either the row does not exist / is not ours (RLS), or it was already
      // processed. Either way: do NOT touch user_style_memory.
      return { ok: false as const, reason: "already_processed_or_not_found" };
    }
    const fb = claimed;

    /** Give the claim back so the event can be retried later. */
    const release = async (reason: string) => {
      await supabase
        .from("outfit_feedback")
        .update({ processed_at: null })
        .eq("id", fb.id);
      return { ok: false as const, reason };
    };

    // 2. Resolve the involved items (from the event, or from the outfit).
    let itemIds: string[] = (fb.item_ids ?? []) as string[];
    let occasion: string | null = null;

    if (fb.outfit_id) {
      const { data: outfit } = await supabase
        .from("outfits")
        .select("item_ids, occasion")
        .eq("id", fb.outfit_id)
        .maybeSingle();
      if (outfit) {
        if (!itemIds.length) itemIds = (outfit.item_ids ?? []) as string[];
        occasion = outfit.occasion?.[0] ?? null;
      }
    }
    if (fb.session_id) {
      const { data: session } = await supabase
        .from("outfit_sessions")
        .select("occasion, context")
        .eq("id", fb.session_id)
        .maybeSingle();
      if (session?.occasion) occasion = occasion ?? session.occasion;
    }
    if (!itemIds.length) return await release("no_items");

    const { data: items, error: itemsErr } = await supabase
      .from("wardrobe_items")
      .select("category, subcategory, brand, color, colors, material, style")
      .in("id", itemIds);
    if (itemsErr) {
      await release("items_query_failed");
      throw new Error(itemsErr.message);
    }
    if (!items?.length) return await release("no_items");

    // 3. Weight (configurable, no deploy needed).
    const { data: weightRow } = await supabase
      .from("feedback_weights")
      .select("weight")
      .eq("feedback_type", fb.feedback_type)
      .maybeSingle();
    const weight = Number(weightRow?.weight ?? 0);
    if (!weight) return await release("zero_weight");

    const negative = weight < 0;
    const candidates = extractCandidates(items, negative);
    if (!candidates.length) return await release("no_candidates");


    const scope = pickContext(
      (fb.context ?? null) as Record<string, unknown> | null,
      occasion,
    );

    const now = new Date().toISOString();
    let generalUpdated = 0;
    let scopedUpdated = 0;

    for (const c of candidates) {
      // 4. General memory is ALWAYS updated.
      const { data: existing } = await supabase
        .from("user_style_memory")
        .select("id, confidence_score, evidence_count")
        .eq("user_id", userId)
        .eq("memory_type", c.memory_type)
        .eq("value", c.value)
        .is("context_axis", null)
        .maybeSingle();

      let generalEvidence = 1;
      if (existing) {
        generalEvidence = existing.evidence_count + 1;
        await supabase
          .from("user_style_memory")
          .update({
            confidence_score: clamp01(Number(existing.confidence_score) + Math.abs(weight)),
            evidence_count: generalEvidence,
            last_seen: now,
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("user_style_memory").insert({
          user_id: userId,
          memory_type: c.memory_type,
          value: c.value,
          confidence_score: clamp01(Math.abs(weight)),
          evidence_count: 1,
          source: "outfit_feedback",
          last_seen: now,
        });
      }
      generalUpdated++;

      if (!scope) continue;

      // 5. Scoped memory: deterministic promotion rules only.
      const { data: scopedRow } = await supabase
        .from("user_style_memory")
        .select("id, confidence_score, evidence_count, context_evidence_count")
        .eq("user_id", userId)
        .eq("memory_type", c.memory_type)
        .eq("value", c.value)
        .eq("context_axis", scope.axis)
        .eq("context_value", scope.value)
        .maybeSingle();

      const contextEvidence = (scopedRow?.context_evidence_count ?? 0) + 1;
      const ratio = generalEvidence > 0 ? contextEvidence / generalEvidence : 0;
      const promoted =
        contextEvidence >= MIN_CONTEXT_EVIDENCE && ratio >= CONCENTRATION_RATIO;
      const contextStrength = promoted ? clamp01(ratio) : null;

      if (scopedRow) {
        await supabase
          .from("user_style_memory")
          .update({
            confidence_score: clamp01(Number(scopedRow.confidence_score) + Math.abs(weight)),
            evidence_count: scopedRow.evidence_count + 1,
            context_evidence_count: contextEvidence,
            context_strength: contextStrength,
            last_seen: now,
          })
          .eq("id", scopedRow.id);
      } else {
        await supabase.from("user_style_memory").insert({
          user_id: userId,
          memory_type: c.memory_type,
          value: c.value,
          context_axis: scope.axis,
          context_value: scope.value,
          confidence_score: clamp01(Math.abs(weight)),
          evidence_count: 1,
          context_evidence_count: 1,
          context_strength: null,
          source: "outfit_feedback",
          last_seen: now,
        });
      }
      scopedUpdated++;
    }

    return {
      ok: true as const,
      candidates: candidates.length,
      generalUpdated,
      scopedUpdated,
      scope: scope ? `${scope.axis}:${scope.value}` : null,
    };
  });

/** Soft personalization payload for the AI stylist — reads the active view only. */
export const getActiveStyleMemory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_style_memory_active")
      .select("*")
      .order("effective_confidence", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
