import type { Tables } from "@/integrations/supabase/types";

export type WardrobeItem = Tables<"wardrobe_items"> & { subcategory?: string | null; source?: string | null };
export type Outfit = Tables<"outfits">;
