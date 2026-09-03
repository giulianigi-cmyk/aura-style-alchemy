import { supabase } from "@/integrations/supabase/client";

export type Friendship = {
  friendship_id: string;
  other_id: string;
  username: string | null;
  profile_image: string | null;
  status: string;
  direction: string;
  created_at: string;
};

export type FeedRow = {
  share_id: string;
  outfit_id: string;
  shared_by: string;
  shared_with: string;
  created_at: string;
  direction: string;
  outfit_name: string | null;
  canvas_image_url: string | null;
  other_username: string | null;
  other_profile_image: string | null;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
};

export type ShareComment = {
  id: string;
  user_id: string;
  username: string | null;
  profile_image: string | null;
  body: string;
  created_at: string;
};

export type SearchResult = {
  id: string;
  username: string | null;
  profile_image: string | null;
  relation: string;
};

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function initials(username?: string | null): string {
  const u = (username ?? "").replace(/[^a-z0-9]/gi, "");
  return (u.slice(0, 2) || "??").toUpperCase();
}

/** Sign a batch of storage paths in a bucket. Full http(s) values pass through. */
export async function signPaths(bucket: string, values: (string | null | undefined)[]) {
  const map: Record<string, string> = {};
  const paths: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (/^https?:\/\//i.test(v)) { map[v] = v; continue; }
    if (!paths.includes(v)) paths.push(v);
  }
  if (paths.length) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
    if (error) console.error("[AURA] sign", bucket, error);
    data?.forEach((row, i) => { if (row.signedUrl) map[paths[i]] = row.signedUrl; });
  }
  return map;
}

export async function listFriendships(): Promise<Friendship[]> {
  const { data, error } = await supabase.rpc("list_friendships");
  if (error) throw error;
  return (data ?? []) as Friendship[];
}

export async function acceptedFriends(): Promise<Friendship[]> {
  return (await listFriendships()).filter((f) => f.status === "accepted");
}

export async function getFeed(): Promise<FeedRow[]> {
  const { data, error } = await supabase.rpc("get_shared_feed");
  if (error) throw error;
  return (data ?? []) as FeedRow[];
}

export async function getComments(shareId: string): Promise<ShareComment[]> {
  const { data, error } = await supabase.rpc("get_share_comments", { _share_id: shareId });
  if (error) throw error;
  return (data ?? []) as ShareComment[];
}

export async function searchProfiles(q: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc("search_profiles", { _q: q });
  if (error) throw error;
  return (data ?? []) as SearchResult[];
}
