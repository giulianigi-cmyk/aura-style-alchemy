import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { analyzeWardrobeImageCore } from "./ai-analyze.functions";

const BUCKET = "wardrobe";
// Piccolo lotto per chiamata: il client la richiama in loop mostrando il
// progresso, così restiamo sempre dentro i limiti di tempo del server
// anche con guardaroba da centinaia di capi.
const BATCH_SIZE = 5;

function toDataUrl(bytes: ArrayBuffer, contentType: string): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  return `data:${contentType || "image/jpeg"};base64,${b64}`;
}

/**
 * Ri-analizza in batch i capi già in guardaroba che non hanno ancora gli
 * attributi introdotti dopo la revisione tassonomia (length, sleeveLength,
 * fit, heelHeight, toeShape, closure, gender, styleTags) — non recuperabili
 * dal semplice parsing testuale (mapLegacySubcategory in wardrobe-options.ts,
 * NON toccata qui), serve far rivedere la foto all'AI.
 *
 * Non tocca MAI category/subcategory/colori/materiali/brand già presenti —
 * aggiorna solo i campi nuovi, e solo quando il risultato AI ne produce
 * uno (mai sovrascrive con vuoto, mai sovrascrive una correzione manuale
 * già fatta, perché i candidati sono già filtrati per avere quei campi
 * nulli in partenza).
 */
export const reanalyzeWardrobeBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: candidates, error: qErr } = await context.supabase
      .from("wardrobe_items")
      .select("id, image_url, category")
      .eq("user_id", context.userId)
      .is("length", null)
      .is("sleeve_length", null)
      .is("fit", null)
      .is("heel_height", null)
      .limit(BATCH_SIZE);
    if (qErr) throw new Error(qErr.message);

    const items = candidates ?? [];
    let updated = 0;

    for (const item of items) {
      try {
        if (!item.image_url) continue;
        const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(item.image_url);
        if (dlErr || !blob) { console.error("[AURA reanalyze] download failed", item.id, dlErr); continue; }

        const dataUrl = toDataUrl(await blob.arrayBuffer(), blob.type || "image/jpeg");
        const result = await analyzeWardrobeImageCore(dataUrl);

        const patch: Record<string, unknown> = {};
        if (result.length) patch.length = result.length;
        if (result.sleeveLength) patch.sleeve_length = result.sleeveLength;
        if (result.fit) patch.fit = result.fit;
        if (result.heelHeight) patch.heel_height = result.heelHeight;
        if (result.toeShape) patch.toe_shape = result.toeShape;
        if (result.closure) patch.closure = result.closure;
        if (result.gender) patch.gender = result.gender;
        if (result.styleTags?.length) patch.style_tags = result.styleTags;

        if (Object.keys(patch).length === 0) continue;

        const { error: updErr } = await context.supabase
          .from("wardrobe_items")
          .update(patch)
          .eq("id", item.id);
        if (updErr) { console.error("[AURA reanalyze] update failed", item.id, updErr); continue; }
        updated++;
      } catch (e) {
        console.error("[AURA reanalyze] item failed", item.id, e);
      }
    }

    const { count: remaining } = await context.supabase
      .from("wardrobe_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .is("length", null)
      .is("sleeve_length", null)
      .is("fit", null)
      .is("heel_height", null);

    return { processed: items.length, updated, remaining: remaining ?? 0 };
  });
