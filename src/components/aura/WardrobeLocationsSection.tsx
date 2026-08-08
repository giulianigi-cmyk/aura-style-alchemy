import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, Plus, Check, Pencil, Loader2, X, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import {
  listLocations, createLocation, renameLocation, setActiveLocation, deleteLocation, resolveLocationExpiry,
} from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Most people will only ever have one wardrobe location and should
 * never really need to think about this section — it stays a single
 * quiet line until a second location exists. Only once there's a real
 * choice to make does it expand into something worth their attention.
 *
 * A location's "until" date is entirely optional — most locations
 * (a main home, a place you own) are permanent and never get one. It's
 * only useful for something genuinely temporary, like a summer rental.
 * Reaching that date NEVER moves anything by itself — it only surfaces
 * a confirmation banner; the person always taps to confirm.
 */
export function WardrobeLocationsSection() {
  const list = useServerFn(listLocations);
  const create = useServerFn(createLocation);
  const rename = useServerFn(renameLocation);
  const setActive = useServerFn(setActiveLocation);
  const remove = useServerFn(deleteLocation);
  const resolveExpiry = useServerFn(resolveLocationExpiry);

  const [locations, setLocations] = useState<WardrobeLocation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dismissedExpiry, setDismissedExpiry] = useState<Set<string>>(new Set());

  const load = async () => {
    try {
      const res = await list();
      setLocations(res.locations);
      setActiveId(res.activeLocationId);
    } catch (e) {
      console.error("[AURA locations] load failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const addLocation = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await create({ data: { name: newName.trim(), isPrimary: locations.length === 0, endDate: newEndDate || null } });
      setNewName("");
      setNewEndDate("");
      setAdding(false);
      await load();
      toast.success("Location added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add location");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) { setEditingId(null); return; }
    setBusy(true);
    try {
      await rename({ data: { id, name: editName.trim(), endDate: editEndDate || null } });
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const chooseActive = async (id: string) => {
    setBusy(true);
    try {
      await setActive({ data: { id } });
      setActiveId(id);
      toast.success("AURA will now only suggest what's here");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't switch location");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (id: string) => {
    setBusy(true);
    try {
      await remove({ data: { id } });
      setConfirmDeleteId(null);
      await load();
      toast.success("Location removed — its pieces are still in your closet, just unassigned");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove location");
    } finally {
      setBusy(false);
    }
  };

  const confirmExpiry = async (loc: WardrobeLocation) => {
    setBusy(true);
    try {
      await resolveExpiry({ data: { id: loc.id } });
      toast.success(`Moved everything from ${loc.name} back to your main wardrobe`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't move pieces back");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  const today = todayIso();
  const expired = locations.filter((l) => l.end_date && l.end_date <= today && !dismissedExpiry.has(l.id));

  return (
    <section className="mx-6 mt-4 animate-fade-up">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Wardrobe locations</p>
        {busy && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
      </div>

      {expired.map((loc) => (
        <div key={loc.id} className="mb-2 rounded-2xl border border-foreground/20 bg-secondary/40 p-3">
          <p className="text-xs flex items-center gap-1.5"><CalendarClock size={13} /> <span className="font-medium">{loc.name}</span>'s period has ended.</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Move everything back to your main wardrobe?</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void confirmExpiry(loc)}
              className="flex-1 h-9 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em]"
            >Move back</button>
            <button
              onClick={() => setDismissedExpiry((prev) => new Set(prev).add(loc.id))}
              className="h-9 px-4 rounded-full border border-border text-[10px] uppercase tracking-[0.2em]"
            >Not now</button>
          </div>
        </div>
      ))}

      {locations.length === 0 && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 text-xs text-muted-foreground italic"
        >
          <MapPin size={13} /> Keep clothes in more than one place? Add a location.
        </button>
      )}

      {locations.length > 0 && (
        <div className="space-y-1.5">
          {locations.map((loc) => {
            const isActive = activeId === loc.id;
            return (
              <div key={loc.id} className="rounded-2xl border border-border/60 bg-card px-3 py-2.5">
                {editingId === loc.id ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-transparent text-sm outline-none border-b border-border pb-1"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">Until (optional)</span>
                      <input
                        type="date"
                        value={editEndDate}
                        onChange={(e) => setEditEndDate(e.target.value)}
                        className="flex-1 bg-secondary/60 rounded-full px-3 py-1.5 text-xs outline-none"
                      />
                      {editEndDate && (
                        <button onClick={() => setEditEndDate("")} aria-label="Clear end date" className="text-muted-foreground active:scale-90"><X size={13} /></button>
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="h-8 px-3 rounded-full border border-border text-[10px] uppercase tracking-[0.2em]">Cancel</button>
                      <button onClick={() => saveEdit(loc.id)} className="h-8 px-3 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em]">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => !isActive && chooseActive(loc.id)}
                      className="flex-1 flex items-center gap-2 text-left min-w-0"
                    >
                      <span className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${isActive ? "bg-foreground border-foreground" : "border-border"}`}>
                        {isActive && <Check size={10} className="text-background" />}
                      </span>
                      <span className="min-w-0">
                        <span className="text-sm block truncate">{loc.name}</span>
                        {loc.is_primary && <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Primary</span>}
                        {loc.end_date && !loc.is_primary && (
                          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                            Until {new Date(`${loc.end_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      onClick={() => { setEditingId(loc.id); setEditName(loc.name); setEditEndDate(loc.end_date ?? ""); }}
                      aria-label={`Edit ${loc.name}`}
                      className="h-7 w-7 rounded-full bg-secondary/60 flex items-center justify-center shrink-0 active:scale-90"
                    ><Pencil size={11} /></button>
                    {!loc.is_primary && (
                      
