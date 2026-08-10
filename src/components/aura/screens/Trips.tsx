import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Loader2, Briefcase, Palmtree, Shuffle, Settings2 } from "lucide-react";
import type { Screen } from "../AuraApp";
import { listTrips, type Trip, type TripDestination } from "@/lib/trips.functions";

type TripWithDestinations = Trip & { destinations: TripDestination[] };

const TYPE_ICON = { work: Briefcase, leisure: Palmtree, mixed: Shuffle } as const;

function formatRange(destinations: TripDestination[]): string {
  if (!destinations.length) return "";
  const start = destinations[0].start_date;
  const end = destinations[destinations.length - 1].end_date;
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function Trips({ go, openTrip }: { go: (s: Screen) => void; openTrip: (tripId: string) => void }) {
  const [trips, setTrips] = useState<TripWithDestinations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listTrips()
      .then((res) => setTrips(res.trips as TripWithDestinations[]))
      .catch((e) => console.error("[AURA trips] load failed", e))
      .finally(() => setLoading(false));
  }, []);

  const upcoming = trips.filter((t) => t.status !== "completed");
  const past = trips.filter((t) => t.status === "completed");

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => go("planner")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
            <ArrowLeft size={16} />
          </button>
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Trip planner</p>
            <h1 className="font-serif text-3xl mt-1">Trips</h1>
          </div>
        </div>
        <button
          onClick={() => go("essential-presets")}
          aria-label="Manage essentials presets"
          className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
        ><Settings2 size={15} /></button>
      </header>

      <div className="px-6 mt-4">
        <button
          onClick={() => go("trip-create")}
          className="w-full h-12 rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] active:scale-[0.98] shadow-luxe inline-flex items-center justify-center gap-2"
        ><Plus size={16} /> Plan a trip</button>
      </div>

      {loading ? (
        <div className="flex justify-center mt-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : trips.length === 0 ? (
        <div className="px-6 mt-16 text-center animate-fade-up">
          <p className="font-serif text-2xl italic">No trips yet</p>
          <p className="text-sm text-muted-foreground mt-2">
            Tell AURA where you're going and it'll work out what to pack — outfits included, not just a checklist.
          </p>
        </div>
      ) : (
        <div className="px-6 mt-6 space-y-6">
          {upcoming.length > 0 && (
            <section className="space-y-2">
              {upcoming.map((t) => {
                const Icon = TYPE_ICON[t.trip_type];
                return (
                  <button
                    key={t.id}
                    onClick={() => openTrip(t.id)}
                    className="w-full rounded-2xl border border-border/60 bg-card p-4 text-left flex items-center gap-3 active:scale-[0.98] transition"
                  >
                    <span className="h-11 w-11 rounded-full bg-secondary/60 flex items-center justify-center shrink-0"><Icon size={17} /></span>
                    <div className="min-w-0">
                      <p className="font-serif text-lg truncate">{t.name || "Untitled trip"}</p>
                      <p className="text-[11px] text-muted-foreground">{formatRange(t.destinations)}</p>
                    </div>
                    <span className="ml-auto shrink-0 text-[9px] uppercase tracking-widest text-muted-foreground">{t.status}</span>
                  </button>
                );
              })}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Past trips</p>
              {past.map((t) => {
                const Icon = TYPE_ICON[t.trip_type];
                return (
                  <button
                    key={t.id}
                    onClick={() => openTrip(t.id)}
                    className="w-full rounded-2xl border border-border/60 bg-card p-4 text-left flex items-center gap-3 active:scale-[0.98] transition opacity-70"
                  >
                    <span className="h-11 w-11 rounded-full bg-secondary/60 flex items-center justify-center shrink-0"><Icon size={17} /></span>
                    <div className="min-w-0">
                      <p className="font-serif text-lg truncate">{t.name || "Untitled trip"}</p>
                      <p className="text-[11px] text-muted-foreground">{formatRange(t.destinations)}</p>
                    </div>
                  </button>
                );
              })}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
