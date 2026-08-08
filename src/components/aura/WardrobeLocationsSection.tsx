import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, Plus, Check, Pencil, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  listLocations, createLocation, renameLocation, setActiveLocation, deleteLocation,
} from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";

/**
 * Most people will only ever have one wardrobe location and should
 * never really need to think about this section — it stays a single
 * quiet line until a second location exists. Only once there's a real
 * choice to make does it expand into something worth their attention.
 */
export function WardrobeLocationsSection() {
  const list = useServerFn(listLocations);
  const create = useServerFn(createLocation);
  const rename = useServerFn(renameLocation);
  const setActive = useServerFn(setActiveLocation);
  const remove = useServerFn(deleteLocation);

  const [locations, setLocations] = useState<WardrobeLocation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
      await create({ data: { name: newName.trim(), isPrimary: locations.length === 0 } });
      setNewName("");
      setAdding(false);
      await load();
      toast.success("Location added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add location");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (id: string) => {
    if (!editName.trim()) { setEditingId(null); return; }
    setBusy(true);
    try {
      await rename({ data: { id, name: editName.trim() } });
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename");
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

  if (loading) return null;

  return (
    <section className="mx-6 mt-4 animate-fade-up">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Wardrobe locations</p>
        {busy && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
      </div>

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
              <div key={loc.id} className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card px-3 py-2.5">
                {editingId === loc.id ? (
                  <>
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveRename(loc.id)}
                      className="flex-1 bg-transparent text-sm outline-none border-b border-border"
                    />
                    <button onClick={() => saveRename(loc.id)} aria-label="Save name" className="active:scale-90"><Check size={14} /></button>
                    <button onClick={() => setEditingId(null)} aria-label="Cancel" className="active:scale-90"><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => !isActive && chooseActive(loc.id)}
                      className="flex-1 flex items-center gap-2 text-left"
                    >
                      <span className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${isActive ? "bg-foreground border-foreground" : "border-border"}`}>
                        {isActive && <Check size={10} className="text-background" />}
                      </span>
                      <span className="text-sm">{loc.name}</span>
                      {loc.is_primary && <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Primary</span>}
                    </button>
                    <button
                      onClick={() => { setEditingId(loc.id); setEditName(loc.name); }}
                      aria-label={`Rename ${loc.name}`}
                      className="h-7 w-7 rounded-full bg-secondary/60 flex items-center justify-center shrink-0 active:scale-90"
                    ><Pencil size={11} /></button>
                    {!loc.is_primary && (
                      <button
                        onClick={() => setConfirmDeleteId(loc.id)}
                        aria-label={`Remove ${loc.name}`}
                        className="h-7 w-7 rounded-full bg-secondary/60 flex items-center justify-center shrink-0 active:scale-90"
                      ><X size={11} /></button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {locations.length > 0 && (
            <p className="text-[10px] text-muted-foreground px-1">
              {activeId ? "AURA suggests only pieces at your active location." : "No active location set — AURA sees your whole wardrobe."}
            </p>
          )}
        </div>
      )}

      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLocation()}
            placeholder="e.g. Beach house"
            className="flex-1 bg-secondary/60 rounded-full px-4 py-2 text-sm outline-none"
          />
          <button onClick={() => void addLocation()} className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90"><Check size={13} /></button>
          <button onClick={() => { setAdding(false); setNewName(""); }} className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"><X size={13} /></button>
        </div>
      ) : locations.length > 0 ? (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
        ><Plus size={12} /> Add another location</button>
      ) : null}

      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-center justify-center px-6"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-2xl border border-border bg-card p-5 shadow-luxe">
            <p className="font-serif text-lg text-center">Remove this location?</p>
            <p className="text-xs text-muted-foreground text-center mt-1">Its pieces stay in your closet, just no longer assigned anywhere.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmDeleteId(null)} className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]">Cancel</button>
              <button onClick={() => void doDelete(confirmDeleteId)} className="h-11 rounded-full bg-destructive text-destructive-foreground text-[10px] uppercase tracking-[0.3em]">Remove</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
