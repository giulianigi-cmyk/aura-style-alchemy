import { ArrowLeft, ArrowUp, Loader2, Sparkles, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import type { BuilderInit, Screen, StylistChatInit } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { stylistChat } from "@/lib/stylist-chat.functions";
import { submitOutfitFeedback } from "@/lib/outfit-feedback.functions";
import { saveOutfitPlan } from "@/lib/outfit-plan.functions";
import { transcribeVoice } from "@/lib/voice-transcribe.functions";
import { synthesizeVoice } from "@/lib/voice-synthesize.functions";
import { loadDressRules, loadDressPreferencesRaw } from "@/lib/dress-preferences";

type ActionType = "save_canvas" | "add_calendar" | "dismiss";
type FeedbackType = "liked" | "disliked" | "saved";

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  itemIds?: string[];
  choices?: string[];
  actions?: { type: ActionType; label: string }[];
  uiOnly?: boolean;
};

type MsgUiState = {
  feedback?: FeedbackType;
  choice?: string;
  actionsDone?: ActionType[];
  calendarStep?: "choose" | "pick_date";
  pickedDate?: string;
};

const FEEDBACK_LABELS: Record<FeedbackType, string> = {
  liked: "❤️ I like this outfit",
  disliked: "👎 Not for me, suggest something else",
  saved: "💾 Save this outfit",
};

const SAVE_ACTIONS: { type: ActionType; label: string }[] = [
  { type: "save_canvas", label: "Save to canvas" },
  { type: "add_calendar", label: "Add to calendar" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

function errorMessage(e: unknown, fallback: string): string {
  const detail =
    e instanceof Error ? e.message
    : typeof e === "string" ? e
    : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message)
    : null;
  return detail ? `${fallback}: ${detail}` : fallback;
}

export function StylistChat({ go, openBuilder, initialMessage }: { go: (s: Screen) => void; openBuilder: (init: BuilderInit) => void; initialMessage?: StylistChatInit }) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { latitude, longitude } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uiState, setUiState] = useState<Record<number, MsgUiState>>({});
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speakNextReplyRef = useRef(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const transcribe = useServerFn(transcribeVoice);
  const synthesize = useServerFn(synthesizeVoice);

  const patchUi = (i: number, patch: Partial<MsgUiState>) =>
    setUiState((s) => ({ ...s, [i]: { ...s[i], ...patch } }));

  const markActionDone = (i: number, type: ActionType) =>
    setUiState((s) => ({
      ...s,
      [i]: { ...s[i], actionsDone: [...(s[i]?.actionsDone ?? []), type] },
    }));

  useEffect(() => {
    if (!user) return;
    (supabase.from("wardrobe_items" as never) as any)
      .select("*").eq("user_id", user.id).eq("archived", false).order("created_at", { ascending: false })
      .then(async ({ data }: { data: WardrobeItem[] | null }) => {
        const list = (data ?? []) as WardrobeItem[];
        setItems(list);
        setSigned(await resolveWardrobeUrls(list));
        setItemsLoaded(true);
      });
  }, [user]);

    useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Set once from a calendar event tap — when present, the WHOLE session
  // reasons about that day's forecast instead of "today's" weather. A
  // Friday event browsed on a Tuesday needs Friday's weather, not
  // Tuesday's — see openStylistChat in AuraApp.tsx. A ref (not state) so
  // the very first sendMessage call below sees it immediately, without
  // waiting on a re-render.
  const eventWeatherRef = useRef<{ temperature: number | null; condition: string | null } | null>(null);

  const autoSentRef = useRef(false);
  useEffect(() => {
    // Wait for the wardrobe fetch to actually complete first — this was
    // the real bug: without this guard, the auto-sent message could fire
    // (and reach the AI) before `items` had loaded, sending an EMPTY
    // catalog. The AI wasn't wrong that "nothing fit" — it genuinely saw
    // zero items, because the wardrobe hadn't loaded yet.
    if (initialMessage && itemsLoaded && !autoSentRef.current) {
      autoSentRef.current = true;
      eventWeatherRef.current = { temperature: initialMessage.temperature, condition: initialMessage.condition };
      void sendMessage(initialMessage.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, itemsLoaded]);


  const sendMessage = async (text: string, feedbackContext?: FeedbackType, overrideItemIds?: string[]) => {
    if (!text || busy) return;
    const history: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    setBusy(true);
    try {
      const desc = eventWeatherRef.current?.condition ?? (weather ? describeWeather(weather.current.weatherCode, weather.current.isDay).label : null);
      const temp = eventWeatherRef.current?.temperature ?? weather?.current.temperature ?? null;
      const dressRules = await loadDressRules(user?.id);
      const dressPreferences = await loadDressPreferencesRaw(user?.id);
      const res = await stylistChat({
        data: {
          messages: history.filter((m) => !m.uiOnly).slice(-12).map((m) => ({ role: m.role, content: m.content })),
          dressRules,
          dressPreferences,
          industry: profile?.industry ?? null,
          workDressCode: profile?.work_dress_code ?? null,
                    personalFormality: profile?.personal_formality ?? null,
          styleBoldness: (profile as unknown as { style_boldness?: string })?.style_boldness ?? null,
          profession: profile?.profession ?? null,
          temperature: temp,
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
            length: it.length,
            sleeveLength: it.sleeve_length,
            fit: it.fit,
            heelHeight: it.heel_height,
            toeShape: it.toe_shape,
            closure: it.closure,
            gender: it.gender,
            styleTags: it.style_tags,
          })),
        },
      });
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${res.error || "Unknown error"}` }]);
        return;
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.reply,
          itemIds: overrideItemIds ?? res.item_ids,
          choices: res.choices,
          actions: res.actions,
        },
      ]);
      if (speakNextReplyRef.current) {
        speakNextReplyRef.current = false;
        void speak(res.reply);
      }
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

  const speak = async (text: string) => {
    if (!text.trim()) return;
    setSpeaking(true);
    try {
      const res = await synthesize({ data: { text: text.slice(0, 2000) } });
      const audio = new Audio(res.audioDataUrl);
      audioPlayerRef.current = audio;
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch (e) {
      console.error("[AURA voice-synthesize]", e);
      setSpeaking(false);
    }
  };

  const startRecording = async () => {
    if (recording || transcribing || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ["audio/mp4", "audio/webm", "audio/ogg"];
      const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        void handleRecordedAudio(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (e) {
      console.error("[AURA mic] permission/record failed", e);
      toast.error("Couldn't access the microphone");
    }
  };

  const stopRecording = () => {
    if (!recording) return;
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const handleRecordedAudio = async (blob: Blob) => {
    setTranscribing(true);
    try {
      const audioDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const res = await transcribe({ data: { audioDataUrl } });
      if (!res.text) {
        toast.message("Didn't catch that, try again");
        return;
      }
      speakNextReplyRef.current = true;
      void sendMessage(res.text);
    } catch (e) {
      console.error("[AURA voice-transcribe]", e);
      toast.error(errorMessage(e, "Transcription failed"));
    } finally {
      setTranscribing(false);
    }
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
    if (uiState[index]?.feedback || busy) return;
    patchUi(index, { feedback: feedbackType });
    void submitOutfitFeedback({ data: { itemIds, feedbackType } }).catch((e) =>
      console.error("[AURA outfit-feedback]", e)
    );

    if (feedbackType === "saved") {
      setMessages((m) => [
        ...m,
        { role: "user", content: FEEDBACK_LABELS.saved, uiOnly: true },
        {
          role: "assistant",
          content: "Want to save it to your canvas, or add it to your calendar?",
          itemIds,
          actions: SAVE_ACTIONS,
          uiOnly: true,
        },
      ]);
      return;
    }

    if (feedbackType === "liked") {
      void sendMessage(FEEDBACK_LABELS.liked, "liked", itemIds);
      return;
    }

    void sendMessage(FEEDBACK_LABELS.disliked, "disliked");
  };

  const pickChoice = (index: number, choice: string) => {
    if (uiState[index]?.choice || busy) return;
    patchUi(index, { choice });
    void sendMessage(choice);
  };

  const takeAction = (index: number, action: { type: ActionType; label: string }, itemIds: string[]) => {
    if (uiState[index]?.actionsDone?.includes(action.type) || !itemIds.length) return;

    if (action.type === "save_canvas") {
      markActionDone(index, "save_canvas");
      openBuilder({ itemIds });
      return;
    }
    if (action.type === "add_calendar") {
      patchUi(index, { calendarStep: "choose" });
      return;
    }
    markActionDone(index, action.type);
  };

  const confirmCalendarDate = async (index: number, itemIds: string[], date: string) => {
    try {
      await saveOutfitPlan({ data: { itemIds, date } });
    } catch (e) {
      console.error("[AURA add_calendar]", e);
      toast.error("Couldn't add it to your calendar");
      return;
    }
    toast.success(
      date === todayIso()
        ? "Added to today's calendar"
        : `Added to your calendar for ${new Date(date).toLocaleDateString("en-US")}`
    );
    markActionDone(index, "add_calendar");
    patchUi(index, { calendarStep: undefined });
  };

    return (
    <div className="h-full flex flex-col">
      {/* TEMPORARY DIAGNOSTIC — remove once the calendar-event auto-send bug is found. */}
      <div className="px-4 py-2 bg-yellow-100 text-[10px] text-black break-all shrink-0">
        [DEBUG] initialMessage={initialMessage ? "SET" : "null"} | itemsLoaded={String(itemsLoaded)} | autoSent={String(autoSentRef.current)} | messagesCount={messages.length}
        {initialMessage && <div>msg: {initialMessage.message}</div>}
      </div>
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
        {messages.map((m, i) => {
          const isActionMessage = !!(m.actions && m.actions.length > 0);
          const ui = uiState[i] ?? {};
          const remainingActions = (m.actions ?? []).filter((a) => !ui.actionsDone?.includes(a.type));
          return (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user" ? "bg-foreground text-background" : "bg-secondary/60"
              }`}>
                <p className="whitespace-pre-wrap">{m.content}</p>

                {!isActionMessage && m.itemIds && m.itemIds.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
                    {m.itemIds.map(thumb)}
                  </div>
                )}

                {m.choices && m.choices.length > 0 && !ui.choice && (
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

                {remainingActions.length > 0 && !ui.calendarStep && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {remainingActions.map((a) => (
                      <button
                        key={a.type}
                        onClick={() => takeAction(i, a, m.itemIds ?? [])}
                        className="text-xs px-3 py-1.5 rounded-full bg-foreground text-background active:scale-95"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}

                {ui.calendarStep === "choose" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => void confirmCalendarDate(i, m.itemIds ?? [], todayIso())}
                      className="text-xs px-3 py-1.5 rounded-full bg-foreground text-background active:scale-95"
                    >
                      Today
                    </button>
                    <button
                      onClick={() => patchUi(i, { calendarStep: "pick_date" })}
                      className="text-xs px-3 py-1.5 rounded-full border border-border bg-background active:scale-95"
                    >
                      Another day
                    </button>
                  </div>
                )}

                {ui.calendarStep === "pick_date" && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="date"
                      min={todayIso()}
                      value={ui.pickedDate ?? ""}
                      onChange={(e) => patchUi(i, { pickedDate: e.target.value })}
                      className="text-xs rounded-lg border border-border bg-background px-2 py-1.5"
                    />
                    <button
                      disabled={!ui.pickedDate}
                      onClick={() => ui.pickedDate && void confirmCalendarDate(i, m.itemIds ?? [], ui.pickedDate)}
                      className="text-xs px-3 py-1.5 rounded-full bg-foreground text-background active:scale-95 disabled:opacity-40"
                    >
                      Confirm
                    </button>
                  </div>
                )}

                {!isActionMessage && m.itemIds && m.itemIds.length > 0 && !ui.feedback && (
                  <div className="mt-2 flex gap-3">
                    <button
                      onClick={() => giveFeedback(i, m.itemIds!, "liked")}
                      className="text-xl active:scale-90"
                      aria-label="Like"
                    >❤️</button>
                    <button
                      onClick={() => giveFeedback(i, m.itemIds!, "disliked")}
                      className="text-xl active:scale-90"
                      aria-label="Not for me"
                    >👎</button>
                    <button
                      onClick={() => giveFeedback(i, m.itemIds!, "saved")}
                      className="text-xl active:scale-90"
                      aria-label="Save"
                    >💾</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
            placeholder={recording ? "Listening…" : transcribing ? "Transcribing…" : "Ask your stylist…"}
            rows={1}
            className="flex-1 max-h-28 bg-secondary/60 rounded-2xl px-4 py-3 text-sm outline-none placeholder:text-muted-foreground resize-none"
          />
          <button
            onClick={() => (recording ? stopRecording() : void startRecording())}
            disabled={busy || transcribing}
            aria-label={recording ? "Stop recording" : "Record voice message"}
            className={`h-11 w-11 shrink-0 rounded-full flex items-center justify-center active:scale-90 transition disabled:opacity-40 ${
              recording ? "bg-destructive text-destructive-foreground animate-pulse" : "border border-border"
            }`}
          >
            {transcribing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : recording ? (
              <Square size={16} />
            ) : (
              <Mic size={16} />
            )}
          </button>
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="h-11 w-11 shrink-0 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90 disabled:opacity-40"
          >
            <ArrowUp size={16} />
          </button>
        </div>
        {speaking && (
          <p className="mt-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            🔊 AURA is speaking…
          </p>
        )}
      </div>
    </div>
  );
}
