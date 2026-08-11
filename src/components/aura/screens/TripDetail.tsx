import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Loader2, Briefcase, Palmtree, Shuffle, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { listTrips, deleteTrip, type Trip, type TripDestination } from "@/lib/trips.functions";

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    listTrips()
      .then((res) => setTrips(res.trips as TripWithDestinations[]))
      .catch((e) => console.error("[AURA trips] load failed", e))
      .finally(() => setLoading(false));
  }, []);

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteTrip({ data: { tripId: confirmDeleteId } });
      setTrips((prev) => prev.filter((t) => t.id !== confirmDeleteId));
      toast.success("Trip deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete trip");
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

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
                  <div key={t.id} className="relative">
                    <button
                      onClick={() => openTrip(t.id)}
                      className="w-full rounded-2xl border border-border/60 bg-card p-4 pr-12 text-left flex items-center gap-3 active:scale-[0.98] transition"
                    >
                      <span className="h-11 w-11 rounded-full bg-secondary/60 flex items-center justify-center shrink-0"><Icon size={17} /></span>
                      <div className="min-w-0">
                        <p className="font-serif text-lg truncate">{t.name || "Untitled trip"}</p>
                        <p className="text-[11px] text-muted-foreground">{formatRange(t.destinations)}</p>
                      </div>
                      <span className="ml-auto shrink-0 text-[9px] uppercase tracking-widest text-muted-foreground">{t.status}</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}
                      aria-label={`Delete ${t.name || "trip"}`}
                      className="absolute top-1/2 -translate-y-1/2 right-3 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground active:scale-90"
                    ><Trash2 size={14} /></button>
                  </div>
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
                  <div key={t.id} className="relative opacity-70">
                    <button
                      onClick={() => openTrip(t.id)}
                      className="w-full rounded-2xl border border-border/60 bg-card p-4 pr-12 text-left flex items-center gap-3 active:scale-[0.98] transition"
                    >
                      <span className="h-11 w-11 rounded-full bg-secondary/60 flex items-center justify-center shrink-0"><Icon size={17} /></span>
                      <div className="min-w-0">
                        <p className="font-serif text-lg truncate">{t.name || "Untitled trip"}</p>
                        <p className="text-[11px] text-muted-foreground">{formatRange(t.destinations)}</p>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}
                      aria-label={`Delete ${t.name || "trip"}`}
                      className="absolute top-1/2 -translate-y-1/2 right-3 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground active:scale-90"
                    ><Trash2 size={14} /></button>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center px-6" onClick={() => setConfirmDeleteId(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-2xl border border-destructive/40 bg-card p-5 shadow-luxe">
            <p className="font-serif text-lg text-center">Delete this trip?</p>
            <p className="text-xs text-muted-foreground text-center mt-1">This cannot be undone.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmDeleteId(null)} className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">Cancel</button>
              <button
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="h-11 rounded-full bg-destructive text-destructive-foreground text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
