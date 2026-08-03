import { ArrowLeft, ArrowUp, Loader2, Sparkles, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
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
import { saveOutfitPlan } from "@/lib/outfit-plan.functions";
import { transcribeVoice } from "@/lib/voice-transcribe.functions";
import { synthesizeVoice } from "@/lib/voice-synthesize.functions";
import { loadDressRules } from "@/lib/dress-preferences";

type ActionType = "save_canvas" | "add_calendar" | "dismiss";
type FeedbackType = "liked" | "disliked" | "saved";

type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  itemIds?: string[];
  choices?: string[];
  actions?: { type: ActionType; label: string }[];
  uiOnly?: boolean; // messaggio generato localmente: mai inviato all'AI come contesto
};

type MsgUiState = {
  feedback?: FeedbackType;
  choice?: string;
  actionsDone?: ActionType[];
  calendarStep?: "choose" | "pick_date";
  pickedDate?: string;
};

const FEEDBACK_LABELS: Record<FeedbackType, string> = {
  liked: "❤️ Mi piace questo outfit",
  disliked: "👎 Non fa per me, proponimi un'alternativa",
  saved: "💾 Salva questo outfit",
};

const SAVE_ACTIONS: { type: ActionType; label: string }[] = [
  { type: "save_canvas", label: "Salva sulla tela" },
  { type: "add_calendar", label: "Aggiungi al calendario" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

export function StylistChat({ go, openBuilder }: { go: (s: Screen) => void; openBuilder: (init: BuilderInit) => void }) {
  const { user } = useAuth();
  const { latitude, longitude } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
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

  const sendMessage = async (text: string, feedbackContext?: FeedbackType, overrideItemIds?: string[]) => {
    if (!text || busy) return;
    const history: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    setBusy(true);
    try {
      const desc = weather ? describeWeather(weather.current.weatherCode, weather.current.isDay).label : null;
      const dressRules = await loadDressRules(user?.id);
      const res = await stylistChat({
        data: {
          // uiOnly esclusi: non devono mai rientrare come contesto per l'AI,
          // altrimenti il modello impara e ripete frasi nostre come se fossero sue.
          messages: history.filter((m) => !m.uiOnly).slice(-12).map((m) => ({ role: m.role, content: m.content })),
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
      console.error("[AURA voice-transcribe]", e);
      toast.error(e instanceof Error ? `Trascrizione non riuscita: ${e.message}` : "Trascrizione non riuscita");
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    setInput("");
    void sendMessage(text);
  };

  /** Riproduce la risposta come audio. Non blocca la chat se fallisce. */
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

  /** Tap sul microfono: avvia la registrazione con MediaRecorder. */
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
      toast.error("Non riesco ad accedere al microfono");
    }
  };

  /** Tap di nuovo sul microfono: ferma la registrazione, il resto parte da onstop. */
  const stopRecording = () => {
    if (!recording) return;
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  /** Audio registrato -> Whisper -> testo -> invio come messaggio normale. */
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
        toast.message("Non ho sentito bene, riprova");
        return;
      }
      speakNextReplyRef.current = true; // questo turno è vocale: rispondi anche a voce
      void sendMessage(res.text);
    } catch (e) {
      console.error("[AURA voice-transcribe]", e);
      toast.error("Trascrizione non riuscita");
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
          content: "Vuoi salvarlo sulla tela o aggiungerlo al calendario?",
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
      toast.error("Non sono riuscita ad aggiungerlo al calendario");
      return;
    }
    toast.success(
      date === todayIso()
        ? "Aggiunto al calendario di oggi"
        : `Aggiunto al calendario per il ${new Date(date).toLocaleDateString("it-IT")}`
    );
    markActionDone(index, "add_calendar");
    patchUi(index, { calendarStep: undefined });
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
                      Oggi
                    </button>
                    <button
                      onClick={() => patchUi(i, { calendarStep: "pick_date" })}
                      className="text-xs px-3 py-1.5 rounded-full border border-border bg-background active:scale-95"
                    >
                      Altro giorno
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
                      Conferma
                    </button>
                  </div>
                )}

                {!isActionMessage && m.itemIds && m.itemIds.length > 0 && !ui.feedback && (
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
            placeholder={recording ? "Ti ascolto…" : transcribing ? "Trascrivo…" : "Ask your stylist…"}
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
            🔊 AURA sta parlando…
          </p>
        )}
      </div>
    </div>
  );
}
