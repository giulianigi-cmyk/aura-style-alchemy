// Style Memory Aggregator — SERVER ONLY.
// Reads unprocessed outfit_feedback, extracts structured attribute
// candidates from the linked wardrobe items (deterministic, not a
// generative AI call — the attributes are already structured data),
// and upserts user_style_memory with asymptotic confidence growth.
//
// V1 scope: category, material, brand, color_preferred/avoided,
// style_archetype. Combination and silhouette patterns are deferred
// (need cross-item logic within the same outfit) — see TODO below.

type FeedbackRow = {
  id: string;
  user_id: string;
  item_ids: string[];
  feedback_type: string;
  context: Record<string, unknown> | null;
};

type Candidate = { memory_type: string; value: string };

const CONTEXT_AXES = ["occasion", "season", "weather", "time_of_day"] as const;

function extractCandidates(item: {
  category: string | null;
  brand: string | null;
  colors: string[];
  material: string[];
  style: string | null;
}, weight: number): Candidate[] {
  const out: Candidate[] = [];

  if (weight > 0) {
    if (item.category) out.push({ memory_type: "category", value: item.category.toLowerCase() });
    if (item.brand) out.push({ memory_type: "brand", value: item.brand.toLowerCase() });
    for (const m of item.material ?? []) out.push({ memory_type: "material", value: m.toLowerCase() });
    if (item.style) out.push({ memory_type: "style_archetype", value: item.style.toLowerCase() });
  }

  const colorType = weight > 0 ? "color_preferred" : weight < 0 ? "color_avoided" : null;
  if (colorType) {
    for (const c of item.colors ?? []) out.push({ memory_type: colorType, value: c.toLowerCase() });
  }

  // TODO V2: 'combination' (item pairs worn together) e 'silhouette'
  // (serve un tag fit/cut sugli item, non ancora presente su wardrobe_items).

  return out;
}

export async function runStyleMemoryAggregator(limit = 200) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: rows, error: claimErr } = await supabaseAdmin.rpc("claim_pending_feedback", { _limit: limit });
  if (claimErr) throw new Error(`claim_pending_feedback failed: ${claimErr.message}`);
  const feedback = (rows ?? []) as FeedbackRow[];
  if (feedback.length === 0) return { processed: 0, memories_touched: 0 };

  const { data: weightRows, error: wErr } = await supabaseAdmin.from("feedback_weights").select("feedback_type, weight");
  if (wErr) throw new Error(`feedback_weights fetch failed: ${wErr.message}`);
  const weights = new Map((weightRows ?? []).map((w) => [w.feedback_type, Number(w.weight)]));

  const allItemIds = [...new Set(feedback.flatMap((f) => f.item_ids ?? []))];
  const { data: items, error: iErr } = await supabaseAdmin
    .from("wardrobe_items")
    .select("id, category, brand, colors, material, style")
    .in("id", allItemIds.length ? allItemIds : ["00000000-0000-0000-0000-000000000000"]);
  if (iErr) throw new Error(`wardrobe_items fetch failed: ${iErr.message}`);
  const itemMap = new Map((items ?? []).map((it) => [it.id, it]));

  let touched = 0;

  for (const f of feedback) {
    const weight = weights.get(f.feedback_type);
    if (weight === undefined) continue;

    const contextEntries = CONTEXT_AXES
      .map((axis) => [axis, f.context?.[axis]])
      .filter(([, v]) => typeof v === "string" && v.length > 0) as [string, string][];

    for (const itemId of f.item_ids ?? []) {
      const item = itemMap.get(itemId);
      if (!item) continue;

      for (const cand of extractCandidates(item, weight)) {
        const { data: general, error: gErr } = await supabaseAdmin.rpc("upsert_style_memory", {
          _user_id: f.user_id,
          _memory_type: cand.memory_type,
          _value: cand.value,
          _weight: weight,
          _context_axis: null,
          _context_value: null,
          _mirror_evidence_count: null,
        });
        if (gErr) { console.error("[aggregator] general upsert failed", gErr); continue; }
        const generalEvidenceCount = (general as { evidence_count: number }[])[0]?.evidence_count ?? 1;
        touched++;

        for (const [axis, value] of contextEntries) {
          const { error: sErr } = await supabaseAdmin.rpc("upsert_style_memory", {
            _user_id: f.user_id,
            _memory_type: cand.memory_type,
            _value: cand.value,
            _weight: weight,
            _context_axis: axis,
            _context_value: value,
            _mirror_evidence_count: generalEvidenceCount,
          });
          if (sErr) console.error("[aggregator] scoped upsert failed", sErr);
        }
      }
    }
  }

  return { processed: feedback.length, memories_touched: touched };
}
