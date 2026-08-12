import { supabase } from "@/integrations/supabase/client";

export type ProductLibraryItem = {
  id: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  material: string | null;
  color: string | null;
  color_family: string | null;
  season: string | null;
  description: string | null;
  canonical_image_url: string | null;
};

/** Cerca nella AURA Product Library per brand, categoria, materiale o
 *  descrizione. Query lato client — la RLS limita già la SELECT agli
 *  utenti autenticati, stesso confine di fiducia di wardrobe_items. */
export async function searchProductLibrary(query: string): Promise<ProductLibraryItem[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  const { data, error } = await (supabase as any)
    .from("products")
    .select("id, brand, category, subcategory, material, color, color_family, season, description, canonical_image_url")
    .or(`brand.ilike.${like},category.ilike.${like},subcategory.ilike.${like},material.ilike.${like},description.ilike.${like}`)
    .limit(20);
  if (error) {
    console.error("[AURA product-library] search failed", error);
    return [];
  }
  return (data ?? []) as ProductLibraryItem[];
}
