import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Check, Plus, X, Trash2, Briefcase, Palmtree, Shuffle } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { getTrip, deleteTrip, type Trip, type TripDestination, type TripType } from "@/lib/trips.functions";
import { addTripEssential, removeTripEssential, updateTripEssential, type TripEssential } from "@/lib/essentials.functions";
import { listLocations } from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";

const TYPE_ICON: Record<TripType, typeof Briefcase> = { work: Briefcase, leisure: Palmtree, mixed: Shuffle };

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function TripDetail({ go, tripId }: { go: (s: Screen) => void; tripId: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [destinations, setDestinations] = useState<TripDestination[]>([]);
  const [sourceLocationIds, setSourceLocationIds] = useState<string[]>([]);
  const [allLocations, setAllLocations] = useState<WardrobeLocation[]>([]);
  const [essentials, setEssentials] = useState<TripEssential[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingEssential, setAddingEssential] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const load = () => {
    Promise.all([getTrip({ data: { tripId } }), listLocations()])
      .then(([tripRes, locRes]) => {
        setTrip(tripRes.trip);
        setDestinations(tripRes.destinations);
        setSourceLocationIds(tripRes.sourceLocationIds);
        setEssentials(tripRes.essentials as TripEssential[]);
        setAllLocations(locRes.locations);
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

      <section className="px-6 mt-8 rounded-2xl border border-dashed border-border/60 p-4">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Day-by-day outfits</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Coming next — AURA will suggest a day and evening look for each day of this trip, and your packing list will fill in from there automatically.
        </p>
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
