import { supabase } from "@/integrations/supabase/client";

/* ---------------------------------------------------------------- types */

export type Conversation = {
  conversation_id: string;
  status: string;
  is_group: boolean;
  created_at: string;
  my_role: string;
  title: string | null;
  other_id: string | null;
  other_profile_image: string | null;
  member_count: number;
  last_message_at: string | null;
  last_message_type: string | null;
  last_message_body: string | null;
  unread_count: number;
  can_send: boolean;
};

export type ChatMessage = {
  id: string;
  sender_id: string;
  sender_username: string | null;
  sender_profile_image: string | null;
  content_type: "text" | "outfit_share" | "system";
  body: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  deleted_at: string | null;
  ref_type: "outfit" | "outfit_plan" | "event_snapshot" | null;
  outfit_id: string | null;
  snapshot_image_url: string | null;
  event_snapshot: Record<string, unknown> | null;
  like_count: number;
  dislike_count: number;
  my_reaction: "like" | "dislike" | null;
  comment_count: number;
};

export type ChatParticipant = {
  user_id: string;
  username: string | null;
  profile_image: string | null;
  role: string;
  joined_at: string;
  left_at: string | null;
};

export type MessageComment = {
  id: string;
  user_id: string;
  username: string | null;
  profile_image: string | null;
  body: string;
  created_at: string;
};

export type EventSnapshot = {
  title?: string | null;
  date?: string | null;
  location?: string | null;
};

/* ------------------------------------------------------------ read APIs */

export async function listConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase.rpc("list_conversations");
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc("get_conversation_messages", {
    _conversation_id: conversationId,
    _limit: 300,
  });
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export async function listParticipants(conversationId: string): Promise<ChatParticipant[]> {
  const { data, error } = await supabase.rpc("get_conversation_participants", {
    _conversation_id: conversationId,
  });
  if (error) throw error;
  return (data ?? []) as ChatParticipant[];
}

export async function listMessageComments(messageId: string): Promise<MessageComment[]> {
  const { data, error } = await supabase.rpc("get_message_thread_comments", { _message_id: messageId });
  if (error) throw error;
  return (data ?? []) as MessageComment[];
}

export async function markRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_conversation_read", { _conversation_id: conversationId });
  if (error) console.error("[AURA chat] mark read", error);
}

/* --------------------------------------------------- conversation admin */
/* Never insert directly into conversations / conversation_participants —
 * every mutation goes through a SECURITY DEFINER function that enforces
 * friendship, membership and admin rules. */

export async function getOrCreateDirect(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", { _other: otherId });
  if (error) throw error;
  return data as unknown as string;
}

export async function createGroup(memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc("create_group_conversation", { _members: memberIds });
  if (error) throw error;
  return data as unknown as string;
}

export async function addParticipant(conversationId: string, newMember: string): Promise<void> {
  const { error } = await supabase.rpc("add_group_participant", {
    _conversation_id: conversationId,
    _new_member: newMember,
  });
  if (error) throw error;
}

export async function removeParticipant(conversationId: string, target: string): Promise<void> {
  const { error } = await supabase.rpc("remove_group_participant", {
    _conversation_id: conversationId,
    _target: target,
  });
  if (error) throw error;
}

export async function leaveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("leave_group_conversation", { _conversation_id: conversationId });
  if (error) throw error;
}

export async function promoteToAdmin(conversationId: string, target: string): Promise<void> {
  const { error } = await supabase.rpc("promote_to_admin", {
    _conversation_id: conversationId,
    _target: target,
  });
  if (error) throw error;
}

/* -------------------------------------------------------------- writing */

export async function sendText(conversationId: string, senderId: string, body: string): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: senderId,
    content_type: "text",
    body,
  });
  if (error) throw error;
}

/** Shares an outfit: message first, then its reference row carrying the
 *  canvas snapshot path and (optionally) a denormalised event snapshot.
 *  We never store an FK to calendar_events_cache — those ids are unstable
 *  and the row itself is private. */
export async function sendOutfitShare(params: {
  conversationId: string;
  senderId: string;
  outfitId: string | null;
  snapshotImageUrl: string | null;
  body?: string | null;
  eventSnapshot?: EventSnapshot | null;
}): Promise<void> {
  const { data: msg, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: params.conversationId,
      sender_id: params.senderId,
      content_type: "outfit_share",
      body: params.body?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: refError } = await supabase.from("message_references").insert({
    message_id: (msg as { id: string }).id,
    ref_type: params.outfitId ? "outfit" : "event_snapshot",
    outfit_id: params.outfitId,
    snapshot_image_url: params.snapshotImageUrl,
    event_snapshot: (params.eventSnapshot ?? null) as never,
  });
  if (refError) throw refError;
}

export async function toggleReaction(
  messageId: string,
  userId: string,
  reaction: "like" | "dislike",
  current: "like" | "dislike" | null,
): Promise<void> {
  if (current === reaction) {
    const { error } = await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }
  if (current) {
    await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", userId);
  }
  const { error } = await supabase
    .from("message_reactions")
    .insert({ message_id: messageId, user_id: userId, reaction_type: reaction });
  if (error) throw error;
}

export async function addMessageComment(messageId: string, userId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from("message_comments")
    .insert({ message_id: messageId, user_id: userId, body });
  if (error) throw error;
}

/* --------------------------------------------------------------- blocks */

export async function listBlockedIds(): Promise<string[]> {
  const { data, error } = await supabase.from("user_blocks").select("blocked_id");
  if (error) throw error;
  return (data ?? []).map((r) => r.blocked_id);
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from("user_blocks")
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error && error.code !== "23505") throw error;
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}

/* -------------------------------------------------------------- helpers */

export function systemMessageText(
  m: ChatMessage,
  nameOf: (id: string) => string,
): string {
  const meta = (m.metadata ?? {}) as { action?: string; target_user?: string };
  const actor = m.sender_username ?? nameOf(m.sender_id);
  const target = meta.target_user ? nameOf(meta.target_user) : "";
  switch (meta.action) {
    case "added": return `${actor} ha aggiunto ${target}`;
    case "removed": return `${actor} ha rimosso ${target}`;
    case "left": return `${actor} ha lasciato il gruppo`;
    default: return "Aggiornamento della conversazione";
  }
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}
