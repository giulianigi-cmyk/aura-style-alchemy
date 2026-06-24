import { useEffect, useState } from "react";
import { Loader2, MapPin, RefreshCcw } from "lucide-react";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather, suggestOutfit } from "@/lib/weather";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";

const wardrobeColumns = "id,user_id,image_url,category,brand,color,season,style,occasion,created_at";

const dayLabel = (iso: string, i: number) => {
  if (i === 0) return "Today";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short" });
};

export function WeatherPanel() {
  const { user } = useAuth();
  const { city, latitude, longitude, status, error, detect, setManual } = useLocation();
  const { data, loading, error: wErr, reload } = useWeather(latitude, longitude);
  const [manual, setManualVal] = useState("");
  const [items, setItems] = useState<WardrobeItem[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("wardrobe_items")
      .select(wardrobeColumns)
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (error) console.error("[AURA wardrobe] weather panel load error", error);
        setItems((data as WardrobeItem[]) ?? []);
      });
  }, [user]);

  const suggestion = data ? suggestOutfit(data.current) : null;
  const matched = suggestion
    ? items
        .filter((it) => {
          const hay = `${it.category ?? ""} ${it.brand ?? ""} ${it.color ?? ""} ${it.style ?? ""} ${it.occasion ?? ""} ${it.season ?? ""}`.toLowerCase();
          return suggestion.categories.some((c) => hay.includes(c));
        })
        .slice(0, 6)
    : [];

  const needsLocation = latitude == null || longitude == null;

  return (
    <section className="mx-6 mt-6 rounded-3xl bg-card border border-border/60 p-5 animate-fade-up">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Weather</p>
          <h2 className="font-serif text-2xl italic mt-1 truncate">
            {city || "Set your location"}
          </h2>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={detect}
            className="h-9 px-3 rounded-full border border-border text-[10px] uppercase tracking-widest flex items-center gap-1.5 active:scale-95"
          >
            {status === "loading" ? <Loader2 size={11} className="animate-spin" /> : <MapPin size={11} />}
            Auto
          </button>
          {data && (
            <button
              onClick={reload}
              aria-label="Refresh weather"
              className="h-9 w-9 rounded-full border border-border flex items-center justify-center active:scale-95"
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
            </button>
          )}
        </div>
      </div>

      {needsLocation && (
        <form
          onSubmit={(e) => { e.preventDefault(); setManual(manual); setManualVal(""); }}
          className="mt-4 flex gap-2"
        >
          <input
            value={manual}
            onChange={(e) => setManualVal(e.target.value)}
            placeholder="Enter your city"
            className="flex-1 bg-background border border-border rounded-full px-4 py-2 text-sm outline-none focus:border-foreground"
          />
          <button type="submit" className="h-9 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-95">
            Save
          </button>
        </form>
      )}
      {status === "denied" && (
        <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          Location permission denied — enter your city above.
        </p>
      )}
      {error && status === "error" && (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      )}

      {loading && !data && (
        <div className="mt-6 flex items-center justify-center text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
      {wErr && (
        <p className="mt-3 text-xs text-red-700">Couldn't load weather. {wErr}</p>
      )}

      {data && (
        <>
          {/* Current */}
          <div className="mt-5 flex items-end justify-between">
            <div>
              <p className="font-serif text-5xl leading-none">
                {Math.round(data.current.temperature)}{data.units.temp}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {describeWeather(data.current.weatherCode, data.current.isDay).label} ·
                {" "}feels {Math.round(data.current.apparentTemperature)}{data.units.temp}
              </p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                Wind {Math.round(data.current.windSpeed)} {data.units.wind} ·
                {" "}Rain {data.current.precipitationProbability}%
              </p>
            </div>
            <span className="text-5xl leading-none">
              {describeWeather(data.current.weatherCode, data.current.isDay).icon}
            </span>
          </div>

          {/* 7-day */}
          <div className="mt-6">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">7-day forecast</p>
            <div className="grid grid-cols-7 gap-1.5">
              {data.daily.slice(0, 7).map((d, i) => {
                const w = describeWeather(d.weatherCode, true);
                return (
                  <div key={d.date} className="rounded-xl bg-secondary/40 p-2 flex flex-col items-center gap-1">
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{dayLabel(d.date, i)}</span>
                    <span className="text-lg leading-none">{w.icon}</span>
                    <span className="text-[10px] font-serif">{Math.round(d.tempMax)}°</span>
                    <span className="text-[9px] text-muted-foreground">{Math.round(d.tempMin)}°</span>
                    <span className="text-[8px] uppercase tracking-widest text-muted-foreground">{d.precipitationProbability}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Outfit suggestion */}
          {suggestion && (
            <div className="mt-6 rounded-2xl gradient-warm border border-border/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Today's recommendation</p>
              <h3 className="font-serif text-xl italic mt-1">{suggestion.headline}</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {suggestion.tips.map((t) => (
                  <span key={t} className="rounded-full px-3 py-1 text-[10px] uppercase tracking-widest bg-background/70 border border-border/60">
                    {t}
                  </span>
                ))}
              </div>
              {matched.length > 0 && (
                <>
                  <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">From your wardrobe</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {matched.map((it) => (
                      <div key={it.id} className="rounded-xl overflow-hidden bg-secondary/40 aspect-square">
                        {it.image_url && (
                          <img src={it.image_url} alt={`${it.brand ?? it.color ?? it.category ?? "Wardrobe"} piece`} className="h-full w-full object-cover" loading="lazy" />
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {matched.length === 0 && items.length > 0 && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  No matching pieces yet — tag your wardrobe by category to unlock smarter picks.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
