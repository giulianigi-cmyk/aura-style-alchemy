import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapLegacySubcategory } from "./wardrobe-options";

/**
 * One-time backfill: applies mapLegacySubcategory() (already implemented,
 * not touched here) to every wardrobe item whose subcategory/length/
 * heel_height still reflects the pre-taxonomy-revision values (e.g.
 * subcategory = "Mini Dress" instead of Type + separate Length).
 * Only updates a row if mapLegacySubcategory actually finds something to
 * fix; items already on the new taxonomy are left untouched.
 */
export const migrateLegacyTaxonomy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: items, error } = await context.supabase
      .from("wardrobe_items")
      .select("id, category, subcategory, length, heel_height")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    let updated = 0;
    for (const item of items ?? []) {
      const mapped = mapLegacySubcategory(item.subcategory, item.category);
      const patch: Record<string, string> = {};

      if (mapped.type && mapped.type !== item.subcategory) patch.subcategory = mapped.type;
      if (mapped.length && !item.length) patch.length = mapped.length;
      if (mapped.heelHeight && !item.heel_height && item.category === "Shoes") patch.heel_height = mapped.heelHeight;

      if (Object.keys(patch).length === 0) continue;

      const { error: updErr } = await context.supabase
        .from("wardrobe_items")
        .update(patch)
        .eq("id", item.id);
      if (updErr) {
        console.error("[AURA migrate-legacy-taxonomy] update failed", item.id, updErr);
        continue;
      }
      updated++;
    }

    return { total: items?.length ?? 0, updated };
  });
