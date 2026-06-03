import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type Profile = {
  id: string;
  full_name: string | null;
  age: number | null;
  gender: string | null;
  style_preferences: string[] | null;
  favorite_brands: string[] | null;
  avatar_url: string | null;
  city: string | null;
  season: string | null;
  setup_complete: boolean;
  created_at: string;
  updated_at: string;
};

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setProfile(null); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (error) console.error("profile load", error);
    if (!data) {
      // fallback create if trigger didn't fire
      const { data: created } = await supabase
        .from("profiles")
        .insert({ id: user.id })
        .select("*")
        .maybeSingle();
      setProfile(created as Profile | null);
    } else {
      setProfile(data as Profile);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const update = useCallback(async (patch: Partial<Profile>) => {
    if (!user) return { error: "Not authenticated" };
    const { data, error } = await supabase
      .from("profiles")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .select("*")
      .maybeSingle();
    if (error) return { error: error.message };
    setProfile(data as Profile);
    return { error: null };
  }, [user]);

  const uploadAvatar = useCallback(async (file: File) => {
    if (!user) return { error: "Not authenticated", url: null };
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
      cacheControl: "3600", upsert: true,
    });
    if (upErr) return { error: upErr.message, url: null };
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const { error } = await update({ avatar_url: data.publicUrl });
    return { error, url: data.publicUrl };
  }, [user, update]);

  return { profile, loading, reload: load, update, uploadAvatar };
}
