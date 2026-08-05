import { ColorWheelPicker } from "@/components/ColorWheelPicker";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { COLOR_PALETTE } from "@/lib/color-palette";
import { getHarmonies, hexToHsl, nearestWheelName } from "@/lib/itten-wheel";
import { isShoeCategory, sizeEquivalences } from "@/lib/size-conversion";
import { MaterialCombobox } from "@/components/aura/MaterialCombobox";
import { Plus, Filter, Search, Loader2, Trash2, X, Pencil, Camera, Images, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { migrateLegacyTaxonomy } from "@/lib/migrate-legacy-taxonomy.functions";
import { reanalyzeWardrobeBatch } from "@/lib/reanalyze-wardrobe.functions";
import { removeBackgroundClient } from "@/lib/bg-removal-client";
import { ItemCropAdjuster, type FractionalBox } from "@/components/aura/ItemCropAdjuster";
import { trimWhiteMargins } from "@/lib/auto-crop";
import { useEffect, useMemo, useState } from "react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { currentSeason, itemMatchesSeason, resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import {
  ITEM_CATEGORIES,
  SEASON_OPTIONS,
  STYLE_OPTIONS,
  OCCASION_OPTIONS,
  MATERIAL_OPTIONS,
  CURRENCY_OPTIONS,
} from "@/lib/wardrobe-options";

const categories = ["All", ...ITEM_CATEGORIES];
const currencySymbol: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

const splitCsv = (v: string | null | undefined) =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function Wardrobe({ go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const { latitude, longitude, city } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
    const [items, setItems] = useState<WardrobeItem[]>([]);
  const [scanMenuOpen, setScanMenuOpen] = useState(false);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [seasonOnly, setSeasonOnly] = useState(true);
  const [detail, setDetail] = useState<WardrobeItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [colorWheelOpen, setColorWheelOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [adjustingCrop, setAdjustingCrop] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const migrateLegacy = useServerFn(migrateLegacyTaxonomy);
  const reanalyzeBatch = useServerFn(reanalyzeWardrobeBatch);
  const [edit, setEdit] = useState({
    brand: "",
    size: "",
    category: "Tops",
    colors: [] as string[],
    seasons: [] as string[],
    styles: [] as string[],
    occasions: [] as string[],
    materials: [] as string[],
    price: "" as string,
    currency: "EUR",
  });

  const openEdit = () => {
    if (!detail) return;
    setEdit({
      brand: detail.brand ?? "",
      size: detail.size ?? "",
      category: ITEM_CATEGORIES.includes(detail.category ?? "") ? (detail.category as string) : "Tops",
      colors: detail.colors ?? [],
      seasons: splitCsv(detail.season),
      styles: splitCsv(detail.style),
      occasions: splitCsv(detail.occasion),
      materials: Array.isArray(detail.material) ? detail.material : [],
      price: detail.price != null ? String(detail.price) : "",
      currency: (detail.currency && CURRENCY_OPTIONS.includes(detail.currency)) ? detail.currency : "EUR",
    });
    setEditing(true);
  };

  const toggleChip = (arr: string[], setter: (v: string[]) => void, v: string) =>
    setter(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const saveEdit = async () => {
    if (!detail) return;
    setSavingEdit(true);
    try {
      const priceNum = edit.price.trim() === "" ? null : Number(edit.price);
      if (priceNum != null && !Number.isFinite(priceNum)) throw new Error("Invalid price");
      const patch = {
        brand: edit.brand.trim() || null,
        size: edit.size.trim() || null,
        category: edit.category,
        color: edit.colors[0] ?? null,
        colors: edit.colors,
        season: edit.seasons.join(", ") || null,
        style: edit.styles.join(", ") || null,
        occasion: edit.occasions.join(", ") || null,
        material: edit.materials,
        price: priceNum,
        currency: priceNum != null ? edit.currency : null,
      };
      const { data, error } = await supabase
        .from("wardrobe_items").update(patch).eq("id", detail.id).select("*").single();
      if (error) throw error;
      const updated = data as WardrobeItem;
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setDetail(updated);
      setEditing(false);
      toast.success("Item updated");
    } catch (e) {
      console.error("[AURA wardrobe] update", e);
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingEdit(false);
    }
  };

  const toDataUrl = async (url: string): Promise<string> => {
    const resp = await fetch(url, { mode: "cors", cache: "no-store" });
    if (!resp.ok) throw new Error(`image fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  };

  const removeItemBackground = async () => {
    if (!detail || !user) return;
    const path = toStoragePath(detail.image_url);
    const src = path ? signed[path] : "";
    if (!src) return;
    setRemovingBg(true);
    try {
      const dataUrl = await toDataUrl(src);
      let bg = await removeBackgroundClient(dataUrl);
      let attempt = 1;
      while (!bg.ok && attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        bg = await removeBackgroundClient(dataUrl);
        attempt++;
      }
      if (!bg.ok) {
        toast.error("Couldn't remove the background — try again in a moment.");
        return;
      }

      const blob = await (await fetch(bg.imageDataUrl)).blob();
      const bgRemovedDataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const trimmed = await trimWhiteMargins(bgRemovedDataUrl);
      const finalBlob = await (await fetch(trimmed.dataUrl)).blob();
      const newPath = `${user.id}/item-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      const { error: upErr } = await supabase.storage.from("wardrobe").upload(newPath, finalBlob, {
        cacheControl: "3600", upsert: false, contentType: "image/png",
      });
      if (upErr) throw upErr;

      const { data: updatedRow, error: updErr } = await supabase
        .from("wardrobe_items").update({ image_url: newPath }).eq("id", detail.id).select("*").single();
      if (updErr) throw updErr;

      const updated = updatedRow as WardrobeItem;
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setDetail(updated);

      const { data: signedData } = await supabase.storage.from("wardrobe").createSignedUrl(newPath, 3600);
      if (signedData?.signedUrl) setSigned((prev) => ({ ...prev, [newPath]: signedData.signedUrl }));

      toast.success("Background removed");
    } catch (e) {
      console.error("[AURA wardrobe] bg removal failed", e);
      toast.error(e instanceof Error ? e.message : "Background removal failed");
    } finally {
      setRemovingBg(false);
    }
  };

  const saveManualCrop = async ({ dataUrl }: { dataUrl: string; box: FractionalBox }) => {
    if (!detail || !user) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const newPath = `${user.id}/item-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      const { error: upErr } = await supabase.storage.from("wardrobe").upload(newPath, blob, {
        cacheControl: "3600", upsert: false, contentType: "image/png",
      });
      if (upErr) throw upErr;

      const { data: updatedRow, error: updErr } = await supabase
        .from("wardrobe_items").update({ image_url: newPath }).eq("id", detail.id).select("*").single();
      if (updErr) throw updErr;

      const updated = updatedRow as WardrobeItem;
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setDetail(updated);

      const { data: signedData } = await supabase.storage.from("wardrobe").createSignedUrl(newPath, 3600);
      if (signedData?.signedUrl) setSigned((prev) => ({ ...prev, [newPath]: signedData.signedUrl }));

      toast.success("Crop updated");
    } catch (e) {
      console.error("[AURA wardrobe] manual crop save failed", e);
      toast.error(e instanceof Error ? e.message : "Couldn't save that crop");
    } finally {
      setAdjustingCrop(false);
    }
  };

  const tidyAllPhotos = async () => {
    if (!user || tidying) return;
    const toastId = "tidy-photos";
    setTidying(true);
    let changed = 0, checked = 0, failed = 0;
    try {
      toast.loading("Checking photos…", { id: toastId });
      for (const it of items) {
        const path = toStoragePath(it.image_url);
        const src = path ? signed[path] : "";
        if (!src) continue;
        checked++;
        try {
          const result = await trimWhiteMargins(src);
          if (result.changed) {
            const blob = await (await fetch(result.dataUrl)).blob();
            const newPath = `${user.id}/item-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
            const { error: upErr } = await supabase.storage.from("wardrobe").upload(newPath, blob, {
              cacheControl: "3600", upsert: false, contentType: "image/png",
            });
            if (upErr) throw upErr;
            const { error: updErr } = await supabase
              .from("wardrobe_items").update({ image_url: newPath }).eq("id", it.id);
            if (updErr) throw updErr;
            changed++;
          }
        } catch (e) {
          console.error("[AURA wardrobe] tidy failed for item", it.id, e);
          failed++;
        }
        if (checked % 5 === 0 || checked === items.length) {
          toast.loading(`Checking photos… ${checked}/${items.length}`, { id: toastId });
        }
      }

      if (changed > 0) {
        const { data } = await supabase.from("wardrobe_items")
          .select("*").eq("user_id", user.id).order("created_at", { ascending: false });
        setItems((data ?? []) as WardrobeItem[]);
      }
      const failNote = failed ? ` · ${failed} skipped (couldn't process)` : "";
      toast.success(
        changed > 0 ? `${changed} photo${changed === 1 ? "" : "s"} tidied${failNote}` : `All photos already tight${failNote}`,
        { id: toastId },
      );
    } finally {
      setTidying(false);
    }
  };

  const deleteItem = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      const path = toStoragePath(detail.image_url);
      const { error } = await supabase.from("wardrobe_items").delete().eq("id", detail.id);
      if (error) throw error;
      if (path) {
        await supabase.storage.from("wardrobe").remove([path]).catch(() => { /* ignore */ });
      }
      setItems((prev) => prev.filter((it) => it.id !== detail.id));
      toast.success("Item deleted");
      setConfirmDelete(false);
      setDetail(null);
    } catch (e) {
      console.error("[AURA wardrobe] delete", e);
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };
  const season = useMemo(() => currentSeason(), []);

  const runLegacyMigration = async () => {
    if (!user || migrating) return;
    setMigrating(true);
    const toastId = "reanalyze-wardrobe";
    try {
      const legacy = await migrateLegacy({ data: undefined });

      let totalUpdated = 0;
      let round = 0;
      toast.loading("Updating your wardrobe…", { id: toastId });
      while (true) {
        const batch = await reanalyzeBatch({ data: undefined });
        totalUpdated += batch.updated;
        round++;
        if (batch.processed > 0) {
          toast.loading(
            `Updating — ${totalUpdated} pieces re-analyzed, ${batch.remaining} left…`,
            { id: toastId }
          );
        }
        if (batch.processed === 0 || batch.remaining === 0) break;
        if (round > 400) break;
      }

      const grandTotal = legacy.updated + totalUpdated;
      toast.success(
        grandTotal > 0
          ? `Wardrobe updated: ${grandTotal} pieces with new details`
          : "Your wardrobe is already up to date",
        { id: toastId }
      );
      if (grandTotal > 0) {
        const { data } = await supabase.from("wardrobe_items")
          .select("*").eq("user_id", user.id).order("created_at", { ascending: false });
        setItems((data ?? []) as WardrobeItem[]);
      }
    } catch (e) {
      console.error("[AURA wardrobe] update failed", e);
      toast.error("Update failed", { id: toastId });
    } finally {
      setMigrating(false);
    }
  };

  useEffect(() => {
    if (!items.length) { setSigned({}); return; }
    let cancelled = false;
    void resolveWardrobeUrls(items).then(map => { if (!cancelled) setSigned(prev => ({ ...prev, ...map })); });
    return () => { cancelled = true; };
  }, [items]);

  useEffect(() => {
    const addCreatedItem = (item: WardrobeItem) => {
      if (!item?.id || (user?.id && item.user_id !== user.id)) return;
      setItems((current) => current.some((existing) => existing.id === item.id) ? current : [item, ...current]);
    };
    const onCreated = (event: Event) => addCreatedItem((event as CustomEvent<WardrobeItem>).detail);
    window.addEventListener("aura:wardrobe-item-created", onCreated);
    return () => window.removeEventListener("aura:wardrobe-item-created", onCreated);
  }, [user?.id]);

  useEffect(() => {
    if (!user) { setItems([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("wardrobe_items")
      .select("*").eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error("[AURA wardrobe] load error", error); setLoading(false); return; }
        setItems((data ?? []) as WardrobeItem[]); setLoading(false);
      });
  }, [user]);

  const seasonMatches = useMemo(
    () => new Set(items.filter((i) => itemMatchesSeason(i, season)).map((i) => i.id)),
    [items, season],
  );

  const filtered = useMemo(() => items.filter(i =>
    (cat === "All" || i.category === cat) &&
    (!seasonOnly || seasonMatches.has(i.id)) &&
    (q === "" || [i.category, i.brand, i.color, i.style, i.occasion, i.season, ...(i.colors ?? [])]
      .some(v => v?.toLowerCase().includes(q.toLowerCase())))
  ), [items, cat, q, seasonOnly, seasonMatches]);

  const w = weather?.current;
  const wLabel = w ? describeWeather(w.weatherCode, w.isDay) : null;

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{items.length} pieces</p>
          <h1 className="font-serif text-4xl mt-1">Your closet</h1>
        </div>
                <div className="flex gap-2">
          <button
            onClick={() => void runLegacyMigration()}
            disabled={migrating}
            aria-label="Re-analyze existing pieces with AI (may take a while for large wardrobes)"
            title="Re-analyze existing pieces with AI (may take a while for large wardrobes)"
            className="h-12 w-12 rounded-full border border-border flex items-center justify-center active:scale-90 transition disabled:opacity-50"
          >
            {migrating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
          </button>

          <button
            onClick={() => setScanMenuOpen(true)}
            aria-label="Scan photos"
            className="h-12 px-4 rounded-full border border-border flex items-center gap-1.5 active:scale-90 transition"
          >
            <Camera size={16} />
            <span className="text-[10px] uppercase tracking-widest">Scan</span>
          </button>

          <button
            onClick={() => go("add")}
            className="h-12 w-12 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90 transition shadow-luxe"
          >
            <Plus size={20} />
          </button>
        </div>
      </header>

      <div className="px-6 -mt-1 flex justify-end">
        <button
          onClick={() => void tidyAllPhotos()}
          disabled={tidying || items.length === 0}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          {tidying ? <Loader2 size={11} className="animate-spin" /> : "🔲"} Tidy all photos
        </button>
      </div>

      {scanMenuOpen && (
        <div
          className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-end"
          onClick={() => setScanMenuOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-2"
          >
            <p className="font-serif italic text-lg mb-1">Scan photos</p>
            <button
              onClick={() => { setScanMenuOpen(false); go("outfit-scan"); }}
              className="w-full flex items-center gap-3 rounded-2xl border border-border p-4 text-left active:scale-[0.98] transition"
            >
              <Camera size={18} />
              <div>
                <p className="text-sm font-medium">Scan one outfit</p>
                <p className="text-xs text-muted-foreground">One photo, multiple items detected at once</p>
              </div>
            </button>
            <button
              onClick={() => { setScanMenuOpen(false); go("batch-scan"); }}
              className="w-full flex items-center gap-3 rounded-2xl border border-border p-4 text-left active:scale-[0.98] transition"
            >
              <Images size={18} />
              <div>
                <p className="text-sm font-medium">Batch scan photos</p>
                <p className="text-xs text-muted-foreground">Up to 150 photos at once, processed in the background</p>
              </div>
            </button>
          </div>
        </div>
      )}


      {/* Weather / season banner */}
      <div className="mx-6 mt-4 rounded-2xl bg-card border border-border/60 p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{season} · {city ?? "your area"}</p>
          {w ? (
            <p className="font-serif text-xl mt-0.5">
              {Math.round(w.temperature)}° · {wLabel?.label}
            </p>
          ) : (
            <p className="font-serif text-lg mt-0.5 italic text-muted-foreground">Weather unavailable</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            {seasonOnly ? `Showing pieces tagged for ${season.toLowerCase()}` : "Showing every piece"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {wLabel && <span className="text-3xl leading-none">{wLabel.icon}</span>}
          <button
            onClick={() => setSeasonOnly((v) => !v)}
            className={`text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full ${
              seasonOnly ? "bg-foreground text-background" : "border border-border"
            }`}
          >
            {seasonOnly ? "This season" : "All seasons"}
          </button>
        </div>
      </div>

      <div className="mx-6 mt-4 flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
        <Search size={15} className="text-muted-foreground" />
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search by color, fabric, brand…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
        />
        <Filter size={15} className="text-muted-foreground" />
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar px-6">
        {categories.map(c => (
          <button
            key={c} onClick={() => setCat(c)}
            className={`shrink-0 rounded-full px-4 py-2 text-xs tracking-wide transition ${
              cat === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
            }`}
          >{c}</button>
        ))}
      </div>
      {loading ? (
        <div className="flex items-center justify-center mt-20 text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="px-6 mt-16 text-center animate-fade-up">
          <p className="font-serif text-2xl italic">
            {items.length === 0 ? "Your closet is empty" : `Nothing for ${season.toLowerCase()} yet`}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {items.length === 0 ? "Add your first piece to begin styling." : "Turn off the season filter to see everything."}
          </p>
          {items.length === 0 ? (
            <button
              onClick={() => go("add")}
              className="mt-6 h-12 px-6 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs"
            >Add a piece</button>
          ) : (
            <button
              onClick={() => setSeasonOnly(false)}
              className="mt-6 h-12 px-6 rounded-full border border-border uppercase tracking-[0.3em] text-xs"
            >Show all seasons</button>
          )}
        </div>
      ) : (
        <div className="px-6 mt-6 grid grid-cols-2 gap-x-3 gap-y-5">
          {filtered.map((it, i) => {
            const path = toStoragePath(it.image_url);
            const src = path ? (signed[path] ?? "") : "";
            const label = (it.colors?.[0] ?? it.color ?? it.category ?? "Wardrobe piece");
            return (
            <button
              key={it.id}
              onClick={() => { setDetail(it); setConfirmDelete(false); }}
              className="group animate-fade-up text-left"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="overflow-hidden rounded-[1.25rem] border border-border/50 aspect-[4/5]" style={{ background: "#FFFFFF" }}>
                {src ? (
                  <img
                    src={src} alt={`${it.brand ?? label} piece`}
                    className="h-full w-full object-contain p-1 transition-transform duration-500 group-active:scale-95"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-full w-full animate-pulse" style={{ background: "#EDEDED" }} />
                )}
              </div>
              <div className="px-0.5 mt-1.5">
                <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground truncate">{it.brand ?? it.category}</p>
                <p className="font-serif text-[15px] leading-tight truncate">{[label, it.category].filter(Boolean).join(" ")}</p>
              </div>
            </button>
            );
          })}
        </div>
      )}
      {detail && (
        <div
          className="fixed inset-0 z-[60] bg-background/85 backdrop-blur flex items-end sm:items-center justify-center"
          onClick={() => { setDetail(null); setEditing(false); setConfirmDelete(false); }}
        >
         <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-[82vh] overflow-y-auto overscroll-contain bg-card rounded-t-3xl sm:rounded-3xl border border-border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] relative"
          >
            <button
              onClick={() => { setDetail(null); setEditing(false); setConfirmDelete(false); }}
              className="absolute top-4 left-4 h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
              aria-label="Close"
            ><X size={16} /></button>
            {!editing && (
              <button
                onClick={openEdit}
                className="absolute top-4 left-16 h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
                aria-label="Edit item"
              ><Pencil size={16} /></button>
            )}
            {!editing && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="absolute top-4 right-4 h-9 w-9 rounded-full bg-destructive/10 text-destructive flex items-center justify-center active:scale-90"
                aria-label="Delete item"
              ><Trash2 size={16} /></button>
            )}

            {(() => {
              const path = toStoragePath(detail.image_url);
              const src = path ? signed[path] : "";
              return (
                <>
                  <div className="mt-6 rounded-2xl overflow-hidden mx-auto aspect-square max-w-[240px]" style={{ background: "#FFFFFF" }}>
                    {src ? (
                      <img src={src} alt="" className="h-full w-full object-contain p-3" />
                    ) : (
                      <div className="h-full w-full animate-pulse" style={{ background: "#EDEDED" }} />
                    )}
                  </div>
                  {src && !editing && (
                    <div className="mx-auto mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                      <button
                        onClick={() => setColorWheelOpen(true)}
                        className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground active:scale-95"
                      >
                        🎨 Color Harmony
                      </button>
                      <button
                        onClick={() => setAdjustingCrop(true)}
                        className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground active:scale-95"
                      >
                        🔲 Adjust crop
                      </button>
                      <button
                        onClick={removeItemBackground}
                        disabled={removingBg}
                        className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground active:scale-95 disabled:opacity-50"
                      >
                        {removingBg ? <Loader2 size={12} className="animate-spin" /> : "✂️"} Remove background
                      </button>
                    </div>
                  )}
                  {adjustingCrop && src && (
                    <ItemCropAdjuster
                      src={src}
                      initialBox={null}
                      onCancel={() => setAdjustingCrop(false)}
                      onSave={saveManualCrop}
                    />
                  )}
                  {colorWheelOpen && src && (
                    <ColorWheelPicker imageUrl={src} onClose={() => setColorWheelOpen(false)} />
                  )}
                </>
              );
            })()}

            {!editing ? (
              <>
                <div className="mt-4 text-center">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{detail.brand ?? detail.category}</p>
                  <p className="font-serif text-2xl mt-1">{[detail.colors?.[0] ?? detail.color, detail.category].filter(Boolean).join(" ")}</p>
                  {detail.season && <p className="text-xs text-muted-foreground mt-1">{detail.season}</p>}
                  {detail.size && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Size {detail.size}
                      {(() => {
                        const eq = sizeEquivalences(detail.size, { shoes: isShoeCategory(detail.category) });
                        return eq ? ` — ${eq}` : "";
                      })()}
                    </p>
                  )}
                  {detail.price != null && (
                    <div className="mt-3 inline-flex items-center rounded-full bg-secondary/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                      {detail.worn_count ? (
                        <span>{detail.currency ?? "€"}{(detail.price / detail.worn_count).toFixed(2)} per wear</span>
                      ) : (
                        <span>Not worn yet</span>
                      )}
                    </div>
                  )}
                </div>

                {(() => {
                  const cname = detail.colors?.[0] ?? detail.color;
                  const pal = cname
                    ? COLOR_PALETTE.find((p) => p.name.toLowerCase() === cname.toLowerCase())
                    : undefined;
                  if (!pal) return null;
                  const { h, s } = hexToHsl(pal.hex);
                  const neutral = s < 0.12;
                  return (
                    <div className="mt-5 rounded-2xl border border-border bg-secondary/30 p-4">
                                            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center">
                        Color analysis · Itten
                      </p>
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <span className="h-8 w-8 rounded-full border border-border" style={{ background: pal.hex }} />
                        <div className="text-left">
                          <p className="text-sm font-medium">{pal.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {neutral ? "Neutral" : nearestWheelName(h)}
                          </p>
                        </div>
                      </div>
                      {neutral ? (
                        <p className="mt-3 text-[11px] text-muted-foreground text-center">
                          Neutral color: pairs with the whole wheel.
                        </p>

                      ) : (
                        <div className="mt-3 flex justify-center gap-2 flex-wrap">
                          {getHarmonies(pal.hex).slice(0, 5).map((hm, idx) => (
                            <div key={idx} className="text-center">
                              <span className="block h-7 w-7 rounded-full border border-border mx-auto" style={{ background: hm.hex }} />
                              <p className="mt-1 text-[8px] uppercase tracking-wide text-muted-foreground">{hm.label}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <button
                  onClick={openEdit}
                  className="mt-5 w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 active:scale-95"
                >
                  <Pencil size={12} /> Edit details
                </button>
                                            <button
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 w-full h-12 rounded-full border border-destructive/40 text-destructive text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2"
                >
                  <Trash2 size={12} /> Delete item
                </button>
                {confirmDelete && (
                  <div
                    className="fixed inset-0 z-[80] bg-background/70 backdrop-blur-sm flex items-center justify-center px-6"
                    onClick={() => !deleting && setConfirmDelete(false)}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="w-full max-w-xs rounded-2xl border border-destructive/40 bg-card p-5 shadow-luxe"
                    >
                      <p className="font-serif text-lg text-center">Delete this item?</p>
                      <p className="text-xs text-muted-foreground text-center mt-1">This cannot be undone.</p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setConfirmDelete(false)}
                          disabled={deleting}
                          className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                        >Cancel</button>
                        <button
                          onClick={deleteItem}
                          disabled={deleting}
                          className="h-11 rounded-full bg-destructive text-destructive-foreground text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {deleting && <Loader2 size={12} className="animate-spin" />}
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Brand</p>
                  <input
                    value={edit.brand}
                    onChange={(e) => setEdit((s) => ({ ...s, brand: e.target.value }))}
                    placeholder="Brand"
                    className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Size</p>
                  <input
                    value={edit.size}
                    onChange={(e) => setEdit((s) => ({ ...s, size: e.target.value }))}
                    placeholder="e.g. 42 or M — optional"
                    className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  {(() => {
                    const eq = sizeEquivalences(edit.size, { shoes: isShoeCategory(edit.category) });
                    return eq ? <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">{eq}</p> : null;
                  })()}
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Category</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ITEM_CATEGORIES.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEdit((s) => ({ ...s, category: c }))}
                        className={`rounded-full px-3 py-1.5 text-xs ${
                          edit.category === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
                        }`}
                      >{c}</button>
                    ))}
                  </div>
                </div>

                <ColorPicker
                  value={edit.colors}
                  onChange={(next) => setEdit((s) => ({ ...s, colors: next }))}
                />

                {([
                  ["Season", SEASON_OPTIONS, edit.seasons, (v: string[]) => setEdit((s) => ({ ...s, seasons: v }))],
                  ["Style", STYLE_OPTIONS, edit.styles, (v: string[]) => setEdit((s) => ({ ...s, styles: v }))],
                  ["Occasion", OCCASION_OPTIONS, edit.occasions, (v: string[]) => setEdit((s) => ({ ...s, occasions: v }))],
                ] as const).map(([label, opts, values, setter]) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {opts.map((o) => {
                        const on = values.includes(o);
                        return (
                          <button
                            key={o}
                            onClick={() => toggleChip(values, setter, o)}
                            className={`rounded-full px-3 py-1.5 text-xs ${
                              on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
                            }`}
                          >{o}</button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <MaterialCombobox
                  label="Material"
                  options={MATERIAL_OPTIONS}
                  values={edit.materials}
                  onChange={(v) => setEdit((s) => ({ ...s, materials: v }))}
                />

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Price</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground w-6 text-center">{currencySymbol[edit.currency]}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={edit.price}
                      onChange={(e) => setEdit((s) => ({ ...s, price: e.target.value }))}
                      placeholder="0.00"
                      className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    {CURRENCY_OPTIONS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEdit((s) => ({ ...s, currency: c }))}
                        className={`rounded-full px-3 py-1.5 text-xs ${
                          edit.currency === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
                        }`}
                      >{c}</button>
                    ))}
                  </div>
                </div>

                                <div className="grid grid-cols-2 gap-2 pt-2 sticky bottom-24 z-50 bg-card pb-1 rounded-2xl shadow-luxe -mx-1 px-1">
                  <button
                    onClick={() => setEditing(false)}
                    disabled={savingEdit}
                    className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                  >Cancel</button>
                  <button
                    onClick={saveEdit}
                    disabled={savingEdit}
                    className="h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {savingEdit && <Loader2 size={12} className="animate-spin" />}

                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
