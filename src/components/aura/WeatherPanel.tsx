import { useEffect, useState } from "react";
import { Loader2, MapPin, RefreshCcw } from "lucide-react";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { useAuth } from "@/hooks/use-auth";

const dayLabel = (iso: string, i: number) => {
  if (i === 0) return "Today";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short" });
};

/** Compact weather summary for the "You" profile section — current
 *  conditions + a slim forecast strip, nothing more. The full outfit
 *  suggestion + matched-wardrobe grid this used to include duplicated
 *  what Home's "Today's Edit" already shows, and made this section by
 *  far the tallest thing on the profile screen. */
export function WeatherPanel() {
  useAuth(); // location/weather still need an authed session to be meaningful here
  const { city, latitude, longitude, status, error, detect, setManual } = useLocation();
  const { data, loading, error: wErr, reload } = useWeather(latitude, longitude);
  const [manual, setManualVal] = useState("");

  const needsLocation = latitude == null || longitude == null;

  return (
    <section className="mx-6 mt-6 rounded-3xl bg-card border border-border/60 p-4 animate-fade-up">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Weather</p>
          <h2 className="font-serif text-lg italic truncate">
            {city || "Set your location"}
          </h2>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={detect}
            className="h-8 px-3 rounded-full border border-border text-[10px] uppercase tracking-widest flex items-center gap-1.5 active:scale-95"
          >
            {status === "loading" ? <Loader2 size={10} className="animate-spin" /> : <MapPin size={10} />}
            Auto
          </button>
          {data && (
            <button
              onClick={reload}
              aria-label="Refresh weather"
              className="h-8 w-8 rounded-full border border-border flex items-center justify-center active:scale-95"
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCcw size={10} />}
            </button>
          )}
        </div>
      </div>

      {needsLocation && (
        <form
          onSubmit={(e) => { e.preventDefault(); setManual(manual); setManualVal(""); }}
          className="mt-3 flex gap-2"
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
        <div className="mt-3 flex items-center justify-center text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
      {wErr && (
        <p className="mt-2 text-xs text-red-700">Couldn't load weather. {wErr}</p>
      )}

      {data && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-3xl leading-none">
              {describeWeather(data.current.weatherCode, data.current.isDay).icon}
            </span>
            <div>
              <p className="font-serif text-2xl leading-none">
                {Math.round(data.current.temperature)}{data.units.temp}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {describeWeather(data.current.weatherCode, data.current.isDay).label}
              </p>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {data.daily.slice(0, 5).map((d, i) => {
              const w = describeWeather(d.weatherCode, true);
              return (
                <div key={d.date} className="shrink-0 rounded-xl bg-secondary/40 px-2 py-1.5 flex flex-col items-center gap-0.5 min-w-[38px]">
                  <span className="text-[8px] uppercase tracking-widest text-muted-foreground">{dayLabel(d.date, i)}</span>
                  <span className="text-sm leading-none">{w.icon}</span>
                  <span className="text-[9px] font-serif">{Math.round(d.tempMax)}°</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
