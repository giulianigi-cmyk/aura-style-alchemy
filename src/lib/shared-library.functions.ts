import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Riallinea la libreria condivisa dell'utente (o la svuota se il consenso è spento). */
export const syncMySharedLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { syncSharedLibrary } = await import("./shared-library.server");
    try {
      return await syncSharedLibrary(context.userId);
    } catch (e) {
      console.error("[AURA shared-library] sync failed", e);
      return { synced: 0, removed: 0 };
    }
  });

export type SharedLibraryItem = {
  id: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  color: string | null;
  colors: string[];
  material: string[];
  season: string | null;
  style: string | null;
  occasion: string | null;
  style_tags: string[];
  size: string | null;
  price: number | null;
  currency: string | null;
  gender: string | null;
  length: string | null;
  sleeve_length: string | null;
  fit: string | null;
  heel_height: string | null;
  toe_shape: string | null;
  closure: string | null;
  formality: number | null;
  day_evening: string | null;
  image_url: string;
  signed_url: string | null;
};

/** Ricerca nella libreria condivisa anonima; restituisce URL firmati temporanei. */
export const searchSharedLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string }) => ({ q: String(input?.q ?? "").trim().slice(0, 80) }))
  .handler(async ({ data, context }): Promise<SharedLibraryItem[]> => {
    if (!data.q) return [];
    const like = `%${data.q.replace(/[%,]/g, "")}%`;
    const { data: rows, error } = await (context.supabase as any)
      .from("shared_library_items")
      .select(
        "id, brand, category, subcategory, color, colors, material, season, style, occasion, style_tags, size, price, currency, gender, length, sleeve_length, fit, heel_height, toe_shape, closure, formality, day_evening, image_url",
      )
      .or(
        `brand.ilike.${like},category.ilike.${like},subcategory.ilike.${like},style.ilike.${like},color.ilike.${like}`,
      )
      .limit(30);
    if (error) {
      console.error("[AURA shared-library] search", error);
      return [];
    }
    const list = (rows ?? []) as SharedLibraryItem[];
    if (!list.length) return [];

    const { data: signed, error: signError } = await context.supabase.storage
      .from("shared-library")
      .createSignedUrls(list.map((r) => r.image_url), 60 * 60);
    if (signError) {
      console.error("[AURA shared-library] createSignedUrls failed", signError);
    }
    (signed ?? []).forEach((s) => {
      if (s.error) {
        console.error("[AURA shared-library] signing failed for", s.path, s.error);
      }
    });
    const map = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl]));
    return list.map((r) => ({ ...r, signed_url: map.get(r.image_url) ?? null }));
  });
  });
