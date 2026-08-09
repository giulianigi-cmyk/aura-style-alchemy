import { ChevronLeft, ChevronRight, X, Plus, Loader2, Sparkles, Cloud, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import type { Screen, StylistChatInit } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather, classifyTemp, suggestOutfit, type DailyForecast } from "@/lib/weather";
import type { WardrobeItem } from "@/lib/aura-types";
import type { Tables } from "@/integrations/supabase/types";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { logWardrobeEvent, confirmOutfitPlanWorn } from "@/lib/wardrobe-events";

type OutfitPlan = Tables<"outfit_plans"> & { status?: string | null };
type ImportedEvent = { id: string; title: string | null; start_time: string; end_time: string | null; location: string | null; all_day: boolean };

const OCCASIONS = ["Work", "Evening", "Weekend", "Formal", "Travel", "Sport", "Everyday"];

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7;
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function weekGrid(anchor: Date): Date[] {
  const dow = (anchor.getDay() + 6) % 7;
  const start = addDays(startOfDay(anchor), -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function itemMatchesKeywords(it: WardrobeItem, keywords: string[], materials: string[] = []): boolean {
  const hay = `${it.category ?? ""} ${it.brand ?? ""} ${it.color ?? ""} ${it.style ?? ""} ${it.occasion ?? ""} ${it.season ?? ""}`.toLowerCase();
  const categoryMatch = keywords.some((k) => hay.includes(k));
  if (categoryMatch) return true;
  if (!materials.length) return false;
  const itemMaterials = (it.material ?? []).map((m) => m.toLowerCase());
  return materials.some((m) => itemMaterials.includes(m.toLowerCase()));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

export function Planner({ go, openStylistChat }: { go: (s: Screen) => void; openStylistChat: (init: NonNullable<StylistChatInit>) => void }) {
  const { user } = useAuth();
  const { city, latitude, longitude, status, detect, setManual } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);

  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [plans, setPlans] = useState<OutfitPlan[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<ImportedEvent[]>([]);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [manualCity, setManualCity] = useState("");

  const reload = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const [{ data: it }, { data: pl }, { data: ev }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", user.id),
      supabase.from("outfit_plans").select("*").eq("user_id", user.id).order("date"),
      (supabase.from("calendar_events_cache" as never) as any)
        .select("id, title, start_time, end_time, location, all_day")
        .eq("user_id", user.id)
        .order("start_time"),
    ]);
    const list = (it ?? []) as WardrobeItem[];
    setItems(list);
    setPlans((pl ?? []) as OutfitPlan[]);
    setCalendarEvents((ev ?? []) as ImportedEvent[]);
    setSigned(await resolveWardrobeUrls(list));
    setLoading(false);
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);

  const eventsByDate = useMemo(() => {
    const m: Record<string, ImportedEvent[]> = {};
    calendarEvents.forEach((e) => {
      const iso = toISO(new Date(e.start_time));
      (m[iso] ??= []).push(e);
    });
    return m;
  }, [calendarEvents]);

  const plansByDate = useMemo(() => {
    const m: Record<string, OutfitPlan[]> = {};
    plans.forEach((p) => { if (p.status !== "cancelled") (m[p.date] ??= []).push(p); });
    return m;
  }, [plans]);

  const itemsById = useMemo(() => {
    const m: Record<string, WardrobeItem> = {};
    items.forEach((it) => { m[it.id] = it; });
    return m;
  }, [items]);

  const dailyByDate = useMemo(() => {
    const m: Record<string, DailyForecast> = {};
    weather?.daily.forEach((d) => { m[d.date] = d; });
    return m;
  }, [weather]);

  const cells = view === "month" ? monthGrid(anchor) : weekGrid(anchor);
  const today = toISO(new Date());
  const monthLabel = view === "month"
    ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    : `Week of ${cells[0].getDate()} ${MONTHS[cells[0].getMonth()].slice(0, 3)}`;

  const shift = (n: number) => {
    if (view === "month") {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + n, 1));
    } else {
      setAnchor(addDays(anchor, n * 7));
    }
  };

  const firstImageFor = (plan: OutfitPlan): string | null => {
    for (const id of plan.item_ids) {
      const it = itemsById[id];
      if (!it) continue;
      const path = toStoragePath(it.image_url);
      if (path && signed[path]) return signed[path];
    }
    return null;
  };

  const selectedPlans = selectedDate ? plansByDate[selectedDate] ?? [] : [];

  if (!user) return null;

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Calendar</p>
        <div className="flex items-center justify-between mt-1">
          <h1 className="font-serif text-4xl">{monthLabel}</h1>
          <div className="flex gap-1">
            <button onClick={() => shift(-1)} aria-label="Previous period" className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90"><ChevronLeft size={16} /></button>
            <button onClick={() => shift(1)} aria-label="Next period" className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-full bg-secondary/60 p-1">
            {(["month", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-full text-[10px] uppercase tracking-[0.25em] transition ${
                  view === v ? "bg-foreground text-background" : "text-foreground/70"
                }`}
              >{v}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => go("builder")}
              className="h-9 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-95 inline-flex items-center gap-1"
            ><Sparkles size={11} /> Create outfit</button>
            <button
              onClick={() => setAnchor(startOfDay(new Date()))}
              className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground"
            >Today</button>
          </div>
        </div>
      </header>

      {latitude == null && (
        <div className="mx-6 mt-3 rounded-2xl border border-border/60 bg-card p-4">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Weather</p>
          <p className="font-serif text-lg mt-1">Enable location for daily forecast</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={detect}
              className="h-9 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-95 flex items-center gap-1.5"
            >
              {status === "loading" ? <Loader2 size={11} className="animate-spin" /> : <Cloud size={11} />}
              Use location
            </button>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (manualCity.trim()) { void setManual(manualCity); setManualCity(""); } }}
            className="mt-2 flex gap-2"
          >
            <input
              value={manualCity}
              onChange={(e) => setManualCity(e.target.value)}
              placeholder="Or type your city"
              className="flex-1 bg-background border border-border rounded-full px-4 py-2 text-sm outline-none focus:border-foreground"
            />
            <button className="h-9 px-4 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">Save</button>
          </form>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Calendar works without weather too — you can plan outfits either way.
          </p>
        </div>
      )}
      {city && latitude != null && (
        <p className="mx-6 mt-3 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          {city} · forecast next 7 days
        </p>
      )}

      <div className="mx-4 mt-4 grid grid-cols-7 gap-1 text-center">
        {DOW.map((d, i) => (
          <span key={i} className="text-[9px] uppercase tracking-widest text-muted-foreground">{d}</span>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center mt-16 text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="mx-4 mt-2 grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const iso = toISO(d);
            const inMonth = view === "week" || d.getMonth() === anchor.getMonth();
            const isToday = iso === today;
            const dayPlans = plansByDate[iso] ?? [];
            const daily = dailyByDate[iso];
            const wIcon = daily ? describeWeather(daily.weatherCode).icon : null;
            const thumb = dayPlans[0] ? firstImageFor(dayPlans[0]) : null;

            return (
              <button
                key={iso}
                onClick={() => setSelectedDate(iso)}
                className={`relative aspect-[3/4] rounded-xl p-1 flex flex-col items-stretch text-left transition active:scale-95 ${
                  isToday ? "bg-foreground text-background"
                    : inMonth ? "bg-secondary/40" : "bg-transparent opacity-40"
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className={`font-serif text-sm leading-none pt-0.5 pl-1`}>{d.getDate()}</span>
                  <div className="flex items-center gap-1">
                    {(eventsByDate[iso]?.length ?? 0) > 0 && (
                      <span className={`h-1.5 w-1.5 rounded-full ${isToday ? "bg-background" : "bg-[var(--champagne)]"}`} title={`${eventsByDate[iso].length} calendar event${eventsByDate[iso].length === 1 ? "" : "s"}`} />
                    )}
                    {wIcon && <span className="text-[10px] leading-none">{wIcon}</span>}
                  </div>
                </div>
                {daily && (
                  <span className={`text-[8px] uppercase tracking-wider pl-1 ${isToday ? "opacity-80" : "text-muted-foreground"}`}>
                    {Math.round(daily.tempMax)}°
                  </span>
                )}
                {thumb ? (
                  <div className="mt-auto relative rounded-md overflow-hidden aspect-square" style={{ background: "#FFFFFF" }}>
                    <img src={thumb} alt="" className="h-full w-full object-contain p-0.5" loading="lazy" />
                    {dayPlans.length > 1 && (
                      <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-foreground text-background text-[7px] flex items-center justify-center">{dayPlans.length}</span>
                    )}
                  </div>
                ) : dayPlans.length > 0 ? (
                  <span className={`mt-auto mx-auto h-1 w-1 rounded-full ${isToday ? "bg-background" : "bg-foreground"}`} />
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {selectedDate && (
        <DayDetail
          date={selectedDate}
          plans={selectedPlans}
          calendarEvents={eventsByDate[selectedDate] ?? []}
          openStylistChat={openStylistChat}
          items={items}
          signed={signed}
          weather={dailyByDate[selectedDate] ?? null}
          currentTempC={weather?.current.temperature ?? null}
          onClose={() => setSelectedDate(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

// ============================================================================
// Day detail sheet: plan / log / view
// ============================================================================

type Slot = { type: "general" } | { type: "event"; event: ImportedEvent };
const slotKey = (s: Slot) => (s.type === "general" ? "general" : `event:${s.event.id}`);

function DayDetail({
  date, plans, calendarEvents, openStylistChat, items, signed, weather, currentTempC, onClose, onSaved,
}: {
  date: string;
  plans: OutfitPlan[];
  calendarEvents: ImportedEvent[];
  openStylistChat: (init: NonNullable<StylistChatInit>) => void;
  items: WardrobeItem[];
  signed: Record<string, string>;
  weather: DailyForecast | null;
  currentTempC: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const isPast = date < toISO(new Date());

  const eventIdOf = (p: OutfitPlan) => (p as unknown as { calendar_event_id?: string | null }).calendar_event_id ?? null;
  const generalPlan = plans.find((p) => !eventIdOf(p)) ?? null;
  const planForEvent = (eventId: string) => plans.find((p) => eventIdOf(p) === eventId) ?? null;

  // A plain day with nothing going on skips straight to the old
  // single-outfit flow — no reason to show a list of one empty slot.
  // A day with any events or more than one outfit shows the list first,
  // so a work outfit and an evening-event outfit never collide.
  const hasMultipleSlots = calendarEvents.length > 0 || plans.length > 0;
  const [activeSlot, setActiveSlot] = useState<Slot | null>(hasMultipleSlots ? null : { type: "general" });

  const plan = !activeSlot ? null : activeSlot.type === "general" ? generalPlan : planForEvent(activeSlot.event.id);
  const activeEventId = activeSlot?.type === "event" ? activeSlot.event.id : null;

  const [editing, setEditing] = useState(!plan);
  const [selected, setSelected] = useState<string[]>(plan?.item_ids ?? []);
  const [occasion, setOccasion] = useState(plan?.occasion ?? "");
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [filterSuggested, setFilterSuggested] = useState(false);

  // Re-sync the form whenever the person switches which slot they're
  // looking at — this component stays mounted across that switch.
  useEffect(() => {
    setEditing(!plan);
    setSelected(plan?.item_ids ?? []);
    setOccasion(plan?.occasion ?? "");
    setNotes(plan?.notes ?? "");
    setFilterSuggested(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlot ? slotKey(activeSlot) : null, plan?.id]);

 const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const suggestTempC = weather ? (weather.tempMin + weather.tempMax) / 2 : currentTempC;
  const band = suggestTempC != null ? classifyTemp(suggestTempC) : null;
  const suggestion = band ? suggestOutfit({
    temperature: suggestTempC ?? 15,
    apparentTemperature: suggestTempC ?? 15,
    weatherCode: weather?.weatherCode ?? 0,
    windSpeed: 0,
    precipitationProbability: weather?.precipitationProbability ?? 0,
    isDay: true,
  }) : null;

  const suggestedKeywords = suggestion?.categories ?? [];
  const suggestedMaterials = suggestion?.materials ?? [];
  const suggestedItems = useMemo(
    () => (suggestedKeywords.length ? items.filter((it) => itemMatchesKeywords(it, suggestedKeywords, suggestedMaterials)) : []),
    [items, suggestedKeywords, suggestedMaterials],
  );
  const visibleItems = filterSuggested && suggestedItems.length ? suggestedItems : items;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async ({ log }: { log: boolean }) => {
    if (!user) return;
    if (!selected.length) { toast.error("Pick at least one piece"); return; }
    setSaving(true);

    const wasAlreadyWorn = plan?.status === "worn";
    const confirmingWear = log && !wasAlreadyWorn;
    const status = confirmingWear ? "worn" : (plan?.status ?? "planned");

    const payload = {
      user_id: user.id,
      date,
      item_ids: selected,
      occasion: occasion || null,
      notes: notes || null,
      weather_temp: weather?.tempMax ?? currentTempC ?? null,
      weather_condition: weather ? describeWeather(weather.weatherCode).label : null,
      status,
      calendar_event_id: activeEventId,
    };

    let planId = plan?.id ?? null;
    if (plan) {
      const { error } = await supabase.from("outfit_plans").update(payload as never).eq("id", plan.id);
      if (error) { setSaving(false); toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("outfit_plans").insert(payload as never).select("id").single();
      if (error) { setSaving(false); toast.error(error.message); return; }
      planId = (data as { id: string }).id;
    }

    const eventType = !plan ? (log ? "worn" : "planned") : (confirmingWear ? "worn" : "edited");
    const { error: eventErr } = await logWardrobeEvent({
      userId: user.id,
      eventType,
      date,
      itemIds: selected,
      outfitPlanId: planId,
      occasion: occasion || null,
      notes: notes || null,
      weatherCondition: weather ? describeWeather(weather.weatherCode).label : null,
      temperature: weather?.tempMax ?? currentTempC ?? null,
    });
    if (eventErr) console.error("[AURA wardrobe-events] log failed", eventErr);

    setSaving(false);
    toast.success(plan ? "Outfit updated" : log ? "Outfit logged" : "Outfit planned");
    onSaved();
    if (hasMultipleSlots) setActiveSlot(null); else onClose();
  };

  const confirmWorn = async () => {
    if (!plan || !user) return;
    setSaving(true);
    const { error } = await confirmOutfitPlanWorn(
      { id: plan.id, date: plan.date, item_ids: plan.item_ids, occasion: plan.occasion, notes: plan.notes },
      user.id,
    );
    setSaving(false);
    if (error) { toast.error(error); return; }
    toast.success("Marked as worn");
    onSaved();
  };

  const remove = async () => {
    if (!plan || !user) return;
    setSaving(true);
    const { error } = await supabase.from("outfit_plans").update({ status: "cancelled" } as never).eq("id", plan.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    const { error: eventErr } = await logWardrobeEvent({
      userId: user.id,
      eventType: "cancelled",
      date: plan.date,
      itemIds: plan.item_ids,
      outfitPlanId: plan.id,
    });
    if (eventErr) console.error("[AURA wardrobe-events] log failed", eventErr);
    toast.success("Removed");
    onSaved();
    if (hasMultipleSlots) setActiveSlot(null); else onClose();
  };

  const askStylistFor = (event: ImportedEvent | null) => {
    const isItalian = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("it");
    const eventDateLabel = new Date(date + "T00:00:00").toLocaleDateString(isItalian ? "it-IT" : "en-US", {
      weekday: "long", month: "long", day: "numeric",
    });
    const promptMessage = event
      ? (isItalian
          ? `Ho "${event.title || "un evento"}" ${eventDateLabel}${event.location ? ` a ${event.location}` : ""} — cosa mi consigli di indossare?`
          : `I have "${event.title || "an event"}" on ${eventDateLabel}${event.location ? ` at ${event.location}` : ""} — what should I wear?`)
      : (isItalian
          ? `Cosa mi consigli di indossare ${eventDateLabel}?`
          : `What should I wear on ${eventDateLabel}?`);
    openStylistChat({
      message: promptMessage,
      temperature: weather ? (weather.tempMin + weather.tempMax) / 2 : null,
      condition: weather ? describeWeather(weather.weatherCode).label : null,
      date,
    });
  };

  const forecastCard = weather && (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Forecast</p>
          <p className="font-serif text-2xl mt-1">
            {Math.round(weather.tempMax)}° / {Math.round(weather.tempMin)}°
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {describeWeather(weather.weatherCode).label} · rain {weather.precipitationProbability}%
          </p>
        </div>
        <span className="text-4xl">{describeWeather(weather.weatherCode).icon}</span>
      </div>
      {suggestion && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Suggested</p>
          <p className="font-serif italic text-base mt-1">{suggestion.headline}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestion.tips.map((t) => (
              <span key={t} className="rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest bg-secondary/60">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const SlotRow = ({ label, sublabel, slotPlan, onOpen, onAsk }: {
    label: string; sublabel: string | null; slotPlan: OutfitPlan | null; onOpen: () => void; onAsk: () => void;
  }) => (
    <div className="rounded-2xl bg-secondary/40 p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{label}</p>
          {sublabel && <p className="text-[11px] text-muted-foreground">{sublabel}</p>}
        </div>
        {slotPlan && (
          <span className={`shrink-0 text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full ${slotPlan.status === "worn" ? "bg-foreground text-background" : "bg-background text-muted-foreground"}`}>
            {slotPlan.status === "worn" ? "Worn" : "Planned"}
          </span>
        )}
      </div>
      {slotPlan ? (
        <button onClick={onOpen} className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar w-full">
          {slotPlan.item_ids.map((id) => {
            const it = items.find((i) => i.id === id);
            const path = it ? toStoragePath(it.image_url) : null;
            const src = path ? signed[path] : "";
            return (
              <div key={id} className="h-14 w-14 shrink-0 rounded-lg overflow-hidden border border-border/60" style={{ background: "#FFFFFF" }}>
                {src ? <img src={src} className="h-full w-full object-contain p-1" alt="" loading="lazy" /> : null}
              </div>
            );
          })}
        </button>
      ) : (
        <div className="mt-2 flex gap-2">
          <button onClick={onOpen} className="flex-1 h-9 rounded-full border border-border text-[10px] uppercase tracking-[0.2em]">Choose pieces</button>
          <button onClick={onAsk} className="flex-1 h-9 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1"><Sparkles size={11} /> Ask stylist</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-[92vh] bg-background rounded-t-3xl flex flex-col animate-fade-up"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            {activeSlot && hasMultipleSlots && (
              <button onClick={() => setActiveSlot(null)} className="h-9 w-9 rounded-full border border-border flex items-center justify-center shrink-0"><ChevronLeft size={16} /></button>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {!activeSlot ? "Outfits" : isPast ? "Log outfit" : "Plan outfit"}
                {activeSlot?.type === "event" ? ` · ${activeSlot.event.title || "Event"}` : activeSlot?.type === "general" ? " · General" : ""}
              </p>
              <p className="font-serif text-xl">{dateLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-full border border-border flex items-center justify-center shrink-0"><X size={16} /></button>
        </div>

        {!activeSlot ? (
          <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-3">
            {forecastCard}
            <SlotRow
              label="General"
              sublabel="No specific event"
              slotPlan={generalPlan}
              onOpen={() => setActiveSlot({ type: "general" })}
              onAsk={() => askStylistFor(null)}
            />
            {calendarEvents.map((e) => (
              <SlotRow
                key={e.id}
                label={e.title || "Untitled event"}
                sublabel={[
                  !e.all_day ? new Date(e.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null,
                  e.location,
                ].filter(Boolean).join(" · ") || null}
                slotPlan={planForEvent(e.id)}
                onOpen={() => setActiveSlot({ type: "event", event: e })}
                onAsk={() => askStylistFor(e)}
              />
            ))}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-5">
              {forecastCard}

              {plan && !editing ? (
                <>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Look</p>
                      <span className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        plan.status === "worn" ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground"
                      }`}>
                        {plan.status === "worn" ? "Worn" : "Planned"}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {plan.item_ids.map((id) => {
                        const it = items.find((i) => i.id === id);
                        const path = it ? toStoragePath(it.image_url) : null;
                        const src = path ? signed[path] : "";
                        return (
                          <div key={id} className="aspect-square rounded-xl overflow-hidden" style={{ background: "#FFFFFF" }}>
                            {src ? <img src={src} className="h-full w-full object-contain p-1.5" alt="" loading="lazy" /> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {(plan.occasion || plan.notes) && (
                    <div className="rounded-2xl bg-secondary/40 p-4 space-y-2">
                      {plan.occasion && <p className="text-xs"><span className="uppercase tracking-widest text-muted-foreground text-[10px]">Occasion · </span>{plan.occasion}</p>}
                      {plan.notes && <p className="text-xs">{plan.notes}</p>}
                    </div>
                  )}
                  {plan.weather_condition && (
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                      Worn in {plan.weather_condition}{plan.weather_temp != null ? ` · ${Math.round(Number(plan.weather_temp))}°` : ""}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                        Choose pieces · {selected.length} selected
                      </p>
                      {suggestedItems.length > 0 && (
                        <button
                          onClick={() => setFilterSuggested((v) => !v)}
                          className={`text-[10px] uppercase tracking-widest px-3 py-1 rounded-full flex items-center gap-1 ${
                            filterSuggested ? "bg-foreground text-background" : "bg-secondary/60"
                          }`}
                        >
                          <Sparkles size={10} /> Suggested
                        </button>
                      )}
                    </div>
                    {visibleItems.length === 0 ? (
                      <p className="mt-4 text-xs text-muted-foreground">
                        {items.length === 0 ? "Add pieces to your closet first." : "No matches — turn off Suggested to see all."}
                      </p>
                    ) : (
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {visibleItems.map((it) => {
                          const path = toStoragePath(it.image_url);
                          const src = path ? signed[path] : "";
                          const on = selected.includes(it.id);
                          return (
                            <button
                              key={it.id}
                              onClick={() => toggle(it.id)}
                              className={`relative aspect-square rounded-xl overflow-hidden border-2 transition ${on ? "border-foreground" : "border-transparent"}`}
                              style={{ background: "#FFFFFF" }}
                            >
                              {src ? <img src={src} className="h-full w-full object-contain p-1" alt="" loading="lazy" /> : null}
                              {on && <span className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground text-background text-[10px] flex items-center justify-center">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Occasion</p>
                    <div className="flex flex-wrap gap-1.5">
                      {OCCASIONS.map((o) => (
                        <button
                          key={o}
                          onClick={() => setOccasion(occasion === o ? "" : o)}
                          className={`px-3 py-1 rounded-full text-[11px] ${occasion === o ? "bg-foreground text-background" : "bg-secondary/60"}`}
                        >{o}</button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Note</p>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Optional note"
                      className="w-full bg-secondary/40 rounded-2xl px-4 py-3 text-sm outline-none focus:bg-secondary/60 resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-border/60 px-5 py-4 flex gap-2">
              {plan && !editing ? (
                <>
                  <button
                    onClick={remove}
                    disabled={saving}
                    className="h-11 w-11 rounded-full border border-border flex items-center justify-center"
                  ><Trash2 size={15} /></button>
                  {isPast && plan.status !== "worn" && (
                    <button
                      onClick={() => void confirmWorn()}
                      disabled={saving}
                      className="h-11 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2"
                    >
                      {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                      Mark as worn
                    </button>
                  )}
                  <button
                    onClick={() => setEditing(true)}
                    className="flex-1 h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                  >Edit</button>
                </>
              ) : (
                <>
                  {plan && (
                    <button onClick={() => setEditing(false)} className="flex-1 h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">Cancel</button>
                  )}
                  <button
                    onClick={() => void save({ log: isPast })}
                    disabled={saving}
                    className="flex-1 h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    {plan ? "Save" : isPast ? "Log outfit" : "Plan outfit"}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
