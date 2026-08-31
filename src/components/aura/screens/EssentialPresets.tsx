import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus, X, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import {
  listEssentialPresets, createEssentialPreset, deleteEssentialPreset,
  addPresetItem, removePresetItem,
  type EssentialPreset, type EssentialPresetItem,
} from "@/lib/essentials.functions";

type PresetWithItems = EssentialPreset & { items: EssentialPresetItem[] };

export function EssentialPresets({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<PresetWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingPreset, setAddingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  const load = () => {
    listEssentialPresets()
      .then((res) => setPresets(res.presets as PresetWithItems[]))
      .catch((e) => console.error("[AURA essentials] load failed", e))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const addPreset = async () => {
    if (!newPresetName.trim()) return;
    try {
      await createEssentialPreset({ data: { name: newPresetName.trim(), items: [] } });
      setNewPresetName("");
      setAddingPreset(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("essentialPresets.couldntCreatePreset"));
    }
  };

  const removePreset = async (id: string) => {
    try {
      await deleteEssentialPreset({ data: { presetId: id } });
      setPresets((prev) => prev.filter((p) => p.id !== id));
      toast.success(t("essentialPresets.presetRemoved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("essentialPresets.couldntRemovePreset"));
    }
  };

  // Every add/remove below hits the database immediately — there is no
  // separate "Save" step to forget. Optimistic local update first, then
  // reconcile with the real row (or roll back on failure).
  const addItem = async (presetId: string) => {
    if (!newItemName.trim()) return;
    const name = newItemName.trim();
    const category = newItemCategory.trim() || null;
    setNewItemName("");
    setNewItemCategory("");
    setAddingItem(true);
    try {
      const res = await addPresetItem({ data: { presetId, name, category, quantity: 1 } });
      setPresets((prev) => prev.map((p) => (p.id === presetId ? { ...p, items: [...p.items, res.item] } : p)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("essentialPresets.couldntAddItem"));
      setNewItemName(name); // give it back so nothing is lost
      setNewItemCategory(category ?? "");
    } finally {
      setAddingItem(false);
    }
  };

  const removeItem = async (presetId: string, itemId: string) => {
    const prevPresets = presets;
    setPresets((prev) => prev.map((p) => (p.id === presetId ? { ...p, items: p.items.filter((it) => it.id !== itemId) } : p)));
    try {
      await removePresetItem({ data: { id: itemId } });
    } catch (e) {
      console.error("[AURA essentials] remove item failed", e);
      setPresets(prevPresets); // roll back
      toast.error(t("essentialPresets.couldntRemoveItem"));
    }
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-center gap-3">
        <button onClick={() => go("trips")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("essentialPresets.tripPlanner")}</p>
          <h1 className="font-serif text-3xl mt-1">{t("essentialPresets.myEssentials")}</h1>
        </div>
      </header>
      <p className="px-6 mt-2 text-xs text-muted-foreground">
        {t("essentialPresets.hint")}
      </p>

      {loading ? (
        <div className="flex justify-center mt-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="px-6 mt-5 space-y-3">
          {presets.map((p) => {
            const isOpen = openId === p.id;
            return (
              <div key={p.id} className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                <button onClick={() => setOpenId(isOpen ? null : p.id)} className="w-full p-4 flex items-center justify-between text-left">
                  <div>
                    <p className="font-serif text-lg">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{t("essentialPresets.itemsCount", { count: p.items.length })}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removePreset(p.id); }}
                    aria-label={t("essentialPresets.deleteAria", { name: p.name })}
                    className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
                  ><Trash2 size={13} /></button>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-2 border-t border-border/40 pt-3">
                    {p.items.length === 0 && (
                      <p className="text-xs text-muted-foreground pb-1">{t("essentialPresets.nothingHereYet")}</p>
                    )}
                    {p.items.map((it) => (
                      <div key={it.id} className="flex items-center gap-2 rounded-full bg-secondary/40 px-3 py-2">
                        {it.category && <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">{it.category}</span>}
                        <span className="flex-1 text-sm truncate">{it.name}{it.quantity > 1 ? ` ×${it.quantity}` : ""}</span>
                        <button onClick={() => void removeItem(p.id, it.id)} aria-label={t("essentialPresets.removeAria", { name: it.name })} className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-muted-foreground">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        value={newItemCategory}
                        onChange={(e) => setNewItemCategory(e.target.value)}
                        placeholder={t("essentialPresets.categoryOptional")}
                        className="w-28 bg-secondary/40 rounded-full px-3 py-2 text-xs outline-none placeholder:text-muted-foreground"
                      />
                      <input
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void addItem(p.id)}
                        placeholder={t("essentialPresets.addItemPlaceholder")}
                        className="flex-1 bg-secondary/40 rounded-full px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                      />
                      <button
                        onClick={() => void addItem(p.id)}
                        disabled={addingItem}
                        aria-label={t("essentialPresets.addItemAria")}
                        className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center shrink-0 disabled:opacity-60"
                      >
                        {addingItem ? <Loader2 size={12} className="animate-spin" /> : <Plus size={14} />}
                      </button>
                    </div>
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
                placeholder={t("essentialPresets.newPresetPlaceholder")}
                className="flex-1 bg-secondary/40 rounded-full px-4 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button onClick={() => void addPreset()} className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center shrink-0"><Plus size={14} /></button>
              <button onClick={() => { setAddingPreset(false); setNewPresetName(""); }} className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center shrink-0"><X size={14} /></button>
            </div>
          ) : (
            <button
              onClick={() => setAddingPreset(true)}
              className="w-full h-12 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground flex items-center justify-center gap-2"
            ><Plus size={14} /> {t("essentialPresets.newPreset")}</button>
          )}
        </div>
      )}
    </div>
  );
}
