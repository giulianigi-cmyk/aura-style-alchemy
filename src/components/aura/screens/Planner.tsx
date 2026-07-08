import { ChevronLeft, ChevronRight, X, Plus, Loader2, Sparkles, Cloud, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather, classifyTemp, suggestOutfit, type WeatherBand, type DailyForecast } from "@/lib/weather";
import type { WardrobeItem } from "@/lib/aura-types";
import type { Tables } from "@/integrations/supabase/types";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";

type OutfitPlan = Tables<"outfit_plans">;

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
  // 6 weeks (42 days) starting on Monday of the week containing the 1st.
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7; // 0=Mon
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function weekGrid(anchor: Date): Date[] {
  const dow = (anchor.getDay() + 6) % 7;
  const start = addDays(startOfDay(anchor), -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function categoriesForBand(band: WeatherBand, rainy: boolean): string[] {
  const base: Record<WeatherBand, string[]> = {
    cold: ["coat", "outerwear", "knit", "sweater", "boots", "scarf"],
    cool: ["jacket", "blazer", "knit", "trousers", "boots"],
    mild: ["jacket", "shirt", "jeans", "trousers", "sneakers"],
    warm: ["shirt", "skirt", "dress", "linen", "loafers"],
    hot: ["dress", "shorts", "sandals", "tee"],
  };
  return rainy ? ["raincoat", "trench", "boots", ...base[band]] : base[band];
}

function itemMatchesKeywords(it: WardrobeItem, keywords: string[]): boolean {
  const hay = `${it.category ?? ""} ${it.brand ?? ""} ${it.color ?? ""} ${it.style ?? ""} ${it.occasion ?? ""} ${it.season ?? ""}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

export function Planner({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const { city, latitude, longitude, status, detect, setManual } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);

  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [plans, setPlans] = useState<OutfitPlan[]>([]);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [manualCity, setManualCity] = useState("");

  // Load items + plans
  const reload = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const [{ data: it }, { data: pl }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", user.id),
      supabase.from("outfit_plans").select("*").eq("user_id", user.id).order("date"),
    ]);
    const list = (it ?? []) as WardrobeItem[];
    setItems(list);
    setPlans((pl ?? []) as OutfitPlan[]);
    setSigned(await resolveWardrobeUrls(list));
    setLoading(false);
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);

  const plansByDate = useMemo(() => {
    const m: Record<string, OutfitPlan> = {};
    plans.forEach((p) => { m[p.date] = p; });
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

  const selectedPlan = selectedDate ? plansByDate[selectedDate] ?? null : null;

  if (!user) return null;

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Calendar</p>
        <div className="flex items-center justify-between mt-1">
          <h1 className="font-serif text-4xl">{monthLabel}</h1>
          <div className="flex gap-1">
            <button onClick={() => shift(-1)} className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90"><ChevronLeft size={16} /></button>
            <button onClick={() => shift(1)} className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-90"><ChevronRight size={16} /></button>
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

      {/* Location prompt if missing */}
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

      {/* Day-of-week header */}
      <div className="mx-4 mt-4 grid grid-cols-7 gap-1 text-center">
        {DOW.map((d, i) => (
          <span key={i} className="text-[9px] uppercase tracking-widest text-muted-foreground">{d}</span>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center mt-16 text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="mx-4 mt-2 grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const iso = toISO(d);
            const inMonth = view === "week" || d.getMonth() === anchor.getMonth();
            const isToday = iso === today;
            const plan = plansByDate[iso];
            const daily = dailyByDate[iso];
            const wIcon = daily ? describeWeather(daily.weatherCode).icon : null;
            const thumb = plan ? firstImageFor(plan) : null;

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
                  {wIcon && <span className="text-[10px] leading-none">{wIcon}</span>}
                </div>
                {daily && (
                  <span className={`text-[8px] uppercase tracking-wider pl-1 ${isToday ? "opacity-80" : "text-muted-foreground"}`}>
                    {Math.round(daily.tempMax)}°
                  </span>
                )}
                {thumb ? (
                  <div className="mt-auto rounded-md overflow-hidden aspect-square" style={{ background: "#FFFFFF" }}>
                    <img src={thumb} alt="" className="h-full w-full object-contain p-0.5" loading="lazy" />
                  </div>
                ) : plan ? (
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
          plan={selectedPlan}
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

function DayDetail({
  date, plan, items, signed, weather, currentTempC, onClose, onSaved,
}: {
  date: string;
  plan: OutfitPlan | null;
  items: WardrobeItem[];
  signed: Record<string, string>;
  weather: DailyForecast | null;
  currentTempC: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const isPast = date < toISO(new Date());
  const [editing, setEditing] = useState(!plan);
  const [selected, setSelected] = useState<string[]>(plan?.item_ids ?? []);
  const [occasion, setOccasion] = useState(plan?.occasion ?? "");
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [filterSuggested, setFilterSuggested] = useState(false);

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  // Weather suggestion basis (forecast for the day if available, otherwise current)
  const suggestTempC = weather ? (weather.tempMin + weather.tempMax) / 2 : currentTempC;
  const rainy = weather ? weather.precipitationProbability >= 50 : false;
  const band = suggestTempC != null ? classifyTemp(suggestTempC) : null;
  const suggestion = band ? suggestOutfit({
    temperature: suggestTempC ?? 15,
    apparentTemperature: suggestTempC ?? 15,
    weatherCode: weather?.weatherCode ?? 0,
    windSpeed: 0,
    precipitationProbability: weather?.precipitationProbability ?? 0,
    isDay: true,
  }) : null;

  const suggestedKeywords = band ? categoriesForBand(band, rainy) : [];
  const suggestedItems = useMemo(
    () => (suggestedKeywords.length ? items.filter((it) => itemMatchesKeywords(it, suggestedKeywords)) : []),
    [items, suggestedKeywords],
  );
  const visibleItems = filterSuggested && suggestedItems.length ? suggestedItems : items;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async ({ log }: { log: boolean }) => {
    if (!user) return;
    if (!selected.length) { toast.error("Pick at least one piece"); return; }
    setSaving(true);
    const payload = {
      user_id: user.id,
      date,
      item_ids: selected,
      occasion: occasion || null,
      notes: notes || null,
      weather_temp: weather?.tempMax ?? currentTempC ?? null,
      weather_condition: weather ? describeWeather(weather.weatherCode).label : null,
    };
    const q = plan
      ? supabase.from("outfit_plans").update(payload).eq("id", plan.id)
      : supabase.from("outfit_plans").insert(payload);
    const { error } = await q;
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }
    // For "log" (past outfit) — increment worn_count on chosen items.
    // Only bump on the newly added items relative to the existing plan.
    if (log) {
      const prev = new Set(plan?.item_ids ?? []);
      const toBump = selected.filter((id) => !prev.has(id));
      if (toBump.length) {
        // Fetch current worn_counts, then per-item update (RLS scoped).
        const { data: rows } = await supabase
          .from("wardrobe_items")
          .select("id,worn_count")
          .in("id", toBump);
        await Promise.all(
          (rows ?? []).map((r) =>
            supabase.from("wardrobe_items")
              .update({ worn_count: (r.worn_count ?? 0) + 1 })
              .eq("id", r.id),
          ),
        );
      }
    }
    setSaving(false);
    toast.success(plan ? "Outfit updated" : log ? "Outfit logged" : "Outfit planned");
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!plan) return;
    setSaving(true);
    const { error } = await supabase.from("outfit_plans").delete().eq("id", plan.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Removed");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-[92vh] bg-background rounded-t-3xl flex flex-col animate-fade-up"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{isPast ? "Log outfit" : "Plan outfit"}</p>
            <p className="font-serif text-xl">{dateLabel}</p>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-full border border-border flex items-center justify-center"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-5">
          {weather && (
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
          )}

          {plan && !editing ? (
            <>
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Look</p>
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
      </div>
    </div>
  );
}
