import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Live count of the current user's unread notifications (`read_at is null`).
 * Uses the same realtime channel pattern as the chat notification stream, and
 * also listens for the local `aura:notifications-read` event so the badge
 * clears immediately when the Notifications screen marks rows as read.
 */
export function useUnreadNotifications() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) { setCount(0); return; }
    const { count: c, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    if (!error) setCount(c ?? 0);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications-unread:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => { void refresh(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user, refresh]);

  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener("aura:notifications-read", handler);
    return () => window.removeEventListener("aura:notifications-read", handler);
  }, [refresh]);

  return count;
}
