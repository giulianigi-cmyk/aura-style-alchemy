import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Check, Plus, X, Trash2, Briefcase, Palmtree, Shuffle, CalendarDays, Sun, Moon, Luggage, Sparkles, AlertCircle, Info } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { getTrip, deleteTrip, type Trip, type TripDestination, type TripType, type DaySegment } from "@/lib/trips.functions";
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


const TYPE_ICON: Record<TripType, typeof Briefcase> = { work: Briefcase, leisure: Palmtree, mixed: Shuffle };

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type OutfitPlan = { id: string; date: string; day_segment: string | null; item_ids: string[]; occasion: string | null };

export function TripDetail({ go, tripId }: { go: (s: Screen) => void; tripId: string }) {
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

  const culturalNotes = useMemo(() => matchCulturalDressNotes(destinations.map((d) => d.destination_name)), [destinations]);
  const visibleCulturalNotes = culturalNotes.filter((n) => !dismissedNotes.includes(n.countryKeywords[0]));


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
      .catch((e) => { console.error("[AURA trip-detail] load failed", e); toast.error("Couldn't load this trip"); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [tripId]);

  const locationName = (id: string) => allLocations.find((l) => l.id === id)?.name ?? "Unknown";

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
      toast.error(e instanceof Error ? e.message : "Couldn't add item");
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
      toast.success("Trip deleted");
      go("trips");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete trip");
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
      setActType(""); setActDressCode(""); setActSegment("day"); setAddingActivity(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add activity");
    }
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
      toast.error("Couldn't load your wardrobe");
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
      toast.error(e instanceof Error ? e.message : "Couldn't update packing list");
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
      if (res.generated > 0) toast.success(`${res.generated} outfit${res.generated === 1 ? "" : "s"} generated`);
      else if (res.failed.length === 0 && res.skippedExisting > 0) toast.message("Everything logged already has an outfit");
      else if (res.failed.length === 0) toast.message("Log an activity first — there's nothing to generate yet");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate outfits");
    } finally {
      setGenerating(false);
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
            <h1 className="font-serif text-2xl mt-1 truncate">{trip.name || "Untitled trip"}</h1>
          </div>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete trip"
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
            <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] uppercase tracking-widest">Whole wardrobe</span>
          )}
          <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] uppercase tracking-widest">
            {trip.laundry_available ? "Laundry available" : "No laundry"}
          </span>
        </div>
      </div>

      <section className="px-6 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl italic">Essentials</h2>
          {essentials.length > 0 && <p className="text-[11px] text-muted-foreground">{packedCount}/{essentials.length} packed</p>}
        </div>

        {essentials.length === 0 && !addingEssential && (
          <p className="text-sm text-muted-foreground mb-3">Nothing here yet — add items one by one, or apply a preset next time you create a trip.</p>
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
                      {item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}
                    </span>
                    <button onClick={() => void removeEssential(item.id)} aria-label={`Remove ${item.name}`} className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-muted-foreground">
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
                placeholder="Category (optional)"
                className="w-28 bg-secondary/60 rounded-full px-3 py-2.5 text-xs outline-none placeholder:text-muted-foreground"
              />
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addEssential()}
                placeholder="Item name"
                className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAddingEssential(false)} className="flex-1 h-10 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">Cancel</button>
              <button onClick={() => void addEssential()} className="flex-1 h-10 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]">Add</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingEssential(true)}
            className="mt-3 w-full h-11 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center justify-center gap-2"
          ><Plus size={13} /> Add item</button>
        )}
      </section>

      <section className="px-6 mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl italic flex items-center gap-1.5"><Luggage size={16} /> Items to pack</h2>
          {packingItems.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {packingItems.filter((p) => p.status === "packed").length}/{packingItems.length} packed
            </p>
          )}
        </div>

        {packingItems.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">
            Add real pieces from your wardrobe — this becomes your actual suitcase, with photos, not just a checklist.
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
                    aria-label="Remove from packing list"
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
        ><Plus size={13} /> Add from wardrobe</button>
      </section>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 pt-14">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Your wardrobe</p>
              <p className="font-serif text-xl">Tap to add or remove</p>
            </div>
            <button onClick={() => setPickerOpen(false)} className="h-9 w-9 rounded-full border border-border flex items-center justify-center"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4">
            {wardrobeLoading ? (
              <div className="flex justify-center mt-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : wardrobeItems.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-8 text-center">No pieces in your wardrobe yet.</p>
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
          </div>
          <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 border-t border-border/60">
            <button onClick={() => setPickerOpen(false)} className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]">Done</button>
          </div>
        </div>
      )}

      <section className="px-6 mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl italic flex items-center gap-1.5"><CalendarDays size={16} /> Activities</h2>
          {activities.length > 0 && <p className="text-[11px] text-muted-foreground">{activities.length} logged</p>}
        </div>

        {activities.length === 0 && !addingActivity && (
          <p className="text-sm text-muted-foreground mb-3">
            Log what you'll be doing each day — dinners, meetings, museum visits — so AURA can plan outfits and pack around them.
          </p>
        )}

        <div className="space-y-1.5">
          {activities.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl bg-secondary/40 px-3 py-2.5">
              {a.day_segment === "evening" ? <Moon size={13} className="text-muted-foreground shrink-0" /> : <Sun size={13} className="text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{a.activity_type}</p>
                <p className="text-[10px] text-muted-foreground">
                  {fmtDate(a.activity_date)}{a.dress_code ? ` · ${a.dress_code}` : ""}
                </p>
              </div>
              <button onClick={() => void removeActivity(a.id)} aria-label={`Remove ${a.activity_type}`} className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-muted-foreground">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>

        {addingActivity ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={actDate}
                min={minDate}
                max={maxDate}
                onChange={(e) => setActDate(e.target.value)}
                className="bg-secondary/60 rounded-full px-3 py-2.5 text-xs outline-none"
              />
              <input
                autoFocus
                value={actType}
                onChange={(e) => setActType(e.target.value)}
                placeholder="e.g. Dinner, Client meeting"
                className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex gap-1.5">
              {(["day", "evening"] as const).map((seg) => (
                <button
                  key={seg}
                  onClick={() => setActSegment(seg)}
                  className={`px-3 py-1.5 rounded-full text-[11px] capitalize flex items-center gap-1 ${actSegment === seg ? "bg-foreground text-background" : "bg-secondary/60"}`}
                >
                  {seg === "evening" ? <Moon size={11} /> : <Sun size={11} />} {seg}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {OCCASIONS.map((o) => (
                <button
                  key={o}
                  onClick={() => setActDressCode(actDressCode === o ? "" : o)}
                  className={`px-3 py-1 rounded-full text-[11px] ${actDressCode === o ? "bg-foreground text-background" : "bg-secondary/60"}`}
                >{o}</button>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setAddingActivity(false)} className="flex-1 h-10 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">Cancel</button>
              <button onClick={() => void addActivity()} disabled={!actType.trim() || !actDate} className="flex-1 h-10 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] disabled:opacity-40">Add</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setActDate(minDate ?? ""); setAddingActivity(true); }}
            className="mt-3 w-full h-11 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center justify-center gap-2"
          ><Plus size={13} /> Add activity</button>
        )}
      </section>

      <section className="px-6 mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl italic">Day-by-day outfits</h2>
          {outfitPlans.length > 0 && <p className="text-[11px] text-muted-foreground">{outfitPlans.length} generated</p>}
        </div>

        {outfitPlans.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">
            Builds a packing capsule and a look for each activity logged above — the smallest set of pieces that covers the whole trip.
          </p>
        )}

        {outfitPlans.length > 0 && (
          <div className="space-y-3 mb-3">
            {[...outfitPlans].sort((a, b) => a.date.localeCompare(b.date)).map((op) => (
              <div key={op.id} className="rounded-2xl bg-secondary/40 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  {op.day_segment === "evening" ? <Moon size={12} className="text-muted-foreground" /> : <Sun size={12} className="text-muted-foreground" />}
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDate(op.date)}{op.occasion ? ` · ${op.occasion}` : ""}
                  </p>
                </div>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                  {op.item_ids.map((id) => {
                    const it = wardrobeItems.find((w) => w.id === id);
                    const src = it ? thumbSrc(it, wardrobeSigned) : "";
                    return (
                      <div key={id} className="h-14 w-14 shrink-0 rounded-lg overflow-hidden border border-border/60" style={{ background: "#FFFFFF" }}>
                        {src ? <img src={src} className="h-full w-full object-contain p-1" alt="" loading="lazy" /> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {genResult && (genResult.failed.length > 0 || genResult.unclassifiedExcluded > 0) && (
          <div className="mb-3 rounded-2xl bg-secondary/40 p-3 space-y-1.5">
            {genResult.failed.map((f, i) => (
              <p key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {fmtDate(f.date)} ({f.daySegment}): {f.reason}
              </p>
            ))}
            {genResult.unclassifiedExcluded > 0 && (
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {genResult.unclassifiedExcluded} wardrobe piece{genResult.unclassifiedExcluded === 1 ? "" : "s"} skipped — not yet classified. Run "Update wardrobe compatibility" in Wardrobe for fuller coverage.
              </p>
            )}
          </div>
        )}

        <button
          onClick={() => void generateCapsule()}
          disabled={generating || activities.length === 0}
          className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {outfitPlans.length > 0 ? "Generate remaining" : "Generate outfits"}
        </button>
        {activities.length === 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground text-center">Log an activity above first.</p>
        )}
      </section>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center px-6" onClick={() => setConfirmDelete(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-2xl border border-destructive/40 bg-card p-5 shadow-luxe">
            <p className="font-serif text-lg text-center">Delete this trip?</p>
            <p className="text-xs text-muted-foreground text-center mt-1">This cannot be undone.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmDelete(false)} className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">Cancel</button>
              <button onClick={() => void doDeleteTrip()} className="h-11 rounded-full bg-destructive text-destructive-foreground text-[10px] uppercase tracking-[0.3em]">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
