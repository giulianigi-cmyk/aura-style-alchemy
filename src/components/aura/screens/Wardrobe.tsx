import { ColorWheelPicker } from "@/components/ColorWheelPicker";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { COLOR_PALETTE } from "@/lib/color-palette";
import { getHarmonies, hexToHsl, nearestWheelName } from "@/lib/itten-wheel";
import { isShoeCategory, sizeEquivalences } from "@/lib/size-conversion";
import { MaterialCombobox } from "@/components/aura/MaterialCombobox";
import { AddSourceSheet } from "@/components/aura/AddSourceSheet";

import { Plus, Filter, Search, Loader2, Trash2, X, Pencil, Wand2, Archive, ArchiveRestore, Check, Users } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { migrateLegacyTaxonomy } from "@/lib/migrate-legacy-taxonomy.functions";
import { reanalyzeWardrobeBatch } from "@/lib/reanalyze-wardrobe.functions";
import { lendItem, listActiveLoans, returnLoan, type WardrobeLoan } from "@/lib/wardrobe-loans.functions";
import { removeBackgroundClient } from "@/lib/bg-removal-client";
import { ItemCropAdjuster } from "@/components/aura/ItemCropAdjuster";
import type { FractionalBox } from "@/components/aura/ItemCropAdjuster";
import { compressImageForUpload } from "@/lib/image-compress";
import { trimWhiteMargins } from "@/lib/auto-crop";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { syncMySharedLibrary } from "@/lib/shared-library.functions";
import type { WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { currentSeason, itemMatchesSeason, resolveWardrobeUrls, toStoragePath, thumbSrc } from "@/lib/wardrobe-image";
import {
  ITEM_CATEGORIES,
  SEASON_OPTIONS,
  STYLE_OPTIONS,
  OCCASION_OPTIONS,
  MATERIAL_OPTIONS,
  CURRENCY_OPTIONS,
} from "@/lib/wardrobe-options";
import { listLocations, moveItemsToLocation } from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";
import i18n from "@/i18n/config";
import {
  computeItemValuation,
  fetchValuationConfig,
  EMPTY_VALUATION_CONFIG,
  type ValuationConfig,
  type Iconicity,
} from "@/lib/wardrobe-value-engine";

const categories = ["All", ...ITEM_CATEGORIES];
const currencySymbol: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
const ICONICITY_OPTIONS: Iconicity[] = ["iconic", "timeless", "classic", "seasonal", "trend_driven", "basic"];

const splitCsv = (v: string | null | undefined) =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function Wardrobe({ go, gapFilter, onClearGapFilter }: {
  go: (s: Screen) => void;
  gapFilter?: "price" | "purchase_date" | null;
  onClearGapFilter?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { latitude, longitude, city } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [seasonOnly, setSeasonOnly] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [locations, setLocations] = useState<WardrobeLocation[]>([]);
  const [viewLocationId, setViewLocationId] = useState<string | "all">("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [movingSelection, setMovingSelection] = useState(false);
  const [bulkMovePicker, setBulkMovePicker] = useState(false);
  const [detail, setDetail] = useState<WardrobeItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLoaned, setShowLoaned] = useState(false);
  const [loansByItemId, setLoansByItemId] = useState<Record<string, WardrobeLoan>>({});
  const [loanSheetOpen, setLoanSheetOpen] = useState(false);
  const [borrowerName, setBorrowerName] = useState("");
  const [lending, setLending] = useState(false);
  const [returnPickerOpen, setReturnPickerOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const [colorWheelOpen, setColorWheelOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [adjustingCrop, setAdjustingCrop] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const migrateLegacy = useServerFn(migrateLegacyTaxonomy);
  const fetchLocations = useServerFn(listLocations);
  const moveItems = useServerFn(moveItemsToLocation);
  const reanalyzeBatch = useServerFn(reanalyzeWardrobeBatch);
  const lendItemFn = useServerFn(lendItem);
  const fetchActiveLoans = useServerFn(listActiveLoans);
  const returnLoanFn = useServerFn(returnLoan);
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
    purchaseDate: "" as string,
    currentRetailPrice: "" as string,
    historicalRetailPrice: "" as string,
    iconicity: "" as Iconicity | "",
    model: "" as string,
    bagSizeClass: "" as string,
  });
  const [valuationConfig, setValuationConfig] = useState<ValuationConfig>(EMPTY_VALUATION_CONFIG);

  useEffect(() => {
    fetchValuationConfig().then(setValuationConfig).catch((e) => console.error("[AURA wardrobe] valuation config", e));
  }, []);

  const openEdit = () => {
    if (!detail) return;
    const raw = detail as unknown as { current_retail_price?: number | null; historical_retail_price?: number | null; iconicity?: Iconicity | null; model?: string | null; bag_size_class?: string | null };
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
      purchaseDate: (detail as unknown as { purchase_date?: string | null }).purchase_date ?? "",
      currentRetailPrice: raw.current_retail_price != null ? String(raw.current_retail_price) : "",
      historicalRetailPrice: raw.historical_retail_price != null ? String(raw.historical_retail_price) : "",
      iconicity: raw.iconicity ?? "",
      model: raw.model ?? "",
      bagSizeClass: raw.bag_size_class ?? "",
    });
    setEditing(true);
  };

    const toggleChip = (arr: string[], setter: (v: string[]) => void, v: string) =>
    setter(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // All Seasons means "no specific season applies" — it can never be
  // true at the same time as a specific one being selected, in either
  // direction of the toggle.
  const toggleSeasonChip = (arr: string[], setter: (v: string[]) => void, v: string) => {
    if (v === "All Seasons") {
      setter(arr.includes(v) ? [] : ["All Seasons"]);
    } else {
      const withoutAll = arr.filter((x) => x !== "All Seasons");
      setter(withoutAll.includes(v) ? withoutAll.filter((x) => x !== v) : [...withoutAll, v]);
    }
  };

    const saveEdit = async () => {
    if (!detail) return;
    setSavingEdit(true);
    try {
      const priceNum = edit.price.trim() === "" ? null : Number(edit.price);
      if (priceNum != null && !Number.isFinite(priceNum)) throw new Error(t("wardrobe.invalidPrice"));
      const retailNum = edit.currentRetailPrice.trim() === "" ? null : Number(edit.currentRetailPrice);
      if (retailNum != null && !Number.isFinite(retailNum)) throw new Error(t("wardrobe.invalidPrice"));
      const historicalRetailNum = edit.historicalRetailPrice.trim() === "" ? null : Number(edit.historicalRetailPrice);
      if (historicalRetailNum != null && !Number.isFinite(historicalRetailNum)) throw new Error(t("wardrobe.invalidPrice"));

      // Only the fields AI ever classifies get tracked here — price,
      // size and purchase date are never AI-assigned, so there's nothing
      // for a future re-classification pass to accidentally revert.
      const sameArray = (a: string[], b: string[] | null | undefined) => {
        const bb = b ?? [];
        return a.length === bb.length && a.every((v) => bb.includes(v));
      };
      const changedFields: string[] = [];
      if (edit.brand.trim() !== (detail.brand ?? "")) changedFields.push("brand");
      if (edit.category !== detail.category) changedFields.push("category");
      if (!sameArray(edit.colors, detail.colors)) changedFields.push("colors");
      if (!sameArray(edit.seasons, splitCsv(detail.season))) changedFields.push("season");
      if (!sameArray(edit.styles, splitCsv(detail.style))) changedFields.push("style");
      if (!sameArray(edit.occasions, splitCsv(detail.occasion))) changedFields.push("occasion");
      if (!sameArray(edit.materials, Array.isArray(detail.material) ? detail.material : [])) changedFields.push("material");

      const existingEdited = (detail as unknown as { user_edited_fields?: string[] }).user_edited_fields ?? [];
      const userEditedFields = changedFields.length
        ? Array.from(new Set([...existingEdited, ...changedFields]))
        : existingEdited;

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
        purchase_date: edit.purchaseDate || null,
        current_retail_price: retailNum,
        current_retail_source: retailNum != null ? "user" : null,
        current_retail_updated_at: retailNum != null ? new Date().toISOString() : null,
        historical_retail_price: historicalRetailNum,
        historical_retail_source: historicalRetailNum != null ? "user" : null,
        iconicity: edit.iconicity || null,
        model: edit.model.trim() || null,
        bag_size_class: edit.bagSizeClass || null,
        user_edited_fields: userEditedFields,
      };
      const { data, error } = await supabase
        .from("wardrobe_items").update(patch as never).eq("id", detail.id).select("*").single();
      if (error) throw error;
      const updated = data as WardrobeItem;
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setDetail(updated);
      setEditing(false);
      toast.success(t("wardrobe.toastItemUpdated"));
      void syncMySharedLibrary().catch(() => {});
    } catch (e) {
      console.error("[AURA wardrobe] update", e);
      toast.error(e instanceof Error ? e.message : t("wardrobe.toastUpdateFailed"));
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
        toast.error(t("wardrobe.toastBgRemoveFailed"));
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

      let newThumbnailPath: string | null = null;
      try {
        const thumbFile = await compressImageForUpload(new File([finalBlob], "item.png", { type: "image/png" }), 400, 0.75);
        const thumbPath = `${user.id}/thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const { error: thumbErr } = await supabase.storage.from("wardrobe").upload(thumbPath, thumbFile, {
          cacheControl: "3600", upsert: false, contentType: thumbFile.type || "image/jpeg",
        });
        if (!thumbErr) newThumbnailPath = thumbPath;
      } catch (e) {
        console.error("[AURA wardrobe] thumbnail regeneration failed after bg removal", e);
      }

      const { data: updatedRow, error: updErr } = await supabase
        .from("wardrobe_items").update({ image_url: newPath, thumbnail_path: newThumbnailPath } as never).eq("id", detail.id).select("*").single();
      if (updErr) throw updErr;

      const updated = updatedRow as WardrobeItem;
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setDetail(updated);

      const pathsToSign = [newPath, ...(newThumbnailPath ? [newThumbnailPath] : [])];
      const { data: signedData } = await supabase.storage.from("wardrobe").createSignedUrls(pathsToSign, 3600);
      if (signedData) {
        const additions: Record<string, string> = {};
        signedData.forEach((row, i) => { if (row.signedUrl) additions[pathsToSign[i]] = row.signedUrl; });
        setSigned((prev) => ({ ...prev, ...additions }));
      }

      toast.success(t("wardrobe.toastBgRemoved"));
      void syncMySharedLibrary().catch(() => {});
    } catch (e) {
      console.error("[AURA wardrobe] bg removal failed", e);
      toast.error(e instanceof Error ? e.message : t("wardrobe.toastBgRemovalGenericFailed"));
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

      let newThumbnailPath: string | null = null;
      try {
        const thumbFile = await compressImageForUpload(new File([blob], "item.png", { type: "image/png" }), 400, 0.75);
        const thumbPath = `${user.id}/thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const { error: thumbErr } = await supabase.storage.from("wardrobe").upload(thumbPath, thumbFile, {
          cacheControl: "3600", upsert: false, contentType: thumbFile.type || "image/jpeg",
        });
        if (!thumbErr) newThumbnailPath = thumbPath;
      } catch (e) {
        console.error("[AURA wardrobe] thumbnail regeneration failed after manual crop", e);
      }

      const { data: updatedRow, error: updErr } = await supabase
        .from("wardrobe_items").update({ image_url: newPath, thumbnail_path: newThumbnailPath } as never).eq("id", detail.id).select("*").single();
      if (updErr) throw updErr;

      const updated = updatedRow as WardrobeItem;
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setDetail(updated);

      const pathsToSign = [newPath, ...(newThumbnailPath ? [newThumbnailPath] : [])];
      const { data: signedData } = await supabase.storage.from("wardrobe").createSignedUrls(pathsToSign, 3600);
      if (signedData) {
        const additions: Record<string, string> = {};
        signedData.forEach((row, i) => { if (row.signedUrl) additions[pathsToSign[i]] = row.signedUrl; });
        setSigned((prev) => ({ ...prev, ...additions }));
      }

      toast.success(t("wardrobe.toastCropUpdated"));
      void syncMySharedLibrary().catch(() => {});
    } catch (e) {
      console.error("[AURA wardrobe] manual crop save failed", e);
      toast.error(e instanceof Error ? e.message : t("wardrobe.toastCropFailed"));
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
      toast.loading(t("wardrobe.toastCheckingPhotos"), { id: toastId });
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
          toast.loading(t("wardrobe.toastCheckingPhotosProgress", { checked, total: items.length }), { id: toastId });
        }
      }

      if (changed > 0) {
        const { data } = await supabase.from("wardrobe_items")
          .select("*").eq("user_id", user.id).order("created_at", { ascending: false });
        setItems((data ?? []) as WardrobeItem[]);
      }
      const failNote = failed ? ` · ${t("wardrobe.toastSkippedCount", { count: failed })}` : "";
      toast.success(
        changed > 0 ? `${t("wardrobe.toastPhotosTidied", { count: changed })}${failNote}` : `${t("wardrobe.toastAllPhotosTight")}${failNote}`,
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
      toast.success(t("wardrobe.toastItemDeleted"));
      void syncMySharedLibrary().catch(() => {});
      setConfirmDelete(false);
      setDetail(null);
    } catch (e) {
      console.error("[AURA wardrobe] delete", e);
      toast.error(e instanceof Error ? e.message : t("wardrobe.toastDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const toggleArchiveItem = async (item: WardrobeItem, archived: boolean) => {
    const { error } = await (supabase.from("wardrobe_items" as never) as any).update({ archived }).eq("id", item.id);
    if (error) { toast.error(error.message); return; }
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, archived } as WardrobeItem : it)));
    setDetail((d) => (d && d.id === item.id ? ({ ...d, archived } as WardrobeItem) : d));
    void syncMySharedLibrary().catch(() => {});
    toast.success(archived ? t("wardrobe.toastArchived") : t("wardrobe.toastRestored"));
  };

  const moveDetailItem = async (locationId: string) => {
    if (!detail) return;
    try {
      await moveItems({ data: { itemIds: [detail.id], locationId } });
      setItems((prev) => prev.map((it) => (it.id === detail.id ? { ...it, location_id: locationId } as WardrobeItem : it)));
      setDetail((d) => (d ? ({ ...d, location_id: locationId } as WardrobeItem) : d));
      toast.success(t("wardrobe.toastMoved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("wardrobe.toastMoveItemFailed"));
    }
  };

  const loadLoans = useCallback(async () => {
    try {
      const res = await fetchActiveLoans({} as never);
      const map: Record<string, WardrobeLoan> = {};
      res.loans.forEach((l) => { map[l.item_id] = l; });
      setLoansByItemId(map);
    } catch (e) {
      console.error("[AURA wardrobe] loans load failed", e);
    }
  }, [fetchActiveLoans]);

  useEffect(() => { void loadLoans(); }, [loadLoans]);

  const lendDetailItem = async () => {
    if (!detail || !borrowerName.trim()) return;
    setLending(true);
    try {
      const res = await lendItemFn({ data: { itemId: detail.id, borrowerName: borrowerName.trim() } });
      setItems((prev) => prev.map((it) => (it.id === detail.id ? { ...it, active_loan_id: res.loan.id } as WardrobeItem : it)));
      setDetail((d) => (d ? ({ ...d, active_loan_id: res.loan.id } as WardrobeItem) : d));
      setLoansByItemId((prev) => ({ ...prev, [detail.id]: res.loan }));
      setLoanSheetOpen(false);
      setBorrowerName("");
      toast.success(t("wardrobe.toastLoaned"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("wardrobe.toastLoanFailed"));
    } finally {
      setLending(false);
    }
  };

  // Revoking always asks where the item physically goes (even with a
  // single location, so the choice is explicit rather than silently
  // assumed) - passing null only when the person truly has no locations
  // set up at all yet, in which case there's nothing to choose between.
  const returnDetailItem = async (locationId: string | null) => {
    if (!detail) return;
    const loan = loansByItemId[detail.id];
    if (!loan) return;
    setReturning(true);
    try {
      await returnLoanFn({ data: { loanId: loan.id, returnToLocationId: locationId } });
      setItems((prev) => prev.map((it) => (it.id === detail.id ? { ...it, active_loan_id: null, location_id: locationId } as WardrobeItem : it)));
      setDetail((d) => (d ? ({ ...d, active_loan_id: null, location_id: locationId } as WardrobeItem) : d));
      setLoansByItemId((prev) => { const next = { ...prev }; delete next[detail.id]; return next; });
      setReturnPickerOpen(false);
      toast.success(t("wardrobe.toastReturned"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("wardrobe.toastReturnFailed"));
    } finally {
      setReturning(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkMovePicker(false);
  };

  const moveSelection = async (locationId: string) => {
    if (selectedIds.size === 0) return;
    setMovingSelection(true);
    try {
      const ids = Array.from(selectedIds);
      await moveItems({ data: { itemIds: ids, locationId } });
      setItems((prev) => prev.map((it) => (selectedIds.has(it.id) ? { ...it, location_id: locationId } as WardrobeItem : it)));
      toast.success(t("wardrobe.toastMovedCount", { count: ids.length }));
      exitSelectMode();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("wardrobe.toastMoveSelectionFailed"));
    } finally {
      setMovingSelection(false);
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
      toast.loading(t("wardrobe.toastUpdatingWardrobe"), { id: toastId });
      while (true) {
        const batch = await reanalyzeBatch({ data: undefined });
        totalUpdated += batch.updated;
        round++;
        if (batch.processed > 0) {
          toast.loading(
            t("wardrobe.toastUpdatingProgress", { updated: totalUpdated, remaining: batch.remaining }),
            { id: toastId }
          );
        }
        if (batch.processed === 0 || batch.remaining === 0) break;
        if (round > 400) break;
      }

      const grandTotal = legacy.updated + totalUpdated;
      toast.success(
        grandTotal > 0
          ? t("wardrobe.toastWardrobeUpdatedCount", { count: grandTotal })
          : t("wardrobe.toastAlreadyUpToDate"),
        { id: toastId }
      );
      if (grandTotal > 0) {
        const { data } = await supabase.from("wardrobe_items")
          .select("*").eq("user_id", user.id).order("created_at", { ascending: false });
        setItems((data ?? []) as WardrobeItem[]);
      }
    } catch (e) {
      console.error("[AURA wardrobe] update failed", e);
      toast.error(t("wardrobe.toastUpdateFailed"), { id: toastId });
    } finally {
      setMigrating(false);
    }
  };

  // Only sign items whose path isn't already resolved — re-signing every
  // single item (300+ for an established wardrobe) each time the array
  // changes even by ONE item (the common case: saving a new piece
  // prepends it here) was adding real, avoidable latency right when the
  // person was mid-flow adding something.
  useEffect(() => {
    if (!items.length) { setSigned({}); return; }
    let cancelled = false;
    setSigned((prevSigned) => {
      const known = new Set(Object.keys(prevSigned));
      const unresolved = items.filter((it) => {
        const path = toStoragePath(it.image_url);
        const thumbPath = (it as unknown as { thumbnail_path?: string | null }).thumbnail_path;
        return (path && !known.has(path)) || (thumbPath && !known.has(thumbPath));
      });
      if (unresolved.length) {
        void resolveWardrobeUrls(unresolved).then((map) => { if (!cancelled) setSigned((prev) => ({ ...prev, ...map })); });
      }
      return prevSigned;
    });
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

      const loadItems = useCallback((uid: string) => {
    setLoading(true);
    const query = supabase.from("wardrobe_items")
      .select("*").eq("user_id", uid).order("created_at", { ascending: false });
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 10000));
    return Promise.race([query, timeout]).then((result) => {
      if (result === "timeout") {
        console.error("[AURA wardrobe] load timed out after 10s");
        toast.error(t("wardrobe.toastLoadTimeout"));
        setLoading(false);
        return;
      }
      const { data, error } = result;
      if (error) {
        console.error("[AURA wardrobe] load error", error);
        toast.error(`${t("wardrobe.toastLoadFailed")} — ${error.message}`);
        setLoading(false);
        return;
      }
      setItems((data ?? []) as WardrobeItem[]);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) { setItems([]); setLoading(false); return; }
    void loadItems(user.id);
  }, [user, loadItems]);



  useEffect(() => {
    if (!user) return;
    fetchLocations()
      .then((res) => setLocations(res.locations))
      .catch((e) => console.error("[AURA wardrobe] locations load failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const seasonMatches = useMemo(
    () => new Set(items.filter((i) => itemMatchesSeason(i, season)).map((i) => i.id)),
    [items, season],
  );

  const archivedCount = useMemo(
    () => items.filter((i) => (i as unknown as { archived?: boolean }).archived).length,
    [items],
  );

  const loanedCount = useMemo(
    () => items.filter((i) => (i as unknown as { active_loan_id?: string | null }).active_loan_id).length,
    [items],
  );

  // Mirrors the exact gate in reanalyzeWardrobeBatch — this badge
  // undercounted before (only checked formality), so it could show 0
  // pending while season/occasion/day_evening were still genuinely
  // missing on plenty of items. Was previously recomputed inline in the
  // JSX on every render (unmemoized) — for a wardrobe with hundreds of
  // pieces that's real, avoidable work on every re-render, not just
  // when items actually change.
  const unclassifiedCount = useMemo(
    () => items.filter((it) =>
      it.formality == null || !it.occasion || !it.season || !it.day_evening
    ).length,
    [items],
  );

  const filtered = useMemo(() => {
    if (gapFilter) {
      return items.filter((i) => {
        const isArchived = Boolean((i as unknown as { archived?: boolean }).archived);
        if (isArchived) return false;
        if (gapFilter === "price") return i.price == null || i.price <= 0;
        return !(i as unknown as { purchase_date?: string | null }).purchase_date;
      });
    }
    return items.filter(i => {
      const isArchived = Boolean((i as unknown as { archived?: boolean }).archived);
      const isLoaned = Boolean((i as unknown as { active_loan_id?: string | null }).active_loan_id);
      // Loaned and Archived are separate, mutually exclusive views, same
      // pattern as each other - a loaned piece isn't physically here to
      // browse in the main closet any more than an archived one is.
      if (showLoaned) return isLoaned;
      if (showArchived) return isArchived;
      const locId = (i as unknown as { location_id?: string | null }).location_id ?? null;
      const matchesLocation = viewLocationId === "all" || locId === viewLocationId;
      return !isArchived && !isLoaned && matchesLocation &&
        (cat === "All" || i.category === cat) &&
        (!seasonOnly || seasonMatches.has(i.id)) &&
        (q === "" || [i.category, i.brand, i.color, i.style, i.occasion, i.season, ...(i.colors ?? [])]
          .some(v => v?.toLowerCase().includes(q.toLowerCase())));
    });
  }, [items, cat, q, seasonOnly, seasonMatches, showArchived, showLoaned, viewLocationId, gapFilter]);

  const w = weather?.current;
  const wLabel = w ? describeWeather(w.weatherCode, w.isDay) : null;

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14 pb-2 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.piecesCount", { count: items.length })}</p>
          <h1 className="font-serif text-4xl mt-1">{t("wardrobe.title")}</h1>
        </div>
                <div className="flex gap-2">
          {(() => {
            const hasPending = migrating || unclassifiedCount > 0;
            return (
              <button
                onClick={() => void runLegacyMigration()}
                disabled={migrating}
                aria-label={t("wardrobe.updateCompatibilityAria")}
                className={`h-12 rounded-full border border-border flex items-center gap-1.5 active:scale-90 transition disabled:opacity-50 shrink-0 ${hasPending ? "pl-3.5 pr-4" : "w-12 justify-center"}`}
              >
                {migrating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {hasPending && (
                  <span className="text-[10px] uppercase tracking-[0.2em] whitespace-nowrap">
                    {migrating ? t("wardrobe.updating") : t("wardrobe.updateCount", { count: unclassifiedCount })}
                  </span>
                )}
              </button>
            );
          })()}

          <button
            onClick={() => setAddSheetOpen(true)}
            aria-label={t("wardrobe.addPiecesAria")}
            className="h-12 w-12 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90 transition shadow-luxe"
          >
            <Plus size={20} />
          </button>

        </div>
      </header>

      {gapFilter && (
        <div className="mx-6 mt-2 flex items-center justify-between gap-2 rounded-2xl bg-[var(--champagne)]/20 border border-[var(--champagne)]/40 px-4 py-2.5">
          <p className="text-xs">
            {gapFilter === "price"
              ? t("wardrobe.gapFilterPrice", { count: filtered.length })
              : t("wardrobe.gapFilterDate", { count: filtered.length })}
          </p>
          <button
            onClick={() => onClearGapFilter?.()}
            className="shrink-0 text-[10px] uppercase tracking-widest underline text-muted-foreground"
          >{t("wardrobe.showAll")}</button>
        </div>
      )}

      <div className="px-6 -mt-1 flex justify-end">
        <button
          onClick={() => void tidyAllPhotos()}
          disabled={tidying || items.length === 0}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          {tidying ? <Loader2 size={11} className="animate-spin" /> : "🔲"} {t("wardrobe.tidyAllPhotos")}
        </button>
      </div>

      <AddSourceSheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onChoose={(choice) => { setAddSheetOpen(false); go(choice); }}
      />


      {/* Weather / season banner */}
      <div className="mx-6 mt-4 rounded-2xl bg-card border border-border/60 p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{season} · {city ?? t("wardrobe.yourArea")}</p>
          {w ? (
            <p className="font-serif text-xl mt-0.5">
              {Math.round(w.temperature)}° · {wLabel?.label}
            </p>
          ) : (
            <p className="font-serif text-lg mt-0.5 italic text-muted-foreground">{t("wardrobe.weatherUnavailable")}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            {seasonOnly ? t("wardrobe.showingTaggedForSeason", { season: season.toLowerCase() }) : t("wardrobe.showingEveryPiece")}
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
            {seasonOnly ? t("wardrobe.thisSeason") : t("wardrobe.allSeasons")}
          </button>
        </div>
      </div>

      <div className="mx-6 mt-4 flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
        <Search size={15} className="text-muted-foreground" />
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder={t("wardrobe.searchPlaceholder")}
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
          >{c === "All" ? t("wardrobe.allCategory") : c}</button>
        ))}
      </div>

      {(archivedCount > 0 || showArchived) && (
        <button
          onClick={() => { setShowArchived((v) => !v); setShowLoaned(false); }}
          className="mx-6 mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
        >
          {showArchived ? <><X size={11} /> {t("wardrobe.backToCloset")}</> : <><Archive size={11} /> {t("wardrobe.archivedCount", { count: archivedCount })}</>}
        </button>
      )}
      {(loanedCount > 0 || showLoaned) && (
        <button
          onClick={() => { setShowLoaned((v) => !v); setShowArchived(false); }}
          className="mx-6 mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground"
        >
          {showLoaned ? <><X size={11} /> {t("wardrobe.backToCloset")}</> : <><Users size={11} /> {t("wardrobe.loanedCount", { count: loanedCount })}</>}
        </button>
      )}
      {locations.length > 1 && !showArchived && (
        <div className="mx-6 mt-3 flex items-center gap-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar flex-1">
            <button
              onClick={() => setViewLocationId("all")}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-widest ${viewLocationId === "all" ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
            >{t("wardrobe.allCategory")}</button>
            {locations.map((loc) => (
              <button
                key={loc.id}
                onClick={() => setViewLocationId(loc.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-widest ${viewLocationId === loc.id ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{loc.name}</button>
            ))}
          </div>
          <button
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] uppercase tracking-widest border ${selectMode ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground"}`}
          >{selectMode ? t("wardrobe.cancel") : t("wardrobe.select")}</button>
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center mt-20 text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="px-6 mt-16 text-center animate-fade-up">
                    <p className="font-serif text-2xl italic">
            {gapFilter && items.length === 0 ? t("wardrobe.emptyLoadErrorTitle") : gapFilter ? t("wardrobe.emptyGapDoneTitle") : showArchived ? t("wardrobe.emptyArchivedTitle") : items.length === 0 ? t("wardrobe.emptyClosetTitle") : t("wardrobe.emptySeasonTitle", { season: season.toLowerCase() })}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {gapFilter && items.length === 0 ? t("wardrobe.emptyLoadErrorSub") : gapFilter ? (gapFilter === "price" ? t("wardrobe.emptyGapDoneSubPrice") : t("wardrobe.emptyGapDoneSubDate")) : showArchived ? t("wardrobe.emptyArchivedSub") : items.length === 0 ? t("wardrobe.emptyClosetSub") : t("wardrobe.emptySeasonSub")}
          </p>
          {gapFilter && items.length === 0 ? (
            <button
              onClick={() => user && void loadItems(user.id)}
              className="mt-6 h-12 px-6 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs"
            >{t("wardrobe.retry")}</button>
          ) : gapFilter ? (
            <button
              onClick={() => onClearGapFilter?.()}
              className="mt-6 h-12 px-6 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs"
            >{t("wardrobe.backToCloset")}</button>
          ) : items.length === 0 ? (

            <button
              onClick={() => go("add")}
              className="mt-6 h-12 px-6 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs"
            >{t("wardrobe.addAPiece")}</button>
          ) : (
            <button
              onClick={() => setSeasonOnly(false)}
              className="mt-6 h-12 px-6 rounded-full border border-border uppercase tracking-[0.3em] text-xs"
            >{t("wardrobe.showAllSeasons")}</button>
          )}
        </div>
      ) : (
        <div className="px-6 mt-6 grid grid-cols-2 gap-x-3 gap-y-5">
          {filtered.map((it, i) => {
            const src = thumbSrc(it, signed);
            const label = (it.colors?.[0] ?? it.color ?? it.category ?? t("wardrobe.wardrobePieceFallback"));
            const isSelected = selectedIds.has(it.id);
            const isLoaned = Boolean((it as unknown as { active_loan_id?: string | null }).active_loan_id);
            const loan = loansByItemId[it.id];
            return (
            <button
              key={it.id}
              onClick={() => (selectMode ? toggleSelected(it.id) : (() => { setDetail(it); setConfirmDelete(false); })())}
              className="group animate-fade-up text-left"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className={`relative overflow-hidden rounded-[1.25rem] border aspect-[4/5] ${selectMode && isSelected ? "border-foreground border-2" : "border-border/50"}`} style={{ background: "#FFFFFF" }}>
                {src ? (
                  <img
                    src={src} alt={`${it.brand ?? label} piece`}
                    className="h-full w-full object-contain p-1 transition-transform duration-500 group-active:scale-95"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-full w-full animate-pulse" style={{ background: "#EDEDED" }} />
                )}
                {isLoaned && (
                  <span className="absolute top-2 left-2 rounded-full bg-foreground/90 text-background px-2 py-0.5 text-[8px] uppercase tracking-widest">
                    {t("wardrobe.loanedBadge")}
                  </span>
                )}
                {selectMode && (
                  <span className={`absolute top-2 right-2 h-6 w-6 rounded-full border flex items-center justify-center ${isSelected ? "bg-foreground border-foreground" : "bg-background/80 border-border"}`}>
                    {isSelected && <Check size={13} className="text-background" />}
                  </span>
                )}
              </div>
              <div className="px-0.5 mt-1.5">
                <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground truncate">{it.brand ?? it.category}</p>
                <p className="font-serif text-[15px] leading-tight truncate">{[label, it.category].filter(Boolean).join(" ")}</p>
                {showLoaned && loan && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {t("wardrobe.loanedToLabel", { name: loan.borrower_name })} · {new Date(`${loan.loaned_at}T00:00:00`).toLocaleDateString(i18n.language, { month: "short", day: "numeric" })}
                  </p>
                )}
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
              aria-label={t("wardrobe.closeAria")}
            ><X size={16} /></button>
            {!editing && (
              <button
                onClick={openEdit}
                className="absolute top-4 left-16 h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
                aria-label={t("wardrobe.editItemAria")}
              ><Pencil size={16} /></button>
            )}
            {!editing && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="absolute top-4 right-4 h-9 w-9 rounded-full bg-destructive/10 text-destructive flex items-center justify-center active:scale-90"
                aria-label={t("wardrobe.deleteItemAria")}
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
                        🎨 {t("wardrobe.colorHarmonyButton")}
                      </button>
                      <button
                        onClick={() => setAdjustingCrop(true)}
                        className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground active:scale-95"
                      >
                        🔲 {t("wardrobe.adjustCropButton")}
                      </button>
                      <button
                        onClick={removeItemBackground}
                        disabled={removingBg}
                        className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground active:scale-95 disabled:opacity-50"
                      >
                        {removingBg ? <Loader2 size={12} className="animate-spin" /> : "✂️"} {t("wardrobe.removeBackgroundButton")}
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
                      {t("wardrobe.sizeLabel", { size: detail.size })}
                      {(() => {
                        const eq = sizeEquivalences(detail.size, { shoes: isShoeCategory(detail.category) });
                        return eq ? ` — ${eq}` : "";
                      })()}
                    </p>
                  )}
                  {(detail as unknown as { purchase_date?: string | null }).purchase_date && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("wardrobe.purchasedLabel", { date: new Date(`${(detail as unknown as { purchase_date: string }).purchase_date}T00:00:00`).toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" }) })}
                    </p>
                  )}
                  {detail.price != null && (
                    <div className="mt-3 inline-flex items-center rounded-full bg-secondary/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                      {detail.worn_count ? (
                                             <span>{t("wardrobe.perWear", { amount: `${detail.currency ?? "€"}${(detail.price / detail.worn_count).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })}</span>
                      ) : (
                        <span>{t("wardrobe.notWornYet")}</span>
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
                        {t("wardrobe.colorAnalysisItten")}
                      </p>
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <span className="h-8 w-8 rounded-full border border-border" style={{ background: pal.hex }} />
                        <div className="text-left">
                          <p className="text-sm font-medium">{pal.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {neutral ? t("wardrobe.neutral") : nearestWheelName(h)}
                          </p>
                        </div>
                      </div>
                      {neutral ? (
                        <p className="mt-3 text-[11px] text-muted-foreground text-center">
                          {t("wardrobe.neutralDesc")}
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

                {detail.price != null && (() => {
                  const raw = detail as unknown as {
                    current_retail_price?: number | null; current_retail_source?: string | null;
                    historical_retail_price?: number | null; iconicity?: Iconicity | null;
                    purchase_date?: string | null; model?: string | null; bag_size_class?: string | null;
                  };
                  const val = computeItemValuation(
                    {
                      price: detail.price,
                      currentRetailPrice: raw.current_retail_price ?? null,
                      currentRetailSource: (raw.current_retail_source === "import" ? "user" : (raw.current_retail_source as CurrentRetailSource | null)) ?? null,
                      historicalRetailPrice: raw.historical_retail_price ?? null,
                      purchaseDate: raw.purchase_date ?? null,
                      wornCount: detail.worn_count ?? 0,
                      brand: detail.brand ?? null,
                      category: detail.category ?? null,
                      subcategory: (detail as unknown as { subcategory?: string | null }).subcategory ?? null,
                      materials: Array.isArray(detail.material) ? detail.material : [],
                      model: raw.model ?? null,
                      bagSizeClass: raw.bag_size_class ?? null,
                      iconicity: raw.iconicity ?? null,
                    },
                    valuationConfig
                  );
                  const cur = detail.currency ?? "€";
                  const symbol = currencySymbol[cur] ?? cur;
                  const fmtV = (n: number) => `${symbol}${Math.round(n).toLocaleString(i18n.language)}`;
                  return (
                    <div className="mt-5 rounded-2xl border border-border bg-secondary/30 p-4 space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground text-center mb-1">
                        {t("wardrobe.valueSectionTitle")}
                      </p>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t("wardrobe.purchasedValueLabel")}</span>
                        <span>{fmtV(detail.price)}</span>
                      </div>
                      {val.currentRetailPrice != null && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("wardrobe.currentRetailLabel")}</span>
                          <span>{fmtV(val.currentRetailPrice)}</span>
                        </div>
                      )}
                      {val.resaleLow != null && val.resaleHigh != null && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("wardrobe.estimatedResaleLabel")}</span>
                          <span>{fmtV(val.resaleLow)}–{fmtV(val.resaleHigh)}</span>
                        </div>
                      )}
                      {val.resaleChangeVsPurchase != null && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/60">
                          <span>{t("wardrobe.valueChangeLabel")}</span>
                          <span>
                            {val.resaleChangeVsPurchase.amount >= 0 ? "+" : ""}
                            {fmtV(val.resaleChangeVsPurchase.amount)} · {val.resaleChangeVsPurchase.pct >= 0 ? "+" : ""}
                            {Math.round(val.resaleChangeVsPurchase.pct)}%
                          </span>
                        </div>
                      )}
                      {val.marketPremium && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 text-center pt-1">
                          {t("wardrobe.marketPremiumNote")}
                        </p>
                      )}
                      {val.valuationConfidence && (
                        <p className="text-[10px] text-muted-foreground text-center pt-1">
                          {t(`wardrobe.confidence.${val.valuationConfidence}`)}
                        </p>
                      )}
                    </div>
                  );
                })()}

                <button
                  onClick={openEdit}
                  className="mt-5 w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 active:scale-95"
                >
                  <Pencil size={12} /> {t("wardrobe.editDetailsButton")}
                </button>
                <button
                  onClick={() => void toggleArchiveItem(detail, !(detail as unknown as { archived?: boolean }).archived)}
                  className="mt-3 w-full h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 active:scale-95"
                >
                  {(detail as unknown as { archived?: boolean }).archived
                    ? <><ArchiveRestore size={12} /> {t("wardrobe.restoreToCloset")}</>
                    : <><Archive size={12} /> {t("wardrobe.archiveOutOfRotation")}</>}
                </button>
                {(detail as unknown as { active_loan_id?: string | null }).active_loan_id ? (
                  <div className="mt-3 rounded-2xl border border-border bg-secondary/30 p-3 text-center">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.loanedLabel")}</p>
                    <p className="font-serif text-lg mt-1">{loansByItemId[detail.id]?.borrower_name ?? "…"}</p>
                    {loansByItemId[detail.id] && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("wardrobe.loanedSinceLabel", { date: new Date(`${loansByItemId[detail.id].loaned_at}T00:00:00`).toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" }) })}
                      </p>
                    )}
                    <button
                      onClick={() => setReturnPickerOpen(true)}
                      className="mt-3 w-full h-10 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]"
                    >{t("wardrobe.revokeLoanButton")}</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setLoanSheetOpen(true)}
                    className="mt-3 w-full h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 active:scale-95"
                  ><Users size={12} /> {t("wardrobe.lendItemButton")}</button>
                )}
                {locations.length > 1 && (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1.5">{t("wardrobe.keptAt")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {locations.map((loc) => {
                        const current = (detail as unknown as { location_id?: string | null }).location_id ?? null;
                        const on = current === loc.id || (current == null && loc.is_primary);
                        return (
                          <button
                            key={loc.id}
                            onClick={() => void moveDetailItem(loc.id)}
                            className={`rounded-full px-3 py-1.5 text-xs border transition ${on ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}
                          >{loc.name}</button>
                        );
                      })}
                    </div>
                  </div>
                )}
                                            <button
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 w-full h-12 rounded-full border border-destructive/40 text-destructive text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2"
                >
                  <Trash2 size={12} /> {t("wardrobe.deleteItemButton")}
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
                      <p className="font-serif text-lg text-center">{t("wardrobe.deleteConfirmTitle")}</p>
                      <p className="text-xs text-muted-foreground text-center mt-1">{t("wardrobe.cannotBeUndone")}</p>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setConfirmDelete(false)}
                          disabled={deleting}
                          className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                        >{t("wardrobe.cancel")}</button>
                        <button
                          onClick={deleteItem}
                          disabled={deleting}
                          className="h-11 rounded-full bg-destructive text-destructive-foreground text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {deleting && <Loader2 size={12} className="animate-spin" />}
                          {t("wardrobe.deleteButton")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {loanSheetOpen && (
                  <div
                    className="fixed inset-0 z-[80] bg-background/70 backdrop-blur-sm flex items-center justify-center px-6"
                    onClick={() => !lending && setLoanSheetOpen(false)}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="w-full max-w-xs rounded-2xl border border-border bg-card p-5 shadow-luxe"
                    >
                      <p className="font-serif text-lg text-center">{t("wardrobe.lendItemTitle")}</p>
                      <input
                        autoFocus
                        value={borrowerName}
                        onChange={(e) => setBorrowerName(e.target.value)}
                        placeholder={t("wardrobe.borrowerNamePlaceholder")}
                        className="mt-3 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
                      />
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setLoanSheetOpen(false)}
                          disabled={lending}
                          className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                        >{t("wardrobe.cancel")}</button>
                        <button
                          onClick={() => void lendDetailItem()}
                          disabled={lending || !borrowerName.trim()}
                          className="h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {lending && <Loader2 size={12} className="animate-spin" />}
                          {t("wardrobe.confirmLoanButton")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {returnPickerOpen && (
                  <div
                    className="fixed inset-0 z-[80] bg-background/70 backdrop-blur-sm flex items-center justify-center px-6"
                    onClick={() => !returning && setReturnPickerOpen(false)}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="w-full max-w-xs rounded-2xl border border-border bg-card p-5 shadow-luxe"
                    >
                      <p className="font-serif text-lg text-center">{t("wardrobe.revokeLoanTitle")}</p>
                      <p className="text-xs text-muted-foreground text-center mt-1">{t("wardrobe.chooseReturnLocation")}</p>
                      {locations.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
                          {locations.map((loc) => (
                            <button
                              key={loc.id}
                              onClick={() => void returnDetailItem(loc.id)}
                              disabled={returning}
                              className="rounded-full px-3 py-1.5 text-xs border border-border bg-background active:scale-95 disabled:opacity-60"
                            >{loc.name}</button>
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => void returnDetailItem(null)}
                          disabled={returning}
                          className="mt-4 w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {returning && <Loader2 size={12} className="animate-spin" />}
                          {t("wardrobe.confirmReturnButton")}
                        </button>
                      )}
                      <button
                        onClick={() => setReturnPickerOpen(false)}
                        disabled={returning}
                        className="mt-4 w-full h-10 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                      >{t("wardrobe.cancel")}</button>
                    </div>
                  </div>
                )}
              </>
            ) : (

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.brandLabel")}</p>
                  <input
                    value={edit.brand}
                    onChange={(e) => setEdit((s) => ({ ...s, brand: e.target.value }))}
                    placeholder={t("wardrobe.brandLabel")}
                    className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.sizeFieldLabel")}</p>
                  <input
                    value={edit.size}
                    onChange={(e) => setEdit((s) => ({ ...s, size: e.target.value }))}
                    placeholder={t("wardrobe.sizePlaceholder")}
                    className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  {(() => {
                    const eq = sizeEquivalences(edit.size, { shoes: isShoeCategory(edit.category) });
                    return eq ? <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">{eq}</p> : null;
                  })()}
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.categoryLabel")}</p>
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
                  [t("wardrobe.seasonLabel"), SEASON_OPTIONS, edit.seasons, (v: string[]) => setEdit((s) => ({ ...s, seasons: v })), toggleSeasonChip],
                  [t("wardrobe.styleLabel"), STYLE_OPTIONS, edit.styles, (v: string[]) => setEdit((s) => ({ ...s, styles: v })), toggleChip],
                  [t("wardrobe.occasionLabel"), OCCASION_OPTIONS, edit.occasions, (v: string[]) => setEdit((s) => ({ ...s, occasions: v })), toggleChip],
                ] as const).map(([label, opts, values, setter, toggler]) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {opts.map((o) => {
                        const on = values.includes(o);
                        return (
                          <button
                            key={o}
                            onClick={() => toggler(values, setter, o)}
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
                  label={t("wardrobe.materialLabel")}
                  options={MATERIAL_OPTIONS}
                  values={edit.materials}
                  onChange={(v) => setEdit((s) => ({ ...s, materials: v }))}
                />

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.priceLabel")}</p>
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

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.purchaseDateLabel")}</p>
                  <input
                    type="date"
                    value={edit.purchaseDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setEdit((s) => ({ ...s, purchaseDate: e.target.value }))}
                    className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
                  />
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.currentRetailPriceLabel")}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground w-6 text-center">{currencySymbol[edit.currency]}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={edit.currentRetailPrice}
                      onChange={(e) => setEdit((s) => ({ ...s, currentRetailPrice: e.target.value }))}
                      placeholder={t("wardrobe.currentRetailPricePlaceholder")}
                      className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground px-1">{t("wardrobe.currentRetailPriceHint")}</p>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.historicalRetailPriceLabel")}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground w-6 text-center">{currencySymbol[edit.currency]}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={edit.historicalRetailPrice}
                      onChange={(e) => setEdit((s) => ({ ...s, historicalRetailPrice: e.target.value }))}
                      placeholder={t("wardrobe.historicalRetailPricePlaceholder")}
                      className="flex-1 bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground px-1">{t("wardrobe.historicalRetailPriceHint")}</p>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.modelLabel")}</p>
                  <input
                    type="text"
                    value={edit.model}
                    onChange={(e) => setEdit((s) => ({ ...s, model: e.target.value }))}
                    placeholder={t("wardrobe.modelPlaceholder")}
                    className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <p className="mt-1.5 text-[10px] text-muted-foreground px-1">{t("wardrobe.modelHint")}</p>
                </div>

                {edit.category === "Bags" && (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.bagSizeLabel")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["mini", "small", "medium", "large", "jumbo"] as const).map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setEdit((s) => ({ ...s, bagSizeClass: s.bagSizeClass === opt ? "" : opt }))}
                          className={`rounded-full px-3 py-1.5 text-xs ${
                            edit.bagSizeClass === opt ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
                          }`}
                        >{t(`wardrobe.bagSizeOptions.${opt}`)}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("wardrobe.iconicityLabel")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ICONICITY_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setEdit((s) => ({ ...s, iconicity: s.iconicity === opt ? "" : opt }))}
                        className={`rounded-full px-3 py-1.5 text-xs ${
                          edit.iconicity === opt ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"
                        }`}
                      >{t(`wardrobe.iconicityOptions.${opt}`)}</button>
                    ))}
                  </div>
                </div>

                                <div className="grid grid-cols-2 gap-2 pt-2 sticky bottom-24 z-50 bg-card pb-1 rounded-2xl shadow-luxe -mx-1 px-1">
                  <button
                    onClick={() => setEditing(false)}
                    disabled={savingEdit}
                    className="h-11 rounded-full border border-border text-[10px] uppercase tracking-[0.3em]"
                  >{t("wardrobe.cancel")}</button>
                  <button
                    onClick={saveEdit}
                    disabled={savingEdit}
                    className="h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {savingEdit && <Loader2 size={12} className="animate-spin" />}

                    {t("wardrobe.saveButton")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectMode && (
        <div className="fixed bottom-24 left-6 right-6 z-40 rounded-full bg-foreground text-background px-5 py-3 flex items-center justify-between shadow-luxe">
          <span className="text-xs">{t("wardrobe.selectedCount", { count: selectedIds.size })}</span>
          <button
            onClick={() => setBulkMovePicker(true)}
            disabled={selectedIds.size === 0}
            className="h-9 px-4 rounded-full bg-background text-foreground text-[10px] uppercase tracking-[0.25em] disabled:opacity-50"
          >{t("wardrobe.moveToButton")}</button>
        </div>
      )}

      {bulkMovePicker && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end" onClick={() => !movingSelection && setBulkMovePicker(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full bg-card rounded-t-3xl border-t border-border p-5 space-y-2">
            <p className="font-serif italic text-lg">{t("wardrobe.moveSelectionTitle", { count: selectedIds.size })}</p>
            {locations.map((loc) => (
              <button
                key={loc.id}
                onClick={() => void moveSelection(loc.id)}
                disabled={movingSelection}
                className="w-full h-12 rounded-full border border-border text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {movingSelection && <Loader2 size={12} className="animate-spin" />}
                {loc.name}
              </button>
            ))}
            <button
              onClick={() => setBulkMovePicker(false)}
              disabled={movingSelection}
              className="w-full h-11 rounded-full text-[10px] uppercase tracking-[0.3em] text-muted-foreground"
            >{t("wardrobe.cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
