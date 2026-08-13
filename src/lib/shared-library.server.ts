/**
 * Shared library sync — server-only.
 *
 * Perché non un trigger Postgres puro: la sincronizzazione deve anche
 * COPIARE il file immagine in un bucket anonimo (nome randomico, nessun
 * riferimento a user_id). Lo storage non è raggiungibile da plpgsql, quindi
 * il "trigger" è una funzione server-side con service role invocata dopo le
 * scritture su wardrobe_items e al cambio del consenso.
 *
 * Anonimizzazione:
 *  - owner_hash = HMAC-SHA256(user_id, segreto in Vault) — non reversibile,
 *    calcolato solo lato server, serve solo a de-duplicare e a poter
 *    rimuovere tutto in caso di revoca.
 *  - immagine copiata in bucket privato `shared-library` con nome
 *    `<uuid random>.<ext>`; nessun path contiene lo user_id.
 *  - la riga derivata non contiene user_id, worn_count, last_worn,
 *    purchase_date, location_id, né il path originale (colonna
 *    source_image_path revocata in SELECT per authenticated).
 */

const SHARED_BUCKET = "shared-library";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** Campi prodotto copiati nella libreria condivisa (mai campi personali). */
const PRODUCT_FIELDS = [
  "category", "subcategory", "brand", "color", "colors", "material", "season",
  "style", "occasion", "style_tags", "size", "price", "currency", "gender",
  "length", "sleeve_length", "fit", "heel_height", "toe_shape", "closure",
  "formality", "day_evening", "product_id",
] as const;

function toStoragePath(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (!imageUrl.startsWith("http")) return imageUrl;
  const idx = imageUrl.indexOf("/wardrobe/");
  return idx >= 0 ? imageUrl.slice(idx + "/wardrobe/".length) : null;
}

async function ownerHash(admin: Admin, userId: string): Promise<string> {
  const { data, error } = await (admin as any).rpc("shared_library_owner_hash", { _user_id: userId });
  if (error || !data) throw new Error(`owner hash failed: ${error?.message ?? "empty"}`);
  return data as string;
}

async function copyImageAnon(admin: Admin, sourcePath: string): Promise<string | null> {
  const dl = await admin.storage.from("wardrobe").download(sourcePath);
  if (dl.error || !dl.data) {
    console.error("[AURA shared-library] download failed", sourcePath, dl.error);
    return null;
  }
  const ext = (sourcePath.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const anonPath = `${crypto.randomUUID()}.${ext}`;
  const up = await admin.storage.from(SHARED_BUCKET).upload(anonPath, dl.data, {
    contentType: dl.data.type || "image/png",
    upsert: false,
  });
  if (up.error) {
    console.error("[AURA shared-library] upload failed", up.error);
    return null;
  }
  return anonPath;
}

async function removeAnonImages(admin: Admin, paths: string[]) {
  const clean = paths.filter(Boolean);
  if (!clean.length) return;
  const { error } = await admin.storage.from(SHARED_BUCKET).remove(clean);
  if (error) console.error("[AURA shared-library] remove images", error);
}

/** Rimuove ogni traccia dell'utente dalla libreria condivisa (righe + immagini anonime). */
export async function revokeSharedLibrary(userId: string): Promise<{ removed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const hash = await ownerHash(supabaseAdmin, userId);
  const { data: rows } = await (supabaseAdmin as any)
    .from("shared_library_items").select("id, image_url").eq("owner_hash", hash);
  await removeAnonImages(supabaseAdmin, (rows ?? []).map((r: any) => r.image_url));
  await (supabaseAdmin as any).from("shared_library_items").delete().eq("owner_hash", hash);
  return { removed: rows?.length ?? 0 };
}

/**
 * Riallinea l'intera libreria condivisa dell'utente al suo guardaroba attuale:
 * inserisce i capi nuovi (copiando l'immagine), aggiorna i metadati cambiati,
 * rigenera l'immagine anonima se la foto originale è stata sostituita e
 * rimuove le righe di capi cancellati o archiviati.
 * Se il consenso è spento, equivale a una revoca completa.
 */
export async function syncSharedLibrary(userId: string): Promise<{ synced: number; removed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile } = await (supabaseAdmin as any)
    .from("profiles").select("share_wardrobe_to_library").eq("id", userId).maybeSingle();

  if (!profile?.share_wardrobe_to_library) {
    const { removed } = await revokeSharedLibrary(userId);
    return { synced: 0, removed };
  }

  const hash = await ownerHash(supabaseAdmin, userId);

  const [{ data: items }, { data: existing }] = await Promise.all([
    (supabaseAdmin as any).from("wardrobe_items").select("*").eq("user_id", userId).eq("archived", false),
    (supabaseAdmin as any).from("shared_library_items")
      .select("id, source_item_id, image_url, source_image_path").eq("owner_hash", hash),
  ]);

  const byItem = new Map<string, any>((existing ?? []).map((r: any) => [r.source_item_id, r]));
  const liveIds = new Set<string>();
  let synced = 0;

  for (const item of items ?? []) {
    const sourcePath = toStoragePath(item.image_url);
    if (!sourcePath) continue;
    liveIds.add(item.id);

    const prev = byItem.get(item.id);
    const fields: Record<string, unknown> = {};
    for (const f of PRODUCT_FIELDS) fields[f] = (item as any)[f] ?? null;
    // array columns are NOT NULL in the derived table
    fields["colors"] = item.colors ?? [];
    fields["material"] = item.material ?? [];
    fields["style_tags"] = item.style_tags ?? [];

    if (prev && prev.source_image_path === sourcePath) {
      await (supabaseAdmin as any).from("shared_library_items").update(fields).eq("id", prev.id);
      synced++;
      continue;
    }

    const anonPath = await copyImageAnon(supabaseAdmin, sourcePath);
    if (!anonPath) continue;

    if (prev) {
      await (supabaseAdmin as any).from("shared_library_items")
        .update({ ...fields, image_url: anonPath, source_image_path: sourcePath }).eq("id", prev.id);
      await removeAnonImages(supabaseAdmin, [prev.image_url]);
    } else {
      const { error } = await (supabaseAdmin as any).from("shared_library_items").insert({
        ...fields,
        owner_hash: hash,
        source_item_id: item.id,
        image_url: anonPath,
        source_image_path: sourcePath,
      });
      if (error) {
        console.error("[AURA shared-library] insert", error);
        await removeAnonImages(supabaseAdmin, [anonPath]);
        continue;
      }
    }
    synced++;
  }

  const stale = (existing ?? []).filter((r: any) => !liveIds.has(r.source_item_id));
  if (stale.length) {
    await removeAnonImages(supabaseAdmin, stale.map((r: any) => r.image_url));
    await (supabaseAdmin as any).from("shared_library_items")
      .delete().in("id", stale.map((r: any) => r.id));
  }

  return { synced, removed: stale.length };
}
