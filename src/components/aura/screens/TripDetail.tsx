import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { listOpenWeatherProposals, resolveWeatherProposal } from "@/lib/plan-weather.functions";
import { WeatherProposalCard, type WeatherProposal } from "../WeatherProposalCard";
import { ArrowLeft, Loader2, Check, Plus, X, Trash2, Briefcase, Palmtree, Shuffle, CalendarDays, Sun, Moon, Luggage, Sparkles, AlertCircle, Info, Copy, Pencil, Image as ImageIcon } from "lucide-react";
import { PiecePicker } from "../PiecePicker";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { getTrip, deleteTrip, updateTripOutfitPlanItems, deleteTripOutfitPlan, type Trip, type TripDestination, type TripType, type DaySegment } from "@/lib/trips.functions";
import { addTripEssential, removeTripEssential, updateTripEssential, type TripEssential } from "@/lib/essentials.functions";
import { addTripActivity, removeTripActivity, type TripActivity } from "@/lib/trip-activities.functions";
import { addTripPackingItem, removeTripPackingItem, updateTripPackingItem, type TripPackingItem } from "@/lib/trip-packing.functions";
import { generateTripCapsule } from "@/lib/trip-capsule.functions";
import { listLocations } from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { resolveWardrobeUrls, thumbSrc } from "@/lib/wardrobe-image";
import { useAuth } from "@/hooks/use-auth";
import { OCCASIONS } from "./Planner";
import { matchCulturalDressNotes } from "@/lib/cultural-dress-notes";
import i18n from "@/i18n/config";
import type { BuilderInit } from "../AuraApp";


const TYPE_ICON: Record<TripType, typeof Briefcase> = { work: Briefcase, leisure: Palmtree, mixed: Shuffle };

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" });
}

type OutfitPlan = { id: string; date: string; day_segment: string | null; item_ids: string[]; occasion: string | null; trip_activity_id: string | null; weather_temp: number | null; weather_condition: string | null; weather_estimated: boolean | null };

export function TripDetail({ go, tripId, focusActivityId = null, openBuilder }: {
  go: (s: Screen) => void;
  tripId: string;
  /** Set when arriving from a weather_change notification: that activity's
   *  card is scrolled to and shows the proposal inline. */
  focusActivityId?: string | null;
  /** Opens the outfit canvas editor, pre-loaded with a trip outfit's
   *  pieces — from there it can be saved and, from the saved outfit,
   *  shared with friends or exported for social, same as any other
   *  saved outfit. Trip outfits never had this before: item thumbnails
   *  only, no way to turn one into an actual shareable image. */
  openBuilder: (init: BuilderInit) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [destinations, setDestinations] = useState<TripDestination[]>([]);
  const [sourceLocationIds, setSourceLocationIds] = useState<string[]>([]);
  const [allLocations, setAllLocations] = useState<WardrobeLocation[]>([]);
  const [essentials, setEssentials] = useState<TripEssential[]>([]);
  const [activities, setActivities] = useState<TripActivity[]>([]);
  const [packingItems, setPackingItems] = useState<TripPackingItem[]>([]);
  const [outfitPlans, setOutfitPlans] = useState<OutfitPlan[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ generated: number; failed: { date: string; daySegment: string; reason: string }[]; unclassifiedExcluded: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingEssential, setAddingEssential] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [addingActivity, setAddingActivity] = useState(false);
  const [duplicatingActivity, setDuplicatingActivity] = useState<TripActivity | null>(null);
  const [actDate, setActDate] = useState("");
  const [actType, setActType] = useState("");
  const [actSegment, setActSegment] = useState<DaySegment>("day");
  const [actDressCode, setActDressCode] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wardrobeItems, setWardrobeItems] = useState<WardrobeItem[]>([]);
  const [wardrobeSigned, setWardrobeSigned] = useState<Record<string, string>>({});
  const [wardrobeLoading, setWardrobeLoading] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [dismissedNotes, setDismissedNotes] = useState<string[]>([]);
  // Manual editing of a single activity's outfit — each trip plan is its
  // own row keyed on trip_activity_id, so these never touch neighbours.
  const [editingPlan, setEditingPlan] = useState<OutfitPlan | null>(null);
  const [editItemIds, setEditItemIds] = useState<string[]>([]);
  const [savingPlan, setSavingPlan] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // Open weather proposals for this trip's plans, keyed by activity.
  const [proposals, setProposals] = useState<WeatherProposal[]>([]);
  const loadProposals = useServerFn(listOpenWeatherProposals);
  const resolveProposal = useServerFn(resolveWeatherProposal);
  const refreshProposals = useCallback(() => {
    loadProposals()
      .then((r) => setProposals((r ?? []) as WeatherProposal[]))
      .catch((e) => console.error("[AURA trip] proposals load failed", e));
  }, [loadProposals]);
  useEffect(() => { refreshProposals(); }, [refreshProposals]);

  const culturalNotes = useMemo(() => matchCulturalDressNotes(destinations.map((d) => d.destination_name)), [destinations]);
  const visibleCulturalNotes = culturalNotes.filter((n) => !dismissedNotes.includes(n.countryKeywords[0]));

  // Scroll the notification's activity into view once its card is mounted.
  useEffect(() => {
    if (!focusActivityId || loading) return;
    const el = document.getElementById(`trip-activity-${focusActivityId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusActivityId, loading, activities.length]);



  const load = () => {
    Promise.all([getTrip({ data: { tripId } }), listLocations()])
      .then(async ([tripRes, locRes]) => {
        setTrip(tripRes.trip);
        setDestinations(tripRes.destinations);
        setSourceLocationIds(tripRes.sourceLocationIds);
        setEssentials(tripRes.essentials as TripEssential[]);
        setActivities(tripRes.activities as TripActivity[]);
        setPackingItems(tripRes.packingItems as TripPackingItem[]);
        setOutfitPlans(tripRes.outfitPlans as OutfitPlan[]);
        setAllLocations(locRes.locations);

        // Loaded eagerly (not lazily on picker-open) — packing items or
        // generated outfits can reference wardrobe pieces before the
        // picker's ever been opened, and both need real thumbnails.
        if (user) {
          const { data: wItems, error } = await supabase
            .from("wardrobe_items").select("*").eq("user_id", user.id).eq("archived", false)
            .order("created_at", { ascending: false });
          if (!error) {
            const list = (wItems ?? []) as WardrobeItem[];
            setWardrobeItems(list);
            setWardrobeSigned(await resolveWardrobeUrls(list));
          }
        }
      })
      .catch((e) => { console.error("[AURA trip-detail] load failed", e); toast.error(t("tripDetail.couldntLoadTrip")); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [tripId]);

  const locationName = (id: string) => allLocations.find((l) => l.id === id)?.name ?? t("tripDetail.unknown");

  const toggleEssentialStatus = async (item: TripEssential) => {
    const nextStatus = item.status === "packed" ? "to_pack" : "packed";
    setEssentials((prev) => prev.map((e) => (e.id === item.id ? { ...e, status: nextStatus } : e)));
    try {
      await updateTripEssential({ data: { id: item.id, status: nextStatus } });
    } catch (e) {
      console.error("[AURA trip-detail] status update failed", e);
      setEssentials((prev) => prev.map((x) => (x.id === item.id ? item : x))); // revert
    }
  };

  const addEssential = async () => {
    if (!newName.trim() || !trip) return;
    try {
      const res = await addTripEssential({ data: { tripId: trip.id, name: newName.trim(), category: newCategory.trim() || null, quantity: 1 } });
      setEssentials((prev) => [...prev, res.item]);
      setNewName(""); setNewCategory(""); setAddingEssential(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntAddItem"));
    }
  };

  const removeEssential = async (id: string) => {
    setEssentials((prev) => prev.filter((e) => e.id !== id));
    try {
      await removeTripEssential({ data: { id } });
    } catch (e) {
      console.error("[AURA trip-detail] remove failed", e);
      load();
    }
  };

  const doDeleteTrip = async () => {
    if (!trip) return;
    try {
      await deleteTrip({ data: { tripId: trip.id } });
      toast.success(t("tripDetail.toastTripDeleted"));
      go("trips");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntDeleteTrip"));
    }
  };

  const addActivity = async () => {
    if (!actType.trim() || !actDate || !trip) return;
    try {
      const res = await addTripActivity({
        data: {
          tripId: trip.id,
          activityDate: actDate,
          activityType: actType.trim(),
          daySegment: actSegment,
          dressCode: actDressCode || null,
        },
      });
      setActivities((prev) => [...prev, res.activity].sort((a, b) => a.activity_date.localeCompare(b.activity_date)));
      setActType(""); setActDressCode(""); setActSegment("day"); setActDate(""); setAddingActivity(false); setDuplicatingActivity(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntAddActivity"));
    }
  };

  const startDuplicateActivity = (activity: TripActivity) => {
    setDuplicatingActivity(activity);
    setActDate(activity.activity_date);
    setActType(activity.activity_type);
    setActSegment(activity.day_segment ?? "day");
    setActDressCode(activity.dress_code ?? "");
    setAddingActivity(true);
  };

  const cancelActivityForm = () => {
    setAddingActivity(false);
    setDuplicatingActivity(null);
    setActType(""); setActDressCode(""); setActSegment("day"); setActDate("");
  };

  const removeActivity = async (id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
    try {
      await removeTripActivity({ data: { id } });
    } catch (e) {
      console.error("[AURA trip-detail] activity remove failed", e);
      load();
    }
  };

  const openPicker = async () => {
    setPickerOpen(true);
    if (wardrobeItems.length || !user) return; // already loaded this session
    setWardrobeLoading(true);
    try {
      const { data, error } = await supabase
        .from("wardrobe_items").select("*").eq("user_id", user.id).eq("archived", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = (data ?? []) as WardrobeItem[];
      setWardrobeItems(list);
      setWardrobeSigned(await resolveWardrobeUrls(list));
    } catch (e) {
      console.error("[AURA trip-detail] wardrobe load failed", e);
      toast.error(t("tripDetail.couldntLoadWardrobe"));
    } finally {
      setWardrobeLoading(false);
    }
  };

  const packedItemIds = new Set(packingItems.map((p) => p.item_id));

  const togglePackingItem = async (itemId: string) => {
    if (!trip || pendingItemId) return;
    const existing = packingItems.find((p) => p.item_id === itemId);
    setPendingItemId(itemId);
    try {
      if (existing) {
        setPackingItems((prev) => prev.filter((p) => p.id !== existing.id));
        await removeTripPackingItem({ data: { id: existing.id } });
      } else {
        const res = await addTripPackingItem({ data: { tripId: trip.id, itemId } });
        setPackingItems((prev) => [...prev, res.item]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntUpdatePackingList"));
      load(); // resync on failure rather than trust the optimistic state
    } finally {
      setPendingItemId(null);
    }
  };

  const togglePackedStatus = async (p: TripPackingItem) => {
    const nextStatus = p.status === "packed" ? "to_pack" : "packed";
    setPackingItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: nextStatus } : x)));
    try {
      await updateTripPackingItem({ data: { id: p.id, status: nextStatus } });
    } catch (e) {
      console.error("[AURA trip-detail] packing status update failed", e);
      setPackingItems((prev) => prev.map((x) => (x.id === p.id ? p : x))); // revert
    }
  };

  const generateCapsule = async () => {
    if (!trip || generating) return;
    setGenerating(true);
    setGenResult(null);
    try {
      const res = await generateTripCapsule({ data: { tripId: trip.id } });
      setGenResult({ generated: res.generated, failed: res.failed, unclassifiedExcluded: res.unclassifiedExcluded });
      if (res.generated > 0) toast.success(t("tripDetail.outfitsGenerated", { count: res.generated }));
      else if (res.failed.length === 0 && res.skippedExisting > 0) toast.message(t("tripDetail.everythingHasOutfit"));
      else if (res.failed.length === 0) toast.message(t("tripDetail.logActivityFirst"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntGenerateOutfits"));
    } finally {
      setGenerating(false);
    }
  };

  /** Regenerates just this activity's look — the wardrobe pool is read
   *  live server-side, so a piece added today is immediately eligible. */
  const regenerateActivity = async (activityId: string) => {
    if (!trip || regeneratingId) return;
    setRegeneratingId(activityId);
    try {
      const res = await generateTripCapsule({ data: { tripId: trip.id, activityIds: [activityId] } });
      if (res.generated > 0) toast.success(t("tripDetail.outfitRegenerated"));
      else toast.error(res.failed[0]?.reason ?? t("tripDetail.couldntComposeLook"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntRegenerateOutfit"));
    } finally {
      setRegeneratingId(null);
      setRegeneratingId(null);
    }
  };

  const startEditPlan = (plan: OutfitPlan) => {
    setEditingPlan(plan);
    setEditItemIds(plan.item_ids);
  };

  const saveEditPlan = async () => {
    if (!editingPlan || savingPlan) return;
    if (!editItemIds.length) { toast.error(t("tripDetail.pickAtLeastOnePiece")); return; }
    setSavingPlan(true);
    try {
      await updateTripOutfitPlanItems({ data: { planId: editingPlan.id, itemIds: editItemIds } });
      setOutfitPlans((prev) => prev.map((p) => (p.id === editingPlan.id ? { ...p, item_ids: editItemIds } : p)));
      // A hand-picked answer closes any open weather proposal for this plan.
      const open = proposals.find((pr) => pr.data?.plan_id === editingPlan.id);
      if (open) {
        try { await resolveProposal({ data: { notificationId: open.id, status: "dismissed" } }); refreshProposals(); }
        catch (e) { console.error("[AURA trip] proposal resolve failed", e); }
      }
      setEditingPlan(null);
      toast.success(t("tripDetail.toastOutfitUpdated"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntUpdateOutfit"));
    } finally {
      setSavingPlan(false);
    }
  };

  const removePlan = async (planId: string) => {
    setOutfitPlans((prev) => prev.filter((p) => p.id !== planId));
    try {
      await deleteTripOutfitPlan({ data: { planId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntDeleteOutfit"));
      load();
    }
  };


  if (loading) {
    return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  }
  if (!trip) return null;

  const Icon = TYPE_ICON[trip.trip_type];
  const packedCount = essentials.filter((e) => e.status === "packed").length;

  const essentialsByCategory = new Map<string, TripEssential[]>();
  essentials.forEach((e) => {
    const key = e.category || "Other";
    const arr = essentialsByCategory.get(key) ?? [];
    arr.push(e);
    essentialsByCategory.set(key, arr);
  });

  // Bounds the date picker to the trip's actual span — no point letting
  // someone log an activity for a day they won't be traveling.
  const minDate = destinations.length ? destinations.map((d) => d.start_date).sort()[0] : undefined;
  const maxDate = destinations.length ? destinations.map((d) => d.end_date).sort().slice(-1)[0] : undefined;

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => go("trips")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90 shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-1.5"><Icon size={11} /> {trip.trip_type}</p>
            <h1 className="font-serif text-2xl mt-1 truncate">{trip.name || t("tripDetail.untitledTrip")}</h1>
          </div>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          aria-label={t("tripDetail.deleteTripAria")}
          className="h-10 w-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center active:scale-90 shrink-0"
        ><Trash2 size={15} /></button>
      </header>

      <div className="px-6 mt-4 rounded-2xl border border-border/60 bg-card p-4 space-y-2">
        {destinations.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-sm">
            <span className="font-serif text-lg">{d.destination_name}</span>
            <span className="text-[11px] text-muted-foreground">{fmtDate(d.start_date)} – {fmtDate(d.end_date)}</span>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {sourceLocationIds.length > 0 ? sourceLocationIds.map((id) => (
            <span key={id} className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] uppercase tracking-widest">{locationName(id)}</span>
          )) : (
            <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] uppercase tracking-widest">{t("tripDetail.wholeWardrobe")}</span>
          )}
          <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] uppercase tracking-widest">
            {trip.laundry_available ? t("tripDetail.laundryAvailable") : t("tripDetail.noLaundry")}
          </span>
        </div>
      </div>

      <section className="px-6 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl italic">{t("tripDetail.essentials")}</h2>
          {essentials.length > 0 && <p className="text-[11px] text-muted-foreground">{t("tripDetail.packedCount", { packed: packedCount, total: essentials.length })}</p>}
        </div>

        {essentials.length === 0 && !addingEssential && (
          <p className="text-sm text-muted-foreground mb-3">{t("tripDetail.noEssentialsYet")}</p>
        )}

        <div className="space-y-4">
          {Array.from(essentialsByCategory.entries()).map(([category, items]) => (
            <div key={category}>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1.5">{category}</p>
              <div className="space-y-1.5">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-xl bg-secondary/40 px-3 py-2.5">
                    <button
                      onClick={() => void toggleEssentialStatus(item)}
                      className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${item.status === "packed" ? "bg-foreground border-foreground" : "border-border"}`}
                    >{item.status === "packed" && <Check size={11} className="text-background" />}</button>
                    <span className={`flex-1 text-sm ${item.status === "packed" ? "line-through text-muted-foreground" : ""}`}>
                      {item.name} ×{item.quantity}
                    </span>
                    <button onClick={() => void removeEssential(item.id)} aria-label={t("tripDetail.removeItemAria", { name: item.name })} className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-muted-foreground">
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {addingEssential ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t("tripDetail.categoryOptional")}
                className="w-28 bg-secondary/60 rounded-full px-3 py-2.5 text-xs outline-none placeholder:text-muted-foreground"
              />
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addEssential()}
                placeholder={t("tripDetail.itemName")}
                className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAddingEssential(false)} className="flex-1 h-10 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">{t("tripDetail.cancel")}</button>
              <button onClick={() => void addEssential()} className="flex-1 h-10 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]">{t("tripDetail.add")}</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingEssential(true)}
            className="mt-3 w-full h-11 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center justify-center gap-2"
          ><Plus size={13} /> {t("tripDetail.addItem")}</button>
        )}
      </section>

      <section className="px-6 mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl italic flex items-center gap-1.5"><Luggage size={16} /> {t("tripDetail.itemsToPack")}</h2>
          {packingItems.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("tripDetail.packedCount", { packed: packingItems.filter((p) => p.status === "packed").length, total: packingItems.length })}
            </p>
          )}
        </div>

        {packingItems.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">
            {t("tripDetail.addRealPiecesHint")}
          </p>
        )}

        {packingItems.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {packingItems.map((p) => {
              const it = wardrobeItems.find((w) => w.id === p.item_id);
              const src = it ? thumbSrc(it, wardrobeSigned) : "";
              return (
                <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden" style={{ background: "#FFFFFF" }}>
                  <button onClick={() => void togglePackedStatus(p)} className="h-full w-full">
                    {src ? <img src={src} className={`h-full w-full object-contain p-1.5 ${p.status === "packed" ? "opacity-40" : ""}`} alt="" loading="lazy" /> : null}
                  </button>
                  {p.status === "packed" && (
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center"><Check size={13} /></span>
                    </span>
                  )}
                  <button
                    onClick={() => void togglePackingItem(p.item_id)}
                    aria-label={t("tripDetail.removeFromPackingAria")}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/90 border border-border/60 flex items-center justify-center"
                  ><X size={11} /></button>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={() => void openPicker()}
          className="w-full h-11 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center justify-center gap-2"
        ><Plus size={13} /> {t("tripDetail.addFromWardrobe")}</button>
      </section>

      {(() => {
        const UNDERWEAR_GROUPS: { label: string; subcats: string[] }[] = [
          { label: t("tripDetail.bras"), subcats: ["Bra", "Sports Bra"] },
          { label: t("tripDetail.underwear"), subcats: ["Briefs", "Panties", "Boxers"] },
          { label: t("tripDetail.socks"), subcats: ["Socks", "Tights"] },
          { label: t("tripDetail.sleepwear"), subcats: ["Sleepwear"] },
          { label: t("tripDetail.shapewear"), subcats: ["Shapewear"] },
        ];
        const underwearPacking = packingItems.filter((p) => {
          const it = wardrobeItems.find((w) => w.id === p.item_id);
          return it?.category === "Underwear";
        });
        if (!underwearPacking.length) return null;
        const groups = UNDERWEAR_GROUPS.map((g) => ({
          ...g,
          rows: underwearPacking.filter((p) => {
            const it = wardrobeItems.find((w) => w.id === p.item_id);
            return it?.subcategory && g.subcats.includes(it.subcategory);
          }),
        })).filter((g) => g.rows.length > 0);
        if (!groups.length) return null;

        return (
          <section className="px-6 mt-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-xl italic">{t("tripDetail.underwear")}</h2>
              <p className="text-[11px] text-muted-foreground">
                {t("tripDetail.packedCount", { packed: underwearPacking.filter((p) => p.status === "packed").length, total: underwearPacking.length })}
              </p>
            </div>
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1.5">{g.label} · {g.rows.length}</p>
                  <div className="grid grid-cols-4 gap-2">
                    {g.rows.map((p) => {
                      const it = wardrobeItems.find((w) => w.id === p.item_id);
                      const src = it ? thumbSrc(it, wardrobeSigned) : "";
                      return (
                        <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden" style={{ background: "#FFFFFF" }}>
                          <button onClick={() => void togglePackedStatus(p)} className="h-full w-full">
                            {src ? <img src={src} className={`h-full w-full object-contain p-1.5 ${p.status === "packed" ? "opacity-40" : ""}`} alt="" loading="lazy" /> : null}
                          </button>
                          {p.status === "packed" && (
                            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <span className="h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center"><Check size={13} /></span>
                            </span>
                          )}
                          <button
                            onClick={() => void togglePackingItem(p.item_id)}
                            aria-label={t("tripDetail.removeFromPackingAria")}
                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/90 border border-border/60 flex items-center justify-center"
                          ><X size={11} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 pt-14">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("tripDetail.yourWardrobe")}</p>
              <p className="font-serif text-xl">{t("tripDetail.tapToAddOrRemove")}</p>
            </div>
            <button onClick={() => setPickerOpen(false)} className="h-9 w-9 rounded-full border border-border flex items-center justify-center"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4">
            {wardrobeLoading ? (
              <div className="flex justify-center mt-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : wardrobeItems.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-8 text-center">{t("tripDetail.noPiecesYet")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {wardrobeItems.map((it) => {
                  const src = thumbSrc(it, wardrobeSigned);
                  const added = packedItemIds.has(it.id);
                  return (
                    <button
                      key={it.id}
                      onClick={() => void togglePackingItem(it.id)}
                      disabled={pendingItemId === it.id}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition ${added ? "border-foreground" : "border-transparent"}`}
                      style={{ background: "#FFFFFF" }}
                    >
                      {src ? <img src={src} className="h-full w-full object-contain p-1.5" alt="" loading="lazy" /> : null}
                      {added && <span className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground text-background text-[10px] flex items-center justify-center">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
      setRegeneratingId(null);
    }
  };

  const startEditPlan = (plan: OutfitPlan) => {
    setEditingPlan(plan);
    setEditItemIds(plan.item_ids);
  };

  const saveEditPlan = async () => {
    if (!editingPlan || savingPlan) return;
    if (!editItemIds.length) { toast.error(t("tripDetail.pickAtLeastOnePiece")); return; }
    setSavingPlan(true);
    try {
      await updateTripOutfitPlanItems({ data: { planId: editingPlan.id, itemIds: editItemIds } });
      setOutfitPlans((prev) => prev.map((p) => (p.id === editingPlan.id ? { ...p, item_ids: editItemIds } : p)));
      // A hand-picked answer closes any open weather proposal for this plan.
      const open = proposals.find((pr) => pr.data?.plan_id === editingPlan.id);
      if (open) {
        try { await resolveProposal({ data: { notificationId: open.id, status: "dismissed" } }); refreshProposals(); }
        catch (e) { console.error("[AURA trip] proposal resolve failed", e); }
      }
      setEditingPlan(null);
      toast.success(t("tripDetail.toastOutfitUpdated"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntUpdateOutfit"));
    } finally {
      setSavingPlan(false);
    }
  };

  const removePlan = async (planId: string) => {
    setOutfitPlans((prev) => prev.filter((p) => p.id !== planId));
    try {
      await deleteTripOutfitPlan({ data: { planId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tripDetail.couldntDeleteOutfit"));
      load();
    }
  };


  if (loading) {
    return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  }
  if (!trip) return null;

  const Icon = TYPE_ICON[trip.trip_type];
  const packedCount = essentials.filter((e) => e.status === "packed").length;

  const essentialsByCategory = new Map<string, TripEssential[]>();
  essentials.forEach((e) => {
    const key = e.category || "Other";
    const arr = essentialsByCategory.get(key) ?? [];
    arr.push(e);
    essentialsByCategory.set(key, arr);
  });

  // Bounds the date picker to the trip's actual span — no point letting
  // someone log an activity for a day they won't be traveling.
  const minDate = destinations.length ? destinations.map((d) => d.start_date).sort()[0] : undefined;
  const maxDate = destinations.length ? destinations.map((d) => d.end_date).sort().slice(-1)[0] : undefined;

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => go("trips")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90 shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-1.5"><Icon size={11} /> {trip.trip_type}</p>
            <h1 className="font-serif text-2xl mt-1 truncate">{trip.name || t("tripDetail.untitledTrip")}</h1>
          </div>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          aria-label={t("tripDetail.deleteTripAria")}
          className="h-10 w-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center active:scale-90 shrink-0"
        ><Trash2 size={15} /></button>
      </header>

      <div className="px-6 mt-4 rounded-2xl border border-border/60 bg-card p-4 space-y-2">
        {destinations.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-sm">
            <span className="font-serif text-lg">{d.destination_name}</span>
            <span className="text-[11px] text-muted-foreground">{fmtDate(d.start_date)} – {fmtDate(d.end_date)}</span>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {sourceLocationIds.length > 0 ? sourceLocationIds.map((id) => (
            <span key={id} className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] uppercase tracking-widest">{locationName(id)}</span>
          )) : (
            <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] uppercase tracking-widest">{t("tripDetail.wholeWardrobe")}</span>
          )}
          <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] uppercase tracking-widest">
            {trip.laundry_available ? t("tripDetail.laundryAvailable") : t("tripDetail.noLaundry")}
          </span>
        </div>
      </div>

      <section className="px-6 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl italic">{t("tripDetail.essentials")}</h2>
          {essentials.length > 0 && <p className="text-[11px] text-muted-foreground">{t("tripDetail.packedCount", { packed: packedCount, total: essentials.length })}</p>}
        </div>

        {essentials.length === 0 && !addingEssential && (
          <p className="text-sm text-muted-foreground mb-3">{t("tripDetail.noEssentialsYet")}</p>
        )}

        <div className="space-y-4">
          {Array.from(essentialsByCategory.entries()).map(([category, items]) => (
            <div key={category}>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1.5">{category}</p>
              <div className="space-y-1.5">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-xl bg-secondary/40 px-3 py-2.5">
                    <button
                      onClick={() => void toggleEssentialStatus(item)}
                      className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${item.status === "packed" ? "bg-foreground border-foreground" : "border-border"}`}
                    >{item.status === "packed" && <Check size={11} className="text-background" />}</button>
                    <span className={`flex-1 text-sm ${item.status === "packed" ? "line-through text-muted-foreground" : ""}`}>
                      {item.name} ×{item.quantity}
                    </span>
                    <button onClick={() => void removeEssential(item.id)} aria-label={t("tripDetail.removeItemAria", { name: item.name })} className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-muted-foreground">
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {addingEssential ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t("tripDetail.categoryOptional")}
                className="w-28 bg-secondary/60 rounded-full px-3 py-2.5 text-xs outline-none placeholder:text-muted-foreground"
              />
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addEssential()}
                placeholder={t("tripDetail.itemName")}
                className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAddingEssential(false)} className="flex-1 h-10 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">{t("tripDetail.cancel")}</button>
              <button onClick={() => void addEssential()} className="flex-1 h-10 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]">{t("tripDetail.add")}</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingEssential(true)}
            className="mt-3 w-full h-11 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center justify-center gap-2"
          ><Plus size={13} /> {t("tripDetail.addItem")}</button>
        )}
      </section>

      <section className="px-6 mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl italic flex items-center gap-1.5"><Luggage size={16} /> {t("tripDetail.itemsToPack")}</h2>
          {packingItems.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("tripDetail.packedCount", { packed: packingItems.filter((p) => p.status === "packed").length, total: packingItems.length })}
            </p>
          )}
        </div>

        {packingItems.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">
            {t("tripDetail.addRealPiecesHint")}
          </p>
        )}

        {packingItems.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {packingItems.map((p) => {
              const it = wardrobeItems.find((w) => w.id === p.item_id);
              const src = it ? thumbSrc(it, wardrobeSigned) : "";
              return (
                <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden" style={{ background: "#FFFFFF" }}>
                  <button onClick={() => void togglePackedStatus(p)} className="h-full w-full">
                    {src ? <img src={src} className={`h-full w-full object-contain p-1.5 ${p.status === "packed" ? "opacity-40" : ""}`} alt="" loading="lazy" /> : null}
                  </button>
                  {p.status === "packed" && (
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center"><Check size={13} /></span>
                    </span>
                  )}
                  <button
                    onClick={() => void togglePackingItem(p.item_id)}
                    aria-label={t("tripDetail.removeFromPackingAria")}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/90 border border-border/60 flex items-center justify-center"
                  ><X size={11} /></button>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={() => void openPicker()}
          className="w-full h-11 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center justify-center gap-2"
        ><Plus size={13} /> {t("tripDetail.addFromWardrobe")}</button>
      </section>

      {(() => {
        const UNDERWEAR_GROUPS: { label: string; subcats: string[] }[] = [
          { label: t("tripDetail.bras"), subcats: ["Bra", "Sports Bra"] },
          { label: t("tripDetail.underwear"), subcats: ["Briefs", "Panties", "Boxers"] },
          { label: t("tripDetail.socks"), subcats: ["Socks", "Tights"] },
          { label: t("tripDetail.sleepwear"), subcats: ["Sleepwear"] },
          { label: t("tripDetail.shapewear"), subcats: ["Shapewear"] },
        ];
        const underwearPacking = packingItems.filter((p) => {
          const it = wardrobeItems.find((w) => w.id === p.item_id);
          return it?.category === "Underwear";
        });
        if (!underwearPacking.length) return null;
        const groups = UNDERWEAR_GROUPS.map((g) => ({
          ...g,
          rows: underwearPacking.filter((p) => {
            const it = wardrobeItems.find((w) => w.id === p.item_id);
            return it?.subcategory && g.subcats.includes(it.subcategory);
          }),
        })).filter((g) => g.rows.length > 0);
        if (!groups.length) return null;

        return (
          <section className="px-6 mt-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-xl italic">{t("tripDetail.underwear")}</h2>
              <p className="text-[11px] text-muted-foreground">
                {t("tripDetail.packedCount", { packed: underwearPacking.filter((p) => p.status === "packed").length, total: underwearPacking.length })}
              </p>
            </div>
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1.5">{g.label} · {g.rows.length}</p>
                  <div className="grid grid-cols-4 gap-2">
                    {g.rows.map((p) => {
                      const it = wardrobeItems.find((w) => w.id === p.item_id);
                      const src = it ? thumbSrc(it, wardrobeSigned) : "";
                      return (
                        <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden" style={{ background: "#FFFFFF" }}>
                          <button onClick={() => void togglePackedStatus(p)} className="h-full w-full">
                            {src ? <img src={src} className={`h-full w-full object-contain p-1.5 ${p.status === "packed" ? "opacity-40" : ""}`} alt="" loading="lazy" /> : null}
                          </button>
                          {p.status === "packed" && (
                            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <span className="h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center"><Check size={13} /></span>
                            </span>
                          )}
                          <button
                            onClick={() => void togglePackingItem(p.item_id)}
                            aria-label={t("tripDetail.removeFromPackingAria")}
                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/90 border border-border/60 flex items-center justify-center"
                          ><X size={11} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 pt-14">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("tripDetail.yourWardrobe")}</p>
              <p className="font-serif text-xl">{t("tripDetail.tapToAddOrRemove")}</p>
            </div>
            <button onClick={() => setPickerOpen(false)} className="h-9 w-9 rounded-full border border-border flex items-center justify-center"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4">
            {wardrobeLoading ? (
              <div className="flex justify-center mt-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : wardrobeItems.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-8 text-center">{t("tripDetail.noPiecesYet")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {wardrobeItems.map((it) => {
                  const src = thumbSrc(it, wardrobeSigned);
                  const added = packedItemIds.has(it.id);
                  return (
                    <button
                      key={it.id}
                      onClick={() => void togglePackingItem(it.id)}
                      disabled={pendingItemId === it.id}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition ${added ? "border-foreground" : "border-transparent"}`}
                      style={{ background: "#FFFFFF" }}
                    >
                      {src ? <img src={src} className="h-full w-full object-contain p-1.5" alt="" loading="lazy" /> : null}
                      {added && <span className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground text-background text-[10px] flex items-center justify-center">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
