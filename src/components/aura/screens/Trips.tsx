import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus, Loader2, Briefcase, Palmtree, Shuffle, Settings2 } from "lucide-react";
import type { Screen } from "../AuraApp";
import { listTrips, type Trip, type TripDestination } from "@/lib/trips.functions";
import i18n from "@/i18n/config";

type TripWithDestinations = Trip & { destinations: TripDestination[] };

const TYPE_ICON = { work: Briefcase, leisure: Palmtree, mixed: Shuffle } as const;

function formatRange(destinations: TripDestination[]): string {
  if (!destinations.length) return "";
  const start = destinations[0].start_date;
  const end = destinations[destinations.length - 1].end_date;
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function Trips({ go, openTrip }: { go: (s: Screen) => void; openTrip: (tripId: string) => void }) {
  const { t } = useTranslation();
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
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("trips.tripPlanner")}</p>
            <h1 className="font-serif text-3xl mt-1">{t("trips.title")}</h1>
          </div>
        </div>
        <button
          onClick={() => go("essential-presets")}
          aria-label={t("trips.manageEssentialsAria")}
          className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
        ><Settings2 size={15} /></button>
      </header>

      <div className="px-6 mt-4">
        <button
          onClick={() => go("trip-create")}
          className="w-full h-12 rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] active:scale-[0.98] shadow-luxe inline-flex items-center justify-center gap-2"
        ><Plus size={16} /> {t("trips.planATrip")}</button>
      </div>

      {loading ? (
        <div className="flex justify-center mt-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : trips.length === 0 ? (
        <div className="px-6 mt-16 text-center animate-fade-up">
          <p className="font-serif text-2xl italic">{t("trips.noTripsYet")}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {t("trips.emptyStateHint")}
          </p>
        </div>
      ) : (
        <div className="px-6 mt-6 space-y-6">
          {upcoming.length > 0 && (
            <section className="space-y-2">
              {upcoming.map((t2) => {
                const Icon = TYPE_ICON[t2.trip_type];
                return (
                  <button
                    key={t2.id}
                    onClick={() => openTrip(t2.id)}
                    className="w-full rounded-2xl border border-border/60 bg-card p-4 text-left flex items-center gap-3 active:scale-[0.98] transition"
                  >
                    <span className="h-11 w-11 rounded-full bg-secondary/60 flex items-center justify-center shrink-0"><Icon size={17} /></span>
                    <div className="min-w-0">
                      <p className="font-serif text-lg truncate">{t2.name || t("trips.untitledTrip")}</p>
                      <p className="text-[11px] text-muted-foreground">{formatRange(t2.destinations)}</p>
                    </div>
                    <span className="ml-auto shrink-0 text-[9px] uppercase tracking-widest text-muted-foreground">{t2.status}</span>
                  </button>
                );
              })}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("trips.pastTrips")}</p>
              {past.map((t2) => {
                const Icon = TYPE_ICON[t2.trip_type];
                return (
                  <button
                    key={t2.id}
                    onClick={() => openTrip(t2.id)}
                    className="w-full rounded-2xl border border-border/60 bg-card p-4 text-left flex items-center gap-3 active:scale-[0.98] transition opacity-70"
                  >
                    <span className="h-11 w-11 rounded-full bg-secondary/60 flex items-center justify-center shrink-0"><Icon size={17} /></span>
                    <div className="min-w-0">
                      <p className="font-serif text-lg truncate">{t2.name || t("trips.untitledTrip")}</p>
                      <p className="text-[11px] text-muted-foreground">{formatRange(t2.destinations)}</p>
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
