import { useEffect, useState } from "react";
import { ArrowLeft, Plus, X, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import {
  listEssentialPresets, createEssentialPreset, deleteEssentialPreset, replacePresetItems,
  type EssentialPreset, type EssentialPresetItem,
} from "@/lib/essentials.functions";

type PresetWithItems = EssentialPreset & { items: EssentialPresetItem[] };
type DraftItem = { category: string; name: string; quantity: number; alwaysInclude: boolean };

export function EssentialPresets({ go }: { go: (s: Screen) => void }) {
  const [presets, setPresets] = useState<PresetWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftItem[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [addingPreset, setAddingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");

  const load = () => {
    listEssentialPresets()
      .then((res) => setPresets(res.presets as PresetWithItems[]))
      .catch((e) => console.error("[AURA essentials] load failed", e))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openPreset = (p: PresetWithItems) => {
    setOpenId(openId === p.id ? null : p.id);
    if (!drafts[p.id]) {
      setDrafts((d) => ({
        ...d,
        [p.id]: p.items.map((it) => ({
          category: it.category ?? "", name: it.name, quantity: it.quantity, alwaysInclude: it.always_include,
        })),
      }));
    }
  };

  const addPreset = async () => {
    if (!newPresetName.trim()) return;
    try {
      await createEssentialPreset({ data: { name: newPresetName.trim(), items: [] } });
      setNewPresetName("");
      setAddingPreset(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create preset");
    }
  };

  const removePreset = async (id: string) => {
    try {
      await deleteEssentialPreset({ data: { presetId: id } });
      setPresets((prev) => prev.filter((p) => p.id !== id));
      toast.success("Preset removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove preset");
    }
  };

  const addItemToDraft = (presetId: string) => {
    if (!newItemName.trim()) return;
    setDrafts((d) => ({
      ...d,
      [presetId]: [...(d[presetId] ?? []), { category: newItemCategory.trim(), name: newItemName.trim(), quantity: 1, alwaysInclude: true }],
    }));
    setNewItemName("");
    setNewItemCategory("");
  };

  const removeItemFromDraft = (presetId: string, index: number) => {
    setDrafts((d) => ({ ...d, [presetId]: (d[presetId] ?? []).filter((_, i) => i !== index) }));
  };

  const updateDraftItem = (presetId: string, index: number, patch: Partial<DraftItem>) => {
    setDrafts((d) => ({
      ...d,
      [presetId]: (d[presetId] ?? []).map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }));
  };

  const savePreset = async (presetId: string) => {
    setSaving(presetId);
    try {
      const items = (drafts[presetId] ?? []).map((it) => ({
        category: it.category || null, name: it.name, quantity: it.quantity, alwaysInclude: it.alwaysInclude,
      }));
      await replacePresetItems({ data: { presetId, items } });
      toast.success("Saved");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center gap-3">
        <button onClick={() => go("trips")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Trip planner</p>
          <h1 className="font-serif text-3xl mt-1">My essentials</h1>
        </div>
      </header>
      <p className="px-6 mt-2 text-xs text-muted-foreground">
        Reusable lists — "Always", "Business", "Beach" — you can apply to any trip in one tap.
      </p>

      {loading ? (
        <div className="flex justify-center mt-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="px-6 mt-5 space-y-3">
          {presets.map((p) => {
            const isOpen = openId === p.id;
            const items = drafts[p.id] ?? [];
            return (
              <div key={p.id} className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                <button onClick={() => openPreset(p)} className="w-full p-4 flex items-center justify-between text-left">
                  <div>
                    <p className="font-serif text-lg">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{p.items.length} item{p.items.length === 1 ? "" : "s"}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removePreset(p.id); }}
                    aria-label={`Delete ${p.name}`}
                    className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
                  ><Trash2 size={13} /></button>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-2 border-t border-border/40 pt-3">
                    {items.map((it, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={it.name}
                          onChange={(e) => updateDraftItem(p.id, i, { name: e.target.value })}
                          className="flex-1 bg-secondary/40 rounded-full px-3 py-2 text-sm outline-none"
                        />
                        <input
                          type="number"
                          min={1}
                          value={it.quantity}
                          onChange={(e) => updateDraftItem(p.id, i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                          className="w-14 bg-secondary/40 rounded-full px-2 py-2 text-sm text-center outline-none"
                        />
                        <button onClick={() => removeItemFromDraft(p.id, i)} aria-label="Remove item" className="h-8 w-8 rounded-full bg-secondary/40 flex items-center justify-center shrink-0">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        value={newItemCategory}
                        onChange={(e) => setNewItemCategory(e.target.value)}
                        placeholder="Category (optional)"
                        className="w-28 bg-secondary/40 rounded-full px-3 py-2 text-xs outline-none placeholder:text-muted-foreground"
                      />
                      <input
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addItemToDraft(p.id)}
                        placeholder="Add item…"
                        className="flex-1 bg-secondary/40 rounded-full px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                      />
                      <button onClick={() => addItemToDraft(p.id)} aria-label="Add item" className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center shrink-0">
                        <Plus size={14} />
                      </button>
                    </div>
                    <button
                      onClick={() => void savePreset(p.id)}
                      disabled={saving === p.id}
                      className="w-full h-10 mt-2 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {saving === p.id && <Loader2 size={12} className="animate-spin" />}
                      Save changes
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {addingPreset ? (
            <div className="rounded-2xl border border-border/60 bg-card p-4 flex items-center gap-2">
              <input
                autoFocus
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addPreset()}
                placeholder="e.g. Business, Beach, Ski"
                className="flex-1 bg-secondary/40 rounded-full px-4 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button onClick={() => void addPreset()} className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center shrink-0"><Plus size={14} /></button>
              <button onClick={() => { setAddingPreset(false); setNewPresetName(""); }} className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center shrink-0"><X size={14} /></button>
            </div>
          ) : (
            <button
              onClick={() => setAddingPreset(true)}
              className="w-full h-12 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center justify-center gap-2"
            ><Plus size={14} /> New preset</button>
          )}
        </div>
      )}
    </div>
  );
}
