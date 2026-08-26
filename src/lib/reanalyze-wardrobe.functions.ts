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
 * fit, heelHeight, toeShape, closure, gender, styleTags) o l'occasione
 * d'uso (occasion) — non recuperabili dal semplice parsing testuale
 * (mapLegacySubcategory in wardrobe-options.ts, NON toccata qui), serve
 * far rivedere la foto all'AI. occasion non viene MAI impostata con un
 * default arbitrario (a differenza di purchase_date, gestita altrove via
 * SQL) — solo con un valore che l'AI ha effettivamente dedotto dalla foto.
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

    // Gate on formality OR occasion, not attrs_backfilled_at — that flag
    // was already set for everyone during the PREVIOUS taxonomy backfill
    // (length/sleeveLength/fit/etc.), so gating on it again here would
    // mean this new round silently finds zero candidates for anyone
    // who's already run the wand once. formality/occasion are the fields
    // THIS round actually needs to fill, so they're the correct
    // completion markers now — an item that already has formality but
    // still lacks occasion (e.g. already ran a previous round of this
    // same wand before the occasion fix shipped) must still be picked
    // up here, hence the OR rather than a single .is() filter.
    // Items with no image at all are excluded — they can never get a
    // formality/occasion value and would otherwise loop forever as
    // candidates.
    const { data: candidates, error: qErr } = await context.supabase
      .from("wardrobe_items")
      .select("id, image_url, category")
      .eq("user_id", context.userId)
      .or("formality.is.null,occasion.is.null")
      .not("image_url", "is", null)
      .limit(BATCH_SIZE);
    if (qErr) throw new Error(qErr.message);

    const items = candidates ?? [];
    let updated = 0;

    for (const item of items) {
      try {
        if (!item.image_url) {
          await context.supabase.from("wardrobe_items")
            .update({ attrs_backfilled_at: new Date().toISOString() } as never)
            .eq("id", item.id);
          continue;
        }
        const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(item.image_url);
        if (dlErr || !blob) {
          console.error("[AURA reanalyze] download failed", item.id, dlErr);
          // Still mark it visited: a permanently-broken image_url would
          // otherwise keep this item in the candidate list forever too.
          await context.supabase.from("wardrobe_items")
            .update({ attrs_backfilled_at: new Date().toISOString() } as never)
            .eq("id", item.id);
          continue;
        }

        const dataUrl = toDataUrl(await blob.arrayBuffer(), blob.type || "image/jpeg");
        const result = await analyzeWardrobeImageCore(dataUrl);

        // Always stamp attrs_backfilled_at — this item has now been
        // checked once. Whichever of these fields genuinely apply to its
        // category get filled; the rest legitimately stay null forever,
        // and that's fine, not a reason to check this item again.
        const patch: Record<string, unknown> = { attrs_backfilled_at: new Date().toISOString() };
        if (result.length) patch.length = result.length;
        if (result.sleeveLength) patch.sleeve_length = result.sleeveLength;
        if (result.fit) patch.fit = result.fit;
        if (result.heelHeight) patch.heel_height = result.heelHeight;
        if (result.toeShape) patch.toe_shape = result.toeShape;
        if (result.closure) patch.closure = result.closure;
        if (result.gender) patch.gender = result.gender;
        if (result.styleTags?.length) patch.style_tags = result.styleTags;
        // formality/dayEvening should apply to virtually every garment —
        // written directly, not gated behind a truthiness check like the
        // optional attributes above (a formality of e.g. 0 would be
        // falsy and silently dropped otherwise).
        patch.formality = result.formality;
        if (result.dayEvening) patch.day_evening = result.dayEvening;
        // occasion: same format as the upload-time flow in AddItem.tsx
        // (a comma-joined string of the AI-picked occasion tags). Only
        // written when the AI actually returned at least one — never a
        // blind default the way purchase_date is (that one's handled
        // separately, directly in SQL, precisely because "today" is a
        // reasonable stand-in for a missing date but not for something
        // the AI needs to genuinely infer from the photo).
        if (result.occasions?.length) patch.occasion = result.occasions.join(", ");

        const { error: updErr } = await context.supabase
          .from("wardrobe_items")
          .update(patch as never)
          .eq("id", item.id);
        if (updErr) { console.error("[AURA reanalyze] update failed", item.id, updErr); continue; }
        if (Object.keys(patch).length > 1) updated++;
      } catch (e) {
        console.error("[AURA reanalyze] item failed", item.id, e);
      }
    }

    const { count: remaining } = await context.supabase
      .from("wardrobe_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .or("formality.is.null,occasion.is.null");

    return { processed: items.length, updated, remaining: remaining ?? 0 };
  });
