import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, Briefcase, Palmtree, Shuffle } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { createTrip, type TripType } from "@/lib/trips.functions";
import { applyPresetsToTrip } from "@/lib/essentials.functions";
import { listEssentialPresets, type EssentialPreset } from "@/lib/essentials.functions";
import { listLocations } from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";
import { searchDestinations, type DestinationSearchResult } from "@/lib/destination-search";

const TYPE_KEYS: { value: TripType; labelKey: string; icon: typeof Briefcase }[] = [
  { value: "work", labelKey: "tripCreate.typeWork", icon: Briefcase },
  { value: "leisure", labelKey: "tripCreate.typeLeisure", icon: Palmtree },
  { value: "mixed", labelKey: "tripCreate.typeMixed", icon: Shuffle },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TripCreate({ go, onCreated }: { go: (s: Screen) => void; onCreated: (tripId: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [tripType, setTripType] = useState<TripType>("leisure");
  const [destinationName, setDestinationName] = useState("");
  const [destinationLat, setDestinationLat] = useState<number | null>(null);
  const [destinationLon, setDestinationLon] = useState<number | null>(null);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destinationResults, setDestinationResults] = useState<DestinationSearchResult[]>([]);
  const [searchingDestination, setSearchingDestination] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [laundryAvailable, setLaundryAvailable] = useState(false);

  const [locations, setLocations] = useState<WardrobeLocation[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [presets, setPresets] = useState<EssentialPreset[]>([]);
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [loadingContext, setLoadingContext] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([listLocations(), listEssentialPresets()])
      .then(([locRes, presetRes]) => {
        setLocations(locRes.locations);
        // No locations set up yet (the common single-home case) — that's
        // fine, the outfit engine already treats "no active location" as
        // "use the whole wardrobe". Only pre-select when there's a real
        // choice to make.
        if (locRes.activeLocationId) setSelectedLocationIds([locRes.activeLocationId]);
        setPresets(presetRes.presets.map((p) => ({ id: p.id, user_id: p.user_id, name: p.name, created_at: p.created_at })));
      })
      .catch((e) => console.error("[AURA trip-create] context load failed", e))
      .finally(() => setLoadingContext(false));
  }, []);

  useEffect(() => {
    if (destinationLat != null && destinationQuery === destinationName) return; // already picked, don't re-search
    if (destinationQuery.trim().length < 2) { setDestinationResults([]); return; }
    setSearchingDestination(true);
    const t = setTimeout(() => {
      searchDestinations(destinationQuery)
        .then(setDestinationResults)
        .finally(() => setSearchingDestination(false));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationQuery]);

  const pickDestination = (r: DestinationSearchResult) => {
    const label = [r.name, r.admin1, r.country].filter(Boolean).join(", ");
    setDestinationName(label);
    setDestinationQuery(label);
    setDestinationLat(r.latitude);
    setDestinationLon(r.longitude);
    setDestinationResults([]);
  };

  const toggleLocation = (id: string) =>
    setSelectedLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const togglePreset = (id: string) =>
    setSelectedPresetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canCreate = destinationName.trim().length > 0 && destinationLat != null && startDate && endDate && endDate >= startDate
    && (locations.length === 0 || selectedLocationIds.length > 0);

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      // No locations configured at all — fall back to the wardrobe as a
      // whole (matches how the rest of the app treats "no Locations set
      // up"). Once a person creates one, createTrip requires an explicit
      // choice, same rule as everywhere else this matters.
      const sourceLocationIds = locations.length === 0 ? [] : selectedLocationIds;
      const res = await createTrip({
        data: {
          name: name.trim() || null,
          tripType,
          laundryAvailable,
          sourceLocationIds,
          destinations: [{ destinationName: destinationName.trim(), latitude: destinationLat, longitude: destinationLon, startDate, endDate }],
        },
      });
      if (selectedPresetIds.length) {
        await applyPresetsToTrip({ data: { tripId: res.trip.id, presetIds: selectedPresetIds } });
      }
      toast.success(t("tripCreate.tripCreated"));
      onCreated(res.trip.id);
    } catch (e) {
      console.error("[AURA trip-create] failed", e);
      toast.error(e instanceof Error ? e.message : t("tripCreate.couldntCreateTrip"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center gap-3">
        <button onClick={() => go("trips")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("tripCreate.tripPlanner")}</p>
          <h1 className="font-serif text-3xl mt-1">{t("tripCreate.planATrip")}</h1>
        </div>
      </header>

      {loadingContext ? (
        <div className="flex justify-center mt-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="px-6 mt-6 space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("tripCreate.whereAreYouGoing")}</p>
            <input
              value={destinationQuery}
              onChange={(e) => { setDestinationQuery(e.target.value); setDestinationName(""); setDestinationLat(null); setDestinationLon(null); }}
              placeholder={t("tripCreate.searchCityPlaceholder")}
              className="w-full bg-secondary/60 rounded-full px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            {searchingDestination && <p className="mt-1.5 text-[11px] text-muted-foreground">{t("tripCreate.searching")}</p>}
            {destinationResults.length > 0 && (
              <div className="mt-2 rounded-2xl border border-border/60 bg-card overflow-hidden">
                {destinationResults.map((r, i) => (
                  <button
                    key={`${r.name}-${r.latitude}-${i}`}
                    onClick={() => pickDestination(r)}
                    className="w-full px-4 py-2.5 text-left text-sm border-b border-border/40 last:border-b-0 active:bg-secondary/40"
                  >
                    {r.name}
                    <span className="text-muted-foreground">{[r.admin1, r.country].filter(Boolean).length ? ` — ${[r.admin1, r.country].filter(Boolean).join(", ")}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
            {destinationLat != null && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t("tripCreate.weatherWillUseLocation")}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("tripCreate.from")}</p>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("tripCreate.to")}</p>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
              />
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("tripCreate.tripType")}</p>
            <div className="flex gap-2">
              {TYPE_KEYS.map(({ value, labelKey, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTripType(value)}
                  className={`flex-1 h-16 rounded-2xl border flex flex-col items-center justify-center gap-1 ${tripType === value ? "bg-foreground text-background border-foreground" : "border-border"}`}
                >
                  <Icon size={16} />
                  <span className="text-[10px] uppercase tracking-widest">{t(labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {locations.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("tripCreate.packFromWhichWardrobe")}</p>
              <div className="flex flex-wrap gap-2">
                {locations.map((loc) => {
                  const on = selectedLocationIds.includes(loc.id);
                  return (
                    <button
                      key={loc.id}
                      onClick={() => toggleLocation(loc.id)}
                      className={`rounded-full px-3 py-1.5 text-xs border ${on ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}
                    >{loc.name}</button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t("tripCreate.selectMoreThanOneHint")}</p>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("tripCreate.laundryAtDestination")}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setLaundryAvailable(true)}
                className={`flex-1 h-11 rounded-full border text-xs uppercase tracking-widest ${laundryAvailable ? "bg-foreground text-background border-foreground" : "border-border"}`}
              >{t("tripCreate.yes")}</button>
              <button
                onClick={() => setLaundryAvailable(false)}
                className={`flex-1 h-11 rounded-full border text-xs uppercase tracking-widest ${!laundryAvailable ? "bg-foreground text-background border-foreground" : "border-border"}`}
              >{t("tripCreate.no")}</button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {laundryAvailable ? t("tripCreate.laundryYesHint") : t("tripCreate.laundryNoHint")}
            </p>
          </div>

          {presets.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("tripCreate.applyEssentialsList")}</p>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => {
                  const on = selectedPresetIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePreset(p.id)}
                      className={`rounded-full px-3 py-1.5 text-xs border ${on ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}
                    >{p.name}</button>
                  );
                })}
              </div>
            </div>
          )}
          {presets.length === 0 && (
            <button
              onClick={() => go("essential-presets")}
              className="text-[11px] text-muted-foreground underline"
            >{t("tripCreate.setUpEssentialsListHint")}</button>
          )}

          <button
            onClick={() => void create()}
            disabled={!canCreate || creating}
            className="w-full h-12 rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] active:scale-[0.98] shadow-luxe disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            {t("tripCreate.createTrip")}
          </button>
        </div>
      )}
    </div>
  );
}
