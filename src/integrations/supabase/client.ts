import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://cbbxxplifhaptquzjjtr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_CWeKT6ZkIARTNc6xlXi7lw_QTUlihYD";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});

export type WardrobeItem = {
  id: string;
  user_id: string;
  brand: string | null;
  category: string | null;
  color: string | null;
  season: string | null;
  style: string | null;
  occasion: string | null;
  image_url: string;
  created_at: string;
};

export type Outfit = {
  id: string;
  user_id: string;
  name: string;
  item_ids: string[];
  cover_url: string | null;
  created_at: string;
};
