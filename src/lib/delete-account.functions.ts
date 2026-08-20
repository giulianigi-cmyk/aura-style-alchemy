import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import type { supabaseAdmin as SupabaseAdmin } from "@/integrations/supabase/client.server";

const STORAGE_BUCKETS = ["avatars", "outfits", "wardrobe"] as const;

/** Best-effort recursive delete of every object under `{userId}/` in a
 *  bucket. DB rows cascade-delete automatically (every foreign key to
 *  auth.users has ON DELETE CASCADE), but Storage objects don't — without
 *  this they'd become orphaned bytes left behind after the account itself
 *  is gone. Two levels deep is enough for AURA's actual folder layout
 *  (e.g. outfits/{userId}/ and outfits/{userId}/thumbs/).
 */
async function purgeUserStorage(
  admin: typeof SupabaseAdmin,
  bucket: string,
  prefix: string,
  depth = 0,
): Promise<void> {
  const { data: entries, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !entries?.length) return;

  const files = entries.filter((e: { id: string | null }) => e.id !== null).map((e: { name: string }) => `${prefix}/${e.name}`);
  if (files.length) await admin.storage.from(bucket).remove(files);

  if (depth < 2) {
    const folders = entries.filter((e: { id: string | null }) => e.id === null);
    for (const folder of folders as { name: string }[]) {
      await purgeUserStorage(admin, bucket, `${prefix}/${folder.name}`, depth + 1);
    }
  }
}

/** Permanently deletes the calling user's account: their Storage files,
 *  then the auth.users row itself (which cascades to every table with a
 *  foreign key to it — profiles, wardrobe_items, outfits, friends,
 *  messages, notifications, and so on). Irreversible. */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    for (const bucket of STORAGE_BUCKETS) {
      try {
        await purgeUserStorage(supabaseAdmin, bucket, userId);
      } catch (err) {
        // Best-effort: a Storage cleanup failure should never block the
        // account deletion itself.
        console.error(`[deleteMyAccount] failed to clean bucket ${bucket}`, err);
      }
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    return { success: true } as const;
  });
