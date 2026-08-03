import { ArrowLeft, ArrowUp, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { BuilderInit, Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { stylistChat } from "@/lib/stylist-chat.functions";
import { submitOutfitFeedback } from "@/lib/outfit-feedback.functions";
import { loadDressRules } from "@/lib/dress-preferences";

type ActionType = "save_canvas" | "add_calendar" | "dismiss";
type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  itemIds?: string[];
  choices?: string[];
  actions?: { type: ActionType; label: string }[];
};
type FeedbackType = "liked" | "disliked" | "saved";

const FEEDBACK_LABELS: Record<FeedbackType, string> = {
  liked: "❤️ Mi piace questo outfit",
  disliked: "👎 Non fa per me, proponimi un'alternativa",
  saved: "💾 Salva questo outfit",
};

export function StylistChat({ go, openBuilder }: { go: (s: Screen) => void; openBuilder: (init: BuilderInit) => void }) {
  const { user } = useAuth();
  const { latitude, longitude } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, FeedbackType>>({});
  const [choicePicked, setChoicePicked] = useState<Record<number, string>>({});
  const [actionTaken, setActionTaken] = useState<Record<number, ActionType>>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("wardrobe_items")
      .select("*").eq("user_id", user.id).order("created_at", { ascending: false })
      .then(async ({ data }) => {
        const list = (data ?? []) as WardrobeItem[];
        setItems(list);
        setSigned(await resolveWardrobeUrls(list));
      });
  }, [user]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const sendMessage = async (text: string, feedbackContext?: FeedbackType) => {
    if (!text || busy) return;
    const history: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    setBusy(true);
    try {
      const desc = weather ? describeWeather(weather.current.weatherCode, weather.current.isDay).label : null;
      const dressRules = await loadDressRules(user?.id);
      const res = await stylistChat({
        data: {
          messages: history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
          dressRules,
          temperature: weather?.current.temperature ?? null,
          condition: desc,
          feedbackContext: feedbackContext ?? null,
          items: items.map((it) => ({
            id: it.id,
            category: it.category,
            subcategory: it.subcategory,
            colors: it.colors ?? (it.color ? [it.color] : []),
            style: it.style ? (Array.isArray(it.style) ? it.style : [it.style]) : [],
            season: it.season,
            brand: it.brand,
            material: Array.isArray(it.material) ? it.material : [],
            size: it.size,
          })),
        },
      });
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${res.error || "Unknown error"}` }]);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: res.reply, itemIds: res.item_ids, choices: res.choices, actions: res.actions }]);
    } catch (e) {
      console.error("[AURA stylist-chat]", e);
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : "Request failed"}` }]);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    setInput("");
    void sendMessage(text);
  };

  const thumb = (id: string) => {
    const it = items.find((x) => x.id === id);
    if (!it) return null;
    const path = toStoragePath(it.image_url);
    const src = path ? signed[path] : null;
    return (
      <div key={id} className="w-16 shrink-0">
        <div className="aspect-square rounded-xl overflow-hidden border border-border/60" style={{ background: "#FFFFFF" }}>
          {src ? <img src={src} alt="" className="h-full w-full object-contain p-1" /> : null}
        </div>
        <p className="mt-1 text-[8px] uppercase tracking-wide text-muted-foreground truncate text-center">
          {it.brand ?? it.category}
        </p>
      </div>
    );
  };

  const giveFeedback = (index: number, itemIds: string[], feedbackType: FeedbackType) => {
    if (feedbackGiven[index] || busy) return;
    setFeedbackGiven((f) => ({ ...f, [index]: feedbackType }));
    void submitOutfitFeedback({ data: { itemIds, feedbackType } }).catch((e) =>
      console.error("[AURA outfit-feedback]", e)
    );
    void sendMessage(FEEDBACK_LABELS[feedbackType], feedbackType);
  };

  const pickChoice = (index: number, choice: string) => {
    if (choicePicked[index] || busy) return;
    setChoicePicked((c) => ({ ...c, [index]: choice }));
    void sendMessage(choice);
  };

  /** Azioni reali: portano davvero alla tela o salvano davvero nel planner — non solo testo in chat. */
  const takeAction = async (index: number, itemIds: string[], action: { type: ActionType; label: string }) => {
    if (actionTaken[index] || !itemIds.length) return;
    setActionTaken((a) => ({ ...a, [index]: action.type }));

    if (action.type === "save_canvas") {
      openBuilder({ itemIds }); // porta sulla tela vera: l'immagine si genera lì, non si può finguere da chat
      return;
    }
    if (action.type === "add_calendar") {
      if (!user) return;
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from("outfit_plans").insert({
        user_id: user.id,
        date: today,
        item_ids: itemIds,
      });
      if (error) {
        console.error("[AURA add_calendar]", error);
        toast.error("Non sono riuscita ad aggiungerlo al calendario");
        return;
      }
      toast.success("Aggiunto al calendario di oggi");
    }
    // "dismiss": non fa nulla, i chip semplicemente spariscono
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 pt-14 pb-3 flex items-center gap-3 shrink-0">
        <button onClick={() => go("ai")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Atelier</p>
          <p className="font-serif text-lg italic leading-tight">Ask your stylist</p>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 pb-3 space-y-3">
        {messages.length === 0 && (
          <div className="mt-10 text-center animate-fade-up">
            <Sparkles size={20} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-serif text-xl italic">What are you dressing for?</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Ask anything — “work dinner tonight, what should I wear?” — and I’ll style you
              with pieces you already own.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === "user" ? "bg-foreground text-background" : "bg-secondary/60"
            }`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.itemIds && m.itemIds.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
                  {m.itemIds.map(thumb)}
                </div>
              )}
              {m.choices && m.choices.length > 0 && !choicePicked[i] && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.choices.map((c) => (
                    <button
                      key={c}
                      onClick={() => pickChoice(i, c)}
                      className="text-xs px-3 py-1.5 rounded-full border border-border bg-background active:scale-95"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              {m.actions && m.actions.length > 0 && !actionTaken[i] && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.actions.map((a) => (
                    <button
                      key={a.type}
                      onClick={() => void takeAction(i, m.itemIds ?? [], a)}
                      className="text-xs px-3 py-1.5 rounded-full bg-foreground text-background active:scale-95"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              {m.itemIds && m.itemIds.length > 0 && !feedbackGiven[i] && (
                <div className="mt-2 flex gap-3">
                  <button
                    onClick={() => giveFeedback(i, m.itemIds!, "liked")}
                    className="text-xl active:scale-90"
                    aria-label="Mi piace"
                  >❤️</button>
                  <button
                    onClick={() => giveFeedback(i, m.itemIds!, "disliked")}
                    className="text-xl active:scale-90"
                    aria-label="Non fa per me"
                  >👎</button>
                  <button
                    onClick={() => giveFeedback(i, m.itemIds!, "saved")}
                    className="text-xl active:scale-90"
                    aria-label="Salva"
                  >💾</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 bg-secondary/60">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shrink-0 bg-background border-t border-border/60">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your stylist…"
            rows={1}
            className="flex-1 max-h-28 bg-secondary/60 rounded-2xl px-4 py-3 text-sm outline-none placeholder:text-muted-foreground resize-none"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="h-11 w-11 shrink-0 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90 disabled:opacity-40"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
