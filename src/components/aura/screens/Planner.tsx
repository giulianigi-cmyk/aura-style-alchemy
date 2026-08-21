import { ChevronLeft, ChevronRight, X, Plus, Loader2, Sparkles, Cloud, Trash2, Luggage } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import { PiecePicker } from "../PiecePicker";
import { logWardrobeEvent, confirmOutfitPlanWorn } from "@/lib/wardrobe-events";
import { resolvePlanSlot, validateEventSlot } from "@/lib/outfit-plan-slot";
import { useServerFn } from "@tanstack/react-start";
import { listOpenWeatherProposals, resolveWeatherProposal } from "@/lib/plan-weather.functions";
import { WeatherProposalCard, type WeatherProposal } from "../WeatherProposalCard";
import i18n from "@/i18n/config";

type OutfitPlan = Tables<"outfit_plans"> & { status?: string | null };
type ImportedEvent = { id: string; title: string | null; start_time: string; end_time: string | null; location: string | null; all_day: boolean };

export const OCCASIONS = ["Work", "Evening", "Weekend", "Formal", "Travel", "Sport", "Everyday"];


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

const DOW = ["M", "T", "W", "T", "F", "S", "S"];
const getLocalizedDow = (t: (k: string) => string) => (t("planner.dowLetters") as string).split(",");

export function Planner({ go, openStylistChat, focus }: {
  go: (s: Screen) => void;
  openStylistChat: (init: NonNullable<StylistChatInit>) => void;
  /** Deep-link target from a weather_change notification. */
  focus?: { date: string; planId?: string | null } | null;
}) {
  const { t } = useTranslation();
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
  const [selectedDate, setSelectedDate] = useState<string | null>(focus?.date ?? null);
  const [manualCity, setManualCity] = useState("");
  const [proposals, setProposals] = useState<WeatherProposal[]>([]);
  const loadProposals = useServerFn(listOpenWeatherProposals);

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

  // Open weather proposals, so the day sheet can show "planned vs
  // suggested" for a plan whose forecast moved.
  const reloadProposals = useCallback(async () => {
    if (!user) return;
    try {
      const rows = await loadProposals({ data: undefined } as never);
      setProposals((rows ?? []) as unknown as WeatherProposal[]);
    } catch (e) { console.error("[AURA planner] proposals load failed", e); }
  }, [user, loadProposals]);

  useEffect(() => { void reloadProposals(); }, [reloadProposals]);

  useEffect(() => { if (focus?.date) setSelectedDate(focus.date); }, [focus?.date]);


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
    ? new Date(anchor.getFullYear(), anchor.getMonth(), 1).toLocaleDateString(i18n.language, { month: "long", year: "numeric" })
    : t("planner.weekOf", { day: cells[0].getDate(), month: cells[0].toLocaleDateString(i18n.language, { month: "short" }) });

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
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("planner.calendar")}</p>
        <div className="flex items-center justify-between mt-1">
          <h1 className="font-serif text-4xl">{monthLabel}</h1>
          <div className="flex gap-1">
            <button onClick={() => shift(-1)} aria-label={t("planner.previousPeriodAria")} className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90"><ChevronLeft size={16} /></button>
            <button onClick={() => shift(1)} aria-label={t("planner.nextPeriodAria")} className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90"><ChevronRight size={16} /></button>
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
              >{v === "month" ? t("planner.month") : t("planner.week")}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => go("builder")}
              className="h-9 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-95 inline-flex items-center gap-1"
                        ><Sparkles size={11} /> {t("planner.createOutfit")}</button>
                       <button
              onClick={() => go("trips")}
              aria-label={t("planner.tripsAria")}
              className="h-12 w-12 rounded-full border border-border flex items-center justify-center active:scale-95"
            ><Luggage size={26} /></button>
          </div>
        </div>
      </header>

      {latitude == null && (
        <div className="mx-6 mt-3 rounded-2xl border border-border/60 bg-card p-4">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("planner.weather")}</p>
          <p className="font-serif text-lg mt-1">{t("planner.enableLocationForForecast")}</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={detect}
              className="h-9 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-95 flex items-center gap-1.5"
            >
              {status === "loading" ? <Loader2 size={11} className="animate-spin" /> : <Cloud size={11} />}
              {t("planner.useLocation")}
            </button>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (manualCity.trim()) { void setManual(manualCity); setManualCity(""); } }}
            className="mt-2 flex gap-2"
          >
            <input
              value={manualCity}
              onChange={(e) => setManualCity(e.target.value)}
              placeholder={t("planner.orTypeCity")}
              className="flex-1 bg-background border border-border rounded-full px-4 py-2 text-sm outline-none focus:border-foreground"
            />
            <button className="h-9 px-4 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">{t("planner.save")}</button>
          </form>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t("planner.calendarWorksWithoutWeather")}
          </p>
        </div>
      )}
      {city && latitude != null && (
        <p className="mx-6 mt-3 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          {t("planner.forecastNextDays", { city, days: weather?.daily.length ?? 7 })}
        </p>
      )}

      <div className="mx-4 mt-4 grid grid-cols-7 gap-1 text-center">
        {getLocalizedDow(t).map((d, i) => (
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
                      <span className={`h-1.5 w-1.5 rounded-full ${isToday ? "bg-background" : "bg-[var(--champagne)]"}`} title={t("planner.calendarEventsCount", { count: eventsByDate[iso].length })} />
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
          proposals={proposals}
          onProposalResolved={() => { void reloadProposals(); void reload(); }}
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
  date, plans, calendarEvents, openStylistChat, items, signed, weather, currentTempC,
  proposals, onProposalResolved, onClose, onSaved,
}: {
  date: string;
  plans: OutfitPlan[];
  calendarEvents: ImportedEvent[];
  openStylistChat: (init: NonNullable<StylistChatInit>) => void;
  items: WardrobeItem[];
  signed: Record<string, string>;
  weather: DailyForecast | null;
  currentTempC: number | null;
  proposals: WeatherProposal[];
  onProposalResolved: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {

  const { t } = useTranslation();
  const { user } = useAuth();
  const resolveProposal = useServerFn(resolveWeatherProposal);
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

 const dateLabel = new Date(date + "T00:00:00").toLocaleDateString(i18n.language, {
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
  const [wornPickerOpen, setWornPickerOpen] = useState(false);
  const [wornSelected, setWornSelected] = useState<string[]>([]);
  const toggleWorn = (id: string) =>
    setWornSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const baseItems = filterSuggested && suggestedItems.length ? suggestedItems : items;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async ({ log }: { log: boolean }) => {
    if (!user) return;
    if (!selected.length) { toast.error(t("planner.pickAtLeastOnePiece")); return; }
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
      // Baseline for the hourly re-check: without a code and a rain
      // probability, a later forecast has nothing to be compared against.
      weather_code: weather?.weatherCode ?? null,
      weather_precipitation_probability: weather?.precipitationProbability ?? null,

      status,
      calendar_event_id: activeEventId,
    };

    // Slot choice (and therefore the unique constraint we upsert against)
    // is derived from whether this plan belongs to a calendar event — see
    // src/lib/outfit-plan-slot.ts.
    if (activeEventId) {
      const problem = await validateEventSlot(supabase, user.id, activeEventId, date);
      if (problem) { setSaving(false); toast.error(problem); return; }
    }
    const { onConflict } = resolvePlanSlot({ calendarEventId: activeEventId });
    const { data: savedPlan, error } = await supabase
      .from("outfit_plans")
      .upsert(payload as never, { onConflict })
      .select("id")
      .single();
    if (error) { setSaving(false); toast.error(error.message); return; }
    const planId = (savedPlan as { id: string }).id;

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

    // A manual edit resolves any open weather proposal for this plan:
    // the person has answered it by hand, so the worker must stop
    // re-raising it.
    const open = proposals.find((n) => n.data?.plan_id === planId);
    if (open) {
      try { await resolveProposal({ data: { notificationId: open.id, status: "dismissed" } }); onProposalResolved(); }
      catch (e) { console.error("[AURA planner] proposal resolve failed", e); }
    }

    setSaving(false);
    toast.success(plan ? t("planner.toastOutfitUpdated") : log ? t("planner.toastOutfitLogged") : t("planner.toastOutfitPlanned"));
    onSaved();
    if (hasMultipleSlots) setActiveSlot(null); else onClose();
  };

  const confirmWorn = async (actualItemIds?: string[]) => {
    if (!plan || !user) return;
    if (actualItemIds && !actualItemIds.length) { toast.error(t("planner.pickAtLeastOnePiece")); return; }
    setSaving(true);
    const { error } = await confirmOutfitPlanWorn(
      { id: plan.id, date: plan.date, item_ids: plan.item_ids, occasion: plan.occasion, notes: plan.notes },
      user.id,
      actualItemIds,
    );
    setSaving(false);
    if (error) { toast.error(error); return; }
    setWornPickerOpen(false);
    toast.success(t("planner.toastMarkedAsWorn"));
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
    toast.success(t("planner.toastRemoved"));
    onSaved();
    if (hasMultipleSlots) setActiveSlot(null); else onClose();
  };

  const askStylistFor = (event: ImportedEvent | null) => {
    const eventDateLabel = new Date(date + "T00:00:00").toLocaleDateString(i18n.language, {
      weekday: "long", month: "long", day: "numeric",
    });
    const promptMessage = event
      ? (event.location
          ? t("planner.chatPromptEventWithLocation", { title: event.title || t("planner.anEvent"), date: eventDateLabel, location: event.location })
          : t("planner.chatPromptEvent", { title: event.title || t("planner.anEvent"), date: eventDateLabel }))
      : t("planner.chatPromptGeneral", { date: eventDateLabel });
    openStylistChat({
      message: promptMessage,
      temperature: weather ? (weather.tempMin + weather.tempMax) / 2 : null,
      condition: weather ? describeWeather(weather.weatherCode).label : null,
      date,
      eventId: event?.id ?? null,
    });
  };

  const forecastCard = weather && (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("planner.forecast")}</p>
          <p className="font-serif text-2xl mt-1">
            {Math.round(weather.tempMax)}° / {Math.round(weather.tempMin)}°
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {describeWeather(weather.weatherCode).label} · {t("planner.rainPct", { pct: weather.precipitationProbability })}
          </p>
        </div>
        <span className="text-4xl">{describeWeather(weather.weatherCode).icon}</span>
      </div>
      {suggestion?.umbrellaTip && (
        <p className="mt-3 text-xs">☔ {suggestion.umbrellaTip}</p>
      )}
      {suggestion && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("planner.suggested")}</p>
          <p className="font-serif italic text-base mt-1">{suggestion.headline}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestion.tips.map((t2) => (
              <span key={t2} className="rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest bg-secondary/60">{t2}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // A weather_change proposal is always tied to one specific plan, so it
  // renders inside that plan's slot rather than at day level.
  const proposalForPlan = (p: OutfitPlan | null) =>
    (p ? proposals.find((n) => n.data?.plan_id === p.id) : undefined) ?? null;
  const activeProposal = proposalForPlan(plan);
  const dayProposals = proposals.filter((n) => n.data?.date === date);


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
            {slotPlan.status === "worn" ? t("planner.worn") : t("planner.planned")}
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
          <button onClick={onOpen} className="flex-1 h-9 rounded-full border border-border text-[10px] uppercase tracking-[0.2em]">{t("planner.choosePieces")}</button>
          <button onClick={onAsk} className="flex-1 h-9 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1"><Sparkles size={11} /> {t("planner.askStylist")}</button>
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
                {!activeSlot ? t("planner.outfits") : isPast ? t("planner.logOutfit") : t("planner.planOutfit")}
                {activeSlot?.type === "event" ? ` · ${activeSlot.event.title || t("planner.eventFallback")}` : activeSlot?.type === "general" ? ` · ${t("planner.generalLabel")}` : ""}
              </p>
              <p className="font-serif text-xl">{dateLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-full border border-border flex items-center justify-center shrink-0"><X size={16} /></button>
        </div>

        {!activeSlot ? (
          <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-3">
            {forecastCard}
            {dayProposals.map((p) => (
              <WeatherProposalCard
                key={p.id}
                proposal={p}
                items={items}
                signed={signed}
                onResolved={onProposalResolved}
              />
            ))}

            <SlotRow
              label={t("planner.generalLabel")}
              sublabel={t("planner.noSpecificEvent")}
              slotPlan={generalPlan}
              onOpen={() => setActiveSlot({ type: "general" })}
              onAsk={() => askStylistFor(null)}
            />
            {calendarEvents.map((e) => (
              <SlotRow
                key={e.id}
                label={e.title || t("planner.untitledEvent")}
                sublabel={[
                  !e.all_day ? new Date(e.start_time).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" }) : null,
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

              {activeProposal && (
                <WeatherProposalCard
                  proposal={activeProposal}
                  items={items}
                  signed={signed}
                  onResolved={onProposalResolved}
                  onCustomize={() => { setEditing(true); setSelected(activeProposal.data?.new_item_ids ?? selected); }}
                />
              )}


              {plan && !editing ? (
                <>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("planner.look")}</p>
                      <span className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        plan.status === "worn" ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground"
                      }`}>
                        {plan.status === "worn" ? t("planner.worn") : t("planner.planned")}
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
                      {plan.occasion && <p className="text-xs"><span className="uppercase tracking-widest text-muted-foreground text-[10px]">{t("planner.occasionPrefix")}</span>{plan.occasion}</p>}
                      {plan.notes && <p className="text-xs">{plan.notes}</p>}
                    </div>
                  )}
                  {plan.weather_condition && (
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                      {t("planner.wornIn", { condition: plan.weather_condition })}{plan.weather_temp != null ? ` · ${Math.round(Number(plan.weather_temp))}°` : ""}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                        {t("planner.choosePiecesSelected", { count: selected.length })}
                      </p>
                      {suggestedItems.length > 0 && (
                        <button
                          onClick={() => setFilterSuggested((v) => !v)}
                          className={`text-[10px] uppercase tracking-widest px-3 py-1 rounded-full flex items-center gap-1 ${
                            filterSuggested ? "bg-foreground text-background" : "bg-secondary/60"
                          }`}
                        >
                          <Sparkles size={10} /> {t("planner.suggested")}
                        </button>
                      )}
                    </div>
                    <PiecePicker
                      className="mt-3"
                      items={baseItems}
                      signed={signed}
                      selectedIds={selected}
                      onToggle={toggle}
                    />

                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("planner.occasion")}</p>
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
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("planner.note")}</p>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder={t("planner.optionalNote")}
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
                      onClick={() => { setWornSelected(plan.item_ids); setWornPickerOpen(true); }}
                      disabled={saving}
                      className="h-11 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2"
                    >
                      {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                      {t("planner.markAsWorn")}
                    </button>
                  )}

                  <button
                    onClick={() => setEditing(true)}
                    className="flex-1 h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                  >{t("planner.edit")}</button>
                </>
              ) : (
                <>
                  {plan && (
                    <button onClick={() => setEditing(false)} className="flex-1 h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">{t("planner.cancel")}</button>
                  )}
                  <button
                    onClick={() => void save({ log: isPast })}
                    disabled={saving}
                    className="flex-1 h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    {plan ? t("planner.saveButton") : isPast ? t("planner.logOutfit") : t("planner.planOutfit")}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {wornPickerOpen && plan && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={(e) => { e.stopPropagation(); setWornPickerOpen(false); }}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md h-[88vh] bg-background rounded-t-3xl flex flex-col animate-fade-up"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{dateLabel}</p>
                <p className="font-serif text-lg italic">{t("planner.whatDidYouWear")}</p>
              </div>
              <button onClick={() => setWornPickerOpen(false)} className="h-9 w-9 rounded-full border border-border flex items-center justify-center"><X size={15} /></button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain no-scrollbar px-5 py-4">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {t("planner.selectedCount", { count: wornSelected.length })}
              </p>
              <PiecePicker
                className="mt-3"
                items={items}
                signed={signed}
                selectedIds={wornSelected}
                onToggle={toggleWorn}
              />
            </div>
            <div className="border-t border-border/60 px-5 py-4">
              <button
                onClick={() => void confirmWorn(wornSelected)}
                disabled={saving}
                className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                {t("planner.confirmWorn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
