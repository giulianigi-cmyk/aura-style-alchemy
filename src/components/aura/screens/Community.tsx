import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Heart, MessageCircle, Loader2, Search, UserPlus, Check, X, Trash2, Send } from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ConversationList } from "../ConversationList";
import {
  USERNAME_RE, initials, signPaths, listFriendships, getFeed, getComments, searchProfiles,
  type Friendship, type FeedRow, type ShareComment, type SearchResult,
} from "@/lib/community";

function Avatar({ url, username, size = 36 }: { url?: string | null; username?: string | null; size?: number }) {
  if (url) return <img src={url} alt="" style={{ height: size, width: size }} className="rounded-full object-cover" />;
  return (
    <div
      style={{ height: size, width: size }}
      className="rounded-full bg-secondary/60 flex items-center justify-center text-[10px] tracking-widest"
    >{initials(username)}</div>
  );
}

/* ---------------------------------------------------------------- username */

function UsernameSheet({ onSaved }: { onSaved: (u: string) => void }) {
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const valid = USERNAME_RE.test(value);

  useEffect(() => {
    if (!valid) { setAvailable(null); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("username_available", { _username: value });
      setChecking(false);
      setAvailable(error ? null : Boolean(data));
    }, 400);
    return () => { clearTimeout(t); setChecking(false); };
  }, [value, valid]);

  const save = async () => {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const me = userData.user?.id;
    if (!me) { setSaving(false); toast.error("You are signed out"); return; }
    const { error } = await supabase.from("profiles").upsert({ id: me, username: value }, { onConflict: "id" });
    setSaving(false);
    if (error) {
      if (error.code === "23505") { setAvailable(false); toast.error("Username is no longer available."); }
      else toast.error(error.message);
      return;
    }
    toast.success("Username saved");
    onSaved(value);
  };

    return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/95 backdrop-blur flex items-end">
      <div className="w-full bg-card rounded-t-3xl border-t border-border p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-3">
        <p className="font-serif italic text-2xl">Choose a username</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          3–20 characters. Lowercase letters, numbers and underscores only.
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase().replace(/\s+/g, ""))}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="yourname"
          className="w-full bg-secondary/60 rounded-full px-4 py-3 text-sm outline-none"
        />
        <p className="text-[11px] h-4 text-muted-foreground">
          {value.length === 0 ? "" :
            !valid ? "Invalid format." :
            checking ? "Checking…" :
            available === true ? "Available" :
            available === false ? "Already taken" : ""}
        </p>
        <button
          onClick={() => void save()}
          disabled={!valid || available !== true || saving}
          className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-50"
        >{saving ? "Saving…" : "Save"}</button>
            </div>
    </div>,
        document.body,
  );
}

/* ------------------------------------------------------------------ feed */


function FeedCard({ row, avatar, image, onChanged, meId }: {
  row: FeedRow; avatar?: string | null; image?: string | null;
  onChanged: () => void; meId: string;
}) {
  const [liked, setLiked] = useState(row.liked_by_me);
  const [likes, setLikes] = useState(Number(row.like_count));
  const [openComments, setOpenComments] = useState(false);
  const [comments, setComments] = useState<ShareComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [body, setBody] = useState("");
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => { setLiked(row.liked_by_me); setLikes(Number(row.like_count)); }, [row.liked_by_me, row.like_count]);

  const toggleLike = async () => {
    const next = !liked;
    setLiked(next); setLikes((n) => n + (next ? 1 : -1));
    const { error } = next
      ? await supabase.from("outfit_likes").insert({ share_id: row.share_id, user_id: meId })
      : await supabase.from("outfit_likes").delete().eq("share_id", row.share_id).eq("user_id", meId);
    if (error) {
      setLiked(!next); setLikes((n) => n + (next ? -1 : 1));
      toast.error(error.code === "23505" ? "Already liked" : error.message);
    }
  };

  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    try { setComments(await getComments(row.share_id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not load comments"); }
    finally { setLoadingComments(false); }
  }, [row.share_id]);

  const toggleComments = () => {
    const next = !openComments;
    setOpenComments(next);
    if (next) void loadComments();
  };

  const addComment = async () => {
    const text = body.trim();
    if (!text) return;
    const { error } = await supabase.from("outfit_comments").insert({ share_id: row.share_id, user_id: meId, body: text });
    if (error) { toast.error(error.message); return; }
    setBody("");
    await loadComments();
    onChanged();
  };

  const removeComment = async (id: string) => {
    const { error } = await supabase.from("outfit_comments").delete().eq("id", id).eq("user_id", meId);
    if (error) { toast.error(error.message); return; }
    await loadComments();
    onChanged();
  };

  return (
    <article className="animate-fade-up">
      <div className="px-6 flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Avatar url={avatar} username={row.other_username} />
          <div>
            <p className="text-sm font-medium">{row.other_username ?? "—"}</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {row.direction === "outgoing" ? "You shared" : "Shared with you"}
            </p>
          </div>
        </div>
      </div>

      <div className="relative" style={{ background: "#FFFFFF" }}>
        {image && !imgFailed ? (
          <img
            src={image}
            alt={row.outfit_name ?? "Outfit"}
            onError={() => setImgFailed(true)}
            className="aspect-[4/5] w-full object-contain"
          />
        ) : (
          <div className="aspect-[4/5] w-full flex items-center justify-center text-xs text-muted-foreground">
            {row.canvas_image_url ? "Image unavailable" : "No canvas image"}
          </div>
        )}
      </div>

      <div className="px-6 mt-3 flex items-center gap-4">
        <button onClick={() => void toggleLike()} className="flex items-center gap-1.5 active:scale-90 transition">
          <Heart size={18} fill={liked ? "currentColor" : "none"} /><span className="text-xs">{likes}</span>
        </button>
        <button onClick={toggleComments} className="flex items-center gap-1.5 active:scale-90 transition">
          <MessageCircle size={18} /><span className="text-xs">{Number(row.comment_count)}</span>
        </button>
      </div>

      {row.outfit_name && (
        <p className="px-6 mt-2 text-sm leading-relaxed">
          <span className="font-medium">{row.other_username ?? ""}</span>{" "}
          <span className="text-foreground/80">{row.outfit_name}</span>
        </p>
      )}

      {openComments && (
        <div className="px-6 mt-3 space-y-2">
          {loadingComments ? (
            <Loader2 size={14} className="animate-spin" />
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          ) : comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <p className="text-sm flex-1">
                <span className="font-medium">{c.username ?? "—"}</span>{" "}
                <span className="text-foreground/80">{c.body}</span>
              </p>
              {c.user_id === meId && (
                <button onClick={() => void removeComment(c.id)} aria-label="Delete comment" className="text-muted-foreground active:scale-90">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment…"
              className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
            />
            <button
              onClick={() => void addComment()}
              disabled={!body.trim()}
              aria-label="Send comment"
              className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-40 active:scale-90"
            ><Send size={14} /></button>
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ main */

export function Community({ go, openConversation }: { go: (s: Screen) => void; openConversation?: (id: string) => void }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<"feed" | "chat" | "friends">("feed");
  const [username, setUsername] = useState<string | null>(null);
  const [profileReady, setProfileReady] = useState(false);

  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [feedImages, setFeedImages] = useState<Record<string, string>>({});
  const [feedAvatars, setFeedAvatars] = useState<Record<string, string>>({});
  const [loadingFeed, setLoadingFeed] = useState(true);

  const [friends, setFriends] = useState<Friendship[]>([]);
  const [friendAvatars, setFriendAvatars] = useState<Record<string, string>>({});
  const [loadingFriends, setLoadingFriends] = useState(true);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // profile / username gate
  useEffect(() => {
    if (!user) return;
    let on = true;
    (async () => {
      const { data, error } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
      if (!on) return;
      if (error) toast.error(error.message);
      setUsername(data?.username ?? null);
      setProfileReady(true);
    })();
    return () => { on = false; };
  }, [user]);

  const loadFeed = useCallback(async () => {
    if (!user) return;
    setLoadingFeed(true);
    try {
      const rows = await getFeed();
      setFeed(rows);
      const [imgs, avs] = await Promise.all([
        signPaths("outfits", rows.map((r) => r.canvas_image_url)),
        signPaths("avatars", rows.map((r) => r.other_profile_image)),
      ]);
      setFeedImages(imgs);
      setFeedAvatars(avs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the feed");
    } finally {
      setLoadingFeed(false);
    }
  }, [user]);

  const loadFriends = useCallback(async () => {
    if (!user) return;
    setLoadingFriends(true);
    try {
      const list = await listFriendships();
      setFriends(list);
      setFriendAvatars(await signPaths("avatars", list.filter((f) => f.status === "accepted").map((f) => f.profile_image)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load friends");
    } finally {
      setLoadingFriends(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user || !username) { setLoadingFeed(false); setLoadingFriends(false); return; }
    void loadFeed();
    void loadFriends();
  }, [user, username, loadFeed, loadFriends]);

  // debounced username search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setResults(await searchProfiles(q)); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Search failed"); }
      finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [query, friends]);

  const sendRequest = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("friends").insert({ requester_id: user.id, addressee_id: id });
    if (error) { toast.error(error.code === "23505" ? "Request already sent" : error.message); return; }
    toast.success("Request sent");
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, relation: "outgoing" } : r)));
    await loadFriends();
  };

  const accept = async (f: Friendship) => {
    const { error } = await supabase.from("friends").update({ status: "accepted" }).eq("id", f.friendship_id);
    if (error) { toast.error(error.message); return; }
    toast.success(`You and ${f.username ?? "they"} are now friends`);
    await Promise.all([loadFriends(), loadFeed()]);
  };

  const removeFriendship = async (f: Friendship, label: string) => {
    const { error } = f.status === "accepted"
      ? await supabase.rpc("unfriend", { _other: f.other_id })
      : await supabase.from("friends").delete().eq("id", f.friendship_id);
    if (error) { toast.error(error.message); return; }
    toast.success(label);
    await Promise.all([loadFriends(), loadFeed()]);
  };

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center px-10 text-center">
        <p className="text-sm text-muted-foreground">Sign in to use the community.</p>
      </div>
    );
  }

  const incoming = friends.filter((f) => f.status === "pending" && f.direction === "incoming");
  const outgoing = friends.filter((f) => f.status === "pending" && f.direction === "outgoing");
  const accepted = friends.filter((f) => f.status === "accepted");

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">The atelier</p>
          <h1 className="font-serif text-4xl mt-1">Community</h1>
        </div>
        <div className="flex items-center gap-3">
          {username && <p className="text-xs text-muted-foreground">@{username}</p>}
        </div>
      </header>

      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar px-6">
        {(["feed", "chat", "friends"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs transition ${tab === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
          >{c === "feed" ? "Feed" : c === "chat" ? "Chat" : "Friends"}</button>
        ))}
      </div>

      {tab === "chat" ? (
        <ConversationList
          openThread={(id) => (openConversation ? openConversation(id) : go("chats"))}
          onStartChat={() => go("chats")}
        />
      ) : tab === "friends" ? (
        <div className="mt-6 px-6 space-y-8">
          <section>
            <div className="flex items-center gap-2 bg-secondary/60 rounded-full px-4 py-2.5">
              <Search size={14} className="text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value.toLowerCase())}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Search by username"
                className="flex-1 bg-transparent text-sm outline-none"
              />
              {searching && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
            </div>
            <div className="mt-3 space-y-1">
              {results.map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-2">
                  <Avatar username={r.username} />
                  <span className="text-sm flex-1">{r.username}</span>
                  {r.relation === "friends" ? (
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Friends</span>
                  ) : r.relation === "outgoing" ? (
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Pending</span>
                  ) : r.relation === "incoming" ? (
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Requested you</span>
                  ) : (
                    <button
                      onClick={() => void sendRequest(r.id)}
                      className="h-8 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] active:scale-95 inline-flex items-center gap-1.5"
                    ><UserPlus size={11} /> Add</button>
                  )}
                </div>
              ))}
              {query.trim().length >= 2 && !searching && results.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">No one found.</p>
              )}
            </div>
          </section>

          {loadingFriends ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div>
          ) : (
            <>
              {incoming.length > 0 && (
                <section>
                  <h2 className="font-serif text-2xl italic mb-2">Requests</h2>
                  {incoming.map((f) => (
                    <div key={f.friendship_id} className="flex items-center gap-3 py-2">
                      <Avatar username={f.username} />
                      <span className="text-sm flex-1">{f.username ?? "—"}</span>
                      <button onClick={() => void accept(f)} aria-label="Accept" className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90"><Check size={13} /></button>
                      <button onClick={() => void removeFriendship(f, "Request declined")} aria-label="Decline" className="h-8 w-8 rounded-full border border-border flex items-center justify-center active:scale-90"><X size={13} /></button>
                    </div>
                  ))}
                </section>
              )}

              {outgoing.length > 0 && (
                <section>
                  <h2 className="font-serif text-2xl italic mb-2">Sent</h2>
                  {outgoing.map((f) => (
                    <div key={f.friendship_id} className="flex items-center gap-3 py-2">
                      <Avatar username={f.username} />
                      <span className="text-sm flex-1">{f.username ?? "—"}</span>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Pending</span>
                      <button
                        onClick={() => void removeFriendship(f, "Request cancelled")}
                        className="h-8 px-3 rounded-full border border-border text-[10px] uppercase tracking-[0.2em] active:scale-95"
                      >Cancel</button>
                    </div>
                  ))}
                </section>
              )}

              <section>
                <h2 className="font-serif text-2xl italic mb-2">My friends</h2>
                {accepted.length === 0 ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    No friends yet. Search a username above to send your first request.
                  </p>
                ) : accepted.map((f) => (
                  <div key={f.friendship_id} className="flex items-center gap-3 py-2">
                    <Avatar url={f.profile_image ? friendAvatars[f.profile_image] : null} username={f.username} />
                    <span className="text-sm flex-1">{f.username ?? "—"}</span>
                    <button
                      onClick={() => void removeFriendship(f, "Friend removed")}
                      className="h-8 px-3 rounded-full border border-border text-[10px] uppercase tracking-[0.2em] active:scale-95"
                    >Remove</button>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      ) : loadingFeed ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin" /></div>
      ) : feed.length === 0 ? (
        <section className="mx-6 mt-6 rounded-3xl bg-card border border-border/60 p-8 text-center shadow-soft animate-fade-up">
          <div className="mx-auto h-14 w-14 rounded-full bg-secondary/60 flex items-center justify-center mb-4">
            <Heart size={20} />
          </div>
          <h2 className="font-serif text-2xl italic">Nothing shared yet</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Your feed shows the looks friends choose to share with you. Add people to get started.
          </p>
          <button
            onClick={() => setTab("friends")}
            className="mt-6 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98]"
          >Find friends</button>
        </section>
      ) : (
        <section className="mt-6 space-y-8">
          {feed.map((row) => (
            <FeedCard
              key={row.share_id}
              row={row}
              meId={user.id}
              avatar={row.other_profile_image ? feedAvatars[row.other_profile_image] : null}
              image={row.canvas_image_url ? feedImages[row.canvas_image_url] : null}
              onChanged={() => void loadFeed()}
            />
          ))}
        </section>
      )}

      {profileReady && !username && <UsernameSheet onSaved={(u) => setUsername(u)} />}
    </div>
  );
}
