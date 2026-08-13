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
 *  utenti autenticati, stesso confine di fiducia di wardrobe_items.
 *
 *  La query viene spezzata in parole: ogni parola deve comparire in
 *  QUALCHE colonna (OR), ma tutte le parole devono essere soddisfatte
 *  (AND) — così "blazer zara" trova un capo con brand="Zara" e
 *  category="Blazer" anche se nessuna singola colonna contiene la frase
 *  intera. Prima cercava la frase intera come stringa letterale in una
 *  colonna sola, quindi qualunque query multi-parola falliva sempre. */
export async function searchProductLibrary(query: string): Promise<ProductLibraryItem[]> {
  const q = query.trim();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);

  let builder = (supabase as any)
    .from("products")
    .select("id, brand, category, subcategory, material, color, color_family, season, description, canonical_image_url");
  for (const token of tokens) {
    const like = `%${token.replace(/[%,]/g, "")}%`;
    builder = builder.or(`brand.ilike.${like},category.ilike.${like},subcategory.ilike.${like},material.ilike.${like},description.ilike.${like}`);
  }

  const { data, error } = await builder.limit(20);
  if (error) {
    console.error("[AURA product-library] search failed", error);
    return [];
  }
  return (data ?? []) as ProductLibraryItem[];
}
