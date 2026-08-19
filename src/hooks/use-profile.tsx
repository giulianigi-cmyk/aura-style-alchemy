import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type Profile = {
  id: string;
  full_name: string | null;
  birth_date: string | null;
  gender: string | null;
  style_preferences: string[] | null;
  favorite_brands: string[] | null;
  owned_brands: string[];
  avatar_url: string | null;
  profile_image: string | null;
  bio: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  season: string | null;
  undertone: string | null;
  value: string | null;
  clarity: string | null;
  industry: string | null;
  work_dress_code: string | null;
  personal_formality: string | null;
  profession: string | null;
    setup_complete: boolean;
  created_at: string;
  updated_at: string;
  // ISO 639-1 code ("it" | "en" | "es" | "fr") the user picked for the UI
  // language, or null if never set (falls back to the app default).
  language: string | null;
};


export function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

async function resolveAvatarUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  const { data, error } = await supabase.storage
    .from("avatars")
    .createSignedUrl(value, 60 * 60);
  if (error) {
    console.error("avatar signed url", error);
    return null;
  }
  return data?.signedUrl ?? null;
}

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAvatar = useCallback(async (val: string | null | undefined) => {
    setAvatarUrl(await resolveAvatarUrl(val));
  }, []);

  const load = useCallback(async () => {
    if (!user) { setProfile(null); setAvatarUrl(null); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (error) console.error("profile load", error);
    let final: Profile | null = null;
    if (!data) {
      const { data: created } = await supabase
        .from("profiles")
        .insert({ id: user.id })
        .select("*")
        .maybeSingle();
            final = created as unknown as Profile | null;
    } else {
      final = data as unknown as Profile;

    }
    setProfile(final);
    await refreshAvatar(final?.profile_image);
    setLoading(false);
  }, [user, refreshAvatar]);

  useEffect(() => { load(); }, [load]);

    const update = useCallback(async (patch: Partial<Profile>) => {
    if (!user) return { error: "Not authenticated" };
    const { data, error } = await supabase
      .from("profiles")
      // Cast needed until the `language` column migration is applied and
      // supabase types.ts is regenerated — the generated Update type
      // doesn't know about it yet, even though the column exists at
      // runtime once the migration below has run. Safe to drop this cast
      // once types.ts is regenerated post-migration.
      .update({ ...patch, updated_at: new Date().toISOString() } as never)

      .eq("id", user.id)
      .select("*")
      .maybeSingle();
    if (error) return { error: error.message };
        const next = data as unknown as Profile;
    setProfile(next);
    if ("profile_image" in patch) await refreshAvatar(next?.profile_image);
    return { error: null };
  }, [user, refreshAvatar]);

  const uploadAvatar = useCallback(async (file: File) => {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      const msg = authErr?.message ?? "Not authenticated";
      console.error("avatar upload auth", authErr);
      return { error: msg, url: null };
    }
    const uid = auth.user.id;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${uid}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    if (upErr) {
      console.error("avatar upload", upErr);
      return { error: upErr.message, url: null };
    }
    const { error } = await update({ profile_image: path });
    if (error) console.error("avatar profile update", error);
    return { error, url: path };
  }, [update]);

  return { profile, avatarUrl, loading, reload: load, update, uploadAvatar };
}
