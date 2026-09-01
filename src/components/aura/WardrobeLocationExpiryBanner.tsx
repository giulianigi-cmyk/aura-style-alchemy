import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { listLocations, resolveLocationExpiry } from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * A location's "until" date reaching today never moves anything by
 * itself — it only ever surfaces this confirmation, same principle as
 * the full section in Settings → Wardrobe Locations. That full section
 * already has this exact logic, but it only shows once someone
 * navigates there on their own — a temporary location (a summer
 * rental, say) expiring silently in a settings screen nobody visits
 * that day defeats the point of the reminder. This is the same check,
 * surfaced where it's actually seen: the Home screen, first thing on
 * open.
 */
export function WardrobeLocationExpiryBanner() {
  const { t } = useTranslation();
  const list = useServerFn(listLocations);
  const resolveExpiry = useServerFn(resolveLocationExpiry);
  const [locations, setLocations] = useState<WardrobeLocation[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    list({} as never)
      .then((res) => setLocations(res.locations))
      .catch((e) => console.error("[AURA home] location expiry check failed", e));
  }, [list]);

  const confirm = async (loc: WardrobeLocation) => {
    setBusyId(loc.id);
    try {
      await resolveExpiry({ data: { id: loc.id } });
      toast.success(t("wardrobeLocations.movedBack", { name: loc.name }));
      setLocations((prev) => prev.filter((l) => l.id !== loc.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("wardrobeLocations.couldntMoveBack"));
    } finally {
      setBusyId(null);
    }
  };

  const today = todayIso();
  const expired = locations.filter((l) => l.end_date && l.end_date <= today && !dismissed.has(l.id));
  if (expired.length === 0) return null;

  return (
    <section className="mx-6 mt-4 space-y-2 animate-fade-up">
      {expired.map((loc) => (
        <div key={loc.id} className="rounded-2xl border border-foreground/20 bg-secondary/40 p-3">
          <p className="text-xs flex items-center gap-1.5"><CalendarClock size={13} /> {t("wardrobeLocations.periodEnded", { name: loc.name })}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t("wardrobeLocations.moveEverythingBack")}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void confirm(loc)}
              disabled={busyId === loc.id}
              className="flex-1 h-9 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {busyId === loc.id && <Loader2 size={11} className="animate-spin" />}
              {t("wardrobeLocations.moveBack")}
            </button>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(loc.id))}
              disabled={busyId === loc.id}
              className="h-9 px-4 rounded-full border border-border text-[10px] uppercase tracking-[0.2em]"
            >{t("wardrobeLocations.notNow")}</button>
          </div>
        </div>
      ))}
    </section>
  );
}
