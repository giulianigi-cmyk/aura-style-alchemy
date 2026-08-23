import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadOutfitThumb } from "@/lib/outfit-thumb";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, Save, Trash2, ChevronUp, ChevronDown, Plus, X,
  Loader2, Share2, Download, Copy, Mail, Instagram, Facebook, Music2, MessageCircle,
  Calendar as CalendarIcon,
} from "lucide-react";
import type { BuilderInit, Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { PiecePicker } from "../PiecePicker";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import {
  describeWeather, classifyTemp, weatherLabelKey,
} from "@/lib/weather";
import type { WardrobeItem } from "@/lib/aura-types";
import { resolveWardrobeUrls, toStoragePath, currentSeason, itemMatchesSeason } from "@/lib/wardrobe-image";
import {
  AURA_APP_URL, AURA_SHARE_CAPTION, downloadBlob, dataUrlToBlob,
  nativeShareFile, shareLinks,
} from "@/lib/aura-share";
import { suggestOutfitAI } from "@/lib/ai-suggest-outfit.functions";
import { loadDressRules } from "@/lib/dress-preferences";
import { logWardrobeEvent } from "@/lib/wardrobe-events";
import { resolvePlanSlot } from "@/lib/outfit-plan-slot";
import i18n from "@/i18n/config";

const OCCASIONS = ["Work", "Evening", "Weekend", "Formal", "Travel", "Sport", "Everyday"];

type Ratio = "1:1" | "9:16";
type Placed = {
  key: string;         // instance key (allows duplicates)
  itemId: string;
  imgUrl: string;
  x: number;           // fraction 0-1 of canvas width (center)
  y: number;           // fraction 0-1 of canvas height (center)
  scale: number;       // relative to canvas short side
  rotation: number;    // deg
  z: number;
};

type Bucket = "top" | "bottom" | "dress" | "shoes" | "outer" | "acc";
const LAYOUT_Y: Record<Bucket, number> = { outer: 0.28, top: 0.34, dress: 0.5, bottom: 0.6, shoes: 0.85, acc: 0.45 };
const Z_BY_BUCKET: Record<Bucket, number> = { outer: 2, top: 3, dress: 3, bottom: 2, shoes: 1, acc: 4 };
function bucketOf(it: WardrobeItem): Bucket {
  const c = `${it.category ?? ""} ${it.style ?? ""}`.toLowerCase();
  if (/dress|gown|jumpsuit/.test(c)) return "dress";
  if (/shoe|boot|sneaker|sandal|loafer|heel/.test(c)) return "shoes";
  if (/pant|trouser|jean|short|skirt|bottom/.test(c)) return "bottom";
  if (/coat|jacket|blazer|outerwear/.test(c)) return "outer";
  if (/shirt|top|tee|blouse|knit|sweater/.test(c)) return "top";
  return "acc";
}
function autoPlace(items: WardrobeItem[], signed: Record<string, string>): Placed[] {
  const placed: Placed[] = [];
  items.forEach((it, i) => {
    const path = toStoragePath(it.image_url);
    const url = path ? signed[path] : "";
    if (!url) return;
    const b = bucketOf(it);
    placed.push({
      key: `${it.id}-init-${i}-${Date.now()}`,
      itemId: it.id,
      imgUrl: url,
      x: b === "acc" ? 0.75 : 0.5,
      y: LAYOUT_Y[b],
      scale: b === "shoes" ? 0.28 : b === "acc" ? 0.24 : 0.42,
      rotation: 0,
      z: Z_BY_BUCKET[b] ?? 1,
    });
  });
  return placed;
}

export function OutfitBuilder({ go, init }: { go: (s: Screen) => void; init?: BuilderInit }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { latitude, longitude, city } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);

  const [ratio, setRatio] = useState<Ratio>("1:1");
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [occasion, setOccasion] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [shareState, setShareState] = useState<
    | null
    | { blob: Blob; dataUrl: string; signedUrl: string | null }
  >(null);
    const [shareOpen, setShareOpen] = useState(false);
  const [savedOutfitId, setSavedOutfitId] = useState<string | null>(init?.outfitId ?? null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string>("");

  const canvasRef = useRef<HTMLDivElement>(null);
  const zSeqRef = useRef(1);
  const initAppliedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoading(true);
      const { data } = await (supabase.from("wardrobe_items" as never) as any).select("*").eq("user_id", user.id).eq("archived", false);
      const list = (data ?? []) as WardrobeItem[];
      setItems(list);
      const signedMap = await resolveWardrobeUrls(list);
      setSigned(signedMap);
      setLoading(false);

      // If opened from a saved outfit, place its items on the canvas.
      if (init && !initAppliedRef.current && init.itemIds.length) {
        initAppliedRef.current = true;
        const byId = new Map(list.map((it) => [it.id, it]));
        const picks = init.itemIds
          .map((id) => byId.get(id))
          .filter((it): it is WardrobeItem => Boolean(it));
        const nextPlaced = autoPlace(picks, signedMap);
        if (nextPlaced.length) {
          zSeqRef.current = Math.max(zSeqRef.current, ...nextPlaced.map((p) => p.z)) + 1;
          setPlaced(nextPlaced);
        }
        if (init.name) setName(init.name);
        if (init.occasion) setOccasion(init.occasion);
        if (init.notes) setNotes(init.notes);
      }
    })();
  }, [user, init]);


  const season = useMemo(() => currentSeason(), []);
  const weatherOk = useCallback(
    (it: WardrobeItem) => itemMatchesSeason(it, season),
    [season],
  );

  const currentTemp = weather?.current.temperature ?? null;
  const wDesc = weather ? describeWeather(weather.current.weatherCode, weather.current.isDay) : null;

  const addItem = useCallback((it: WardrobeItem) => {
    const path = toStoragePath(it.image_url);
    const url = path ? signed[path] : null;
    if (!url) { toast.error(t("outfitBuilder.itemNoImage")); return; }
    const key = `${it.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    zSeqRef.current += 1;
    setPlaced((prev) => [
      ...prev,
      { key, itemId: it.id, imgUrl: url, x: 0.5, y: 0.5, scale: 0.42, rotation: 0, z: zSeqRef.current },
    ]);
    setSelectedKey(key);
    setPickerOpen(false);
  }, [signed]);

  const removeSelected = useCallback(() => {
    if (!selectedKey) return;
    setPlaced((p) => p.filter((x) => x.key !== selectedKey));
    setSelectedKey(null);
  }, [selectedKey]);

  // Desktop: Delete / Backspace clears the currently selected canvas item.
  // Skips when focus is in an input/textarea/select so typing isn't hijacked.
  useEffect(() => {
    if (!selectedKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      e.preventDefault();
      removeSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedKey, removeSelected]);

  const bringForward = useCallback(() => {
    if (!selectedKey) return;
    zSeqRef.current += 1;
    setPlaced((p) => p.map((x) => x.key === selectedKey ? { ...x, z: zSeqRef.current } : x));
  }, [selectedKey]);

  const sendBackward = useCallback(() => {
    if (!selectedKey) return;
    setPlaced((p) => {
      const minZ = Math.min(...p.map((x) => x.z), 1) - 1;
      return p.map((x) => x.key === selectedKey ? { ...x, z: minZ } : x);
    });
  }, [selectedKey]);

  // Drag / resize / rotate ------------------------------------------------
  type DragMode = "move" | "resize" | "rotate";
  const dragRef = useRef<{
    mode: DragMode; key: string;
    startX: number; startY: number;
    origX: number; origY: number; origScale: number; origRot: number;
    cx: number; cy: number; // canvas center in screen px
    canvasW: number; canvasH: number;
  } | null>(null);

  const onPointerDown = (mode: DragMode, key: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const item = placed.find((p) => p.key === key);
    if (!item || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSelectedKey(key);
    if (mode === "move") { bringSelectedForward(key); }
    dragRef.current = {
      mode, key,
      startX: e.clientX, startY: e.clientY,
      origX: item.x, origY: item.y, origScale: item.scale, origRot: item.rotation,
      cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
      canvasW: rect.width, canvasH: rect.height,
    };
  };

  const bringSelectedForward = (key: string) => {
    zSeqRef.current += 1;
    const z = zSeqRef.current;
    setPlaced((p) => p.map((x) => x.key === key ? { ...x, z } : x));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === "move") {
      setPlaced((p) => p.map((x) => x.key === d.key ? {
        ...x,
        x: Math.max(0, Math.min(1, d.origX + dx / d.canvasW)),
        y: Math.max(0, Math.min(1, d.origY + dy / d.canvasH)),
      } : x));
    } else if (d.mode === "resize") {
      const startDist = Math.hypot(d.startX - d.cx, d.startY - d.cy);
      const curDist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
      const factor = startDist ? curDist / startDist : 1;
      setPlaced((p) => p.map((x) => x.key === d.key ? {
        ...x, scale: Math.max(0.1, Math.min(1.6, d.origScale * factor)),
      } : x));
    } else if (d.mode === "rotate") {
      const startAng = Math.atan2(d.startY - d.cy, d.startX - d.cx);
      const curAng = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
      const deg = ((curAng - startAng) * 180) / Math.PI;
      setPlaced((p) => p.map((x) => x.key === d.key ? {
        ...x, rotation: d.origRot + deg,
      } : x));
    }
  };

  const onPointerUp = () => { dragRef.current = null; };

  // AI Suggest: call Lovable AI Gateway (google/gemini-2.5-flash) for a coherent outfit.
  const aiSuggest = useCallback(async () => {
    if (!items.length) { toast.error(t("outfitBuilder.addWardrobeItemsFirst")); return; }
    setAiBusy(true);
    setAiExplanation("");
    try {
      const desc = weather ? describeWeather(weather.current.weatherCode, weather.current.isDay).label : null;
            const dressRules = await loadDressRules(user?.id);
      const res = await suggestOutfitAI({
        data: {
          dressRules,
          temperature: weather?.current.temperature ?? null,
          condition: desc,
          occasion: occasion || null,
          items: items.map((it) => ({
            id: it.id,
            category: it.category,
            subcategory: it.subcategory,
            colors: it.colors ?? (it.color ? [it.color] : []),
            style: it.style ? [it.style] : [],
            season: it.season,
            brand: it.brand,
          })),
        },
      });
      if (!res.ok || !res.item_ids.length) {
        toast.error(t("outfitBuilder.aiCouldntCompose"));
        return;
      }
      const byId = new Map(items.map((it) => [it.id, it]));
      const picks = res.item_ids
        .map((id: string) => byId.get(id))
        .filter((it: WardrobeItem | undefined): it is WardrobeItem => Boolean(it));

      const bucketOf = (it: WardrobeItem): "top" | "bottom" | "dress" | "shoes" | "outer" | "acc" => {
        const c = `${it.category ?? ""} ${it.style ?? ""}`.toLowerCase();
        if (/dress|gown|jumpsuit/.test(c)) return "dress";
        if (/shoe|boot|sneaker|sandal|loafer|heel/.test(c)) return "shoes";
        if (/pant|trouser|jean|short|skirt|bottom/.test(c)) return "bottom";
        if (/coat|jacket|blazer|outerwear/.test(c)) return "outer";
        if (/shirt|top|tee|blouse|knit|sweater/.test(c)) return "top";
        return "acc";
      };
      const layoutY = { outer: 0.28, top: 0.34, dress: 0.5, bottom: 0.6, shoes: 0.85, acc: 0.45 };
      const zByBucket = { outer: 2, top: 3, dress: 3, bottom: 2, shoes: 1, acc: 4 };

      const placedNext: Placed[] = [];
      picks.forEach((it: WardrobeItem, i: number) => {
        const path = toStoragePath(it.image_url);
        const url = path ? signed[path] : "";
        if (!url) return;
        const b = bucketOf(it);
        zSeqRef.current += 1;
        placedNext.push({
          key: `${it.id}-ai-${i}-${Date.now()}`,
          itemId: it.id,
          imgUrl: url,
          x: b === "acc" ? 0.75 : 0.5,
          y: layoutY[b],
          scale: b === "shoes" ? 0.28 : b === "acc" ? 0.24 : 0.42,
          rotation: 0,
          z: zByBucket[b] ?? 1,
        });
      });

      if (!placedNext.length) {
        toast.error(t("outfitBuilder.selectedItemsMissingImages"));
        return;
      }
      setPlaced(placedNext);
      setAiExplanation(res.explanation);
      toast.success(t("outfitBuilder.aiOutfitReady"));
    } catch (e) {
      console.error(e);
      toast.error(t("outfitBuilder.aiSuggestFailed"));
    } finally {
      setAiBusy(false);
    }
  }, [items, weather, occasion, signed]);

  // Export & save ---------------------------------------------------------

  /** Fetch a (possibly cross-origin, signed) image URL and inline it as a
   *  data URL. html-to-image's own cross-origin fetch is unreliable with
   *  tokenised/signed URLs (silently drops the image instead of throwing),
   *  so we do the fetch ourselves and hand toPng() a self-contained DOM. */
  async function toDataUrl(url: string): Promise<string> {
    const resp = await fetch(url, { mode: "cors", cache: "no-store" });
    if (!resp.ok) throw new Error(`image fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

    const exportCanvas = useCallback(async (): Promise<{ blob: Blob; dataUrl: string } | null> => {
    if (!canvasRef.current) return null;
    // Deselect any active item first — otherwise its edit handles
    // (delete/rotate/resize toolbar) get baked into the exported PNG.
    // Two animation frames is enough for React to re-render without the
    // selection overlay before we capture the DOM.
    setSelectedKey(null);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    const targetW = ratio === "1:1" ? 1080 : 1080;
    const targetH = ratio === "1:1" ? 1080 : 1920;
    const rect = canvasRef.current.getBoundingClientRect();
    const pixelRatio = targetW / rect.width;

        const imgs = Array.from(canvasRef.current.querySelectorAll<HTMLImageElement>("img[data-item-key]"));
    const originalSrcs = imgs.map((img) => img.src);

    try {
      // The signed URLs on screen were generated when the canvas first
      // loaded — after a long editing/chatting session they can have
      // expired by the time the person finally hits Share, which used to
      // fail silently and produce an image missing whichever pieces had
      // gone stale (e.g. only the shoes showing). Get a FRESH signed URL
      // per item right before export instead of trusting what's on screen.
      let anyFailed = false;
      await Promise.all(
        imgs.map(async (img) => {
          const key = img.dataset.itemKey;
          const placedItem = placed.find((p) => p.key === key);
          const wardrobeItem = placedItem ? items.find((i) => i.id === placedItem.itemId) : null;
          const path = wardrobeItem ? toStoragePath(wardrobeItem.image_url) : null;

          let freshUrl: string | null = null;
          if (path) {
            const { data } = await supabase.storage.from("wardrobe").createSignedUrl(path, 300);
            freshUrl = data?.signedUrl ?? null;
          }

          try {
            const dataUrl = await toDataUrl(freshUrl ?? img.src);
            img.src = dataUrl;
            await new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            });
          } catch (e) {
            console.error("[AURA export] failed to inline image", img.src, e);
            anyFailed = true;
          }
        }),
      );

      if (anyFailed) {
        toast.error(t("outfitBuilder.couldntLoadPieceForShare"));
        return null;
      }

      const dataUrl = await toPng(canvasRef.current, {
        pixelRatio,
        width: rect.width,
        height: rect.height,
        canvasWidth: targetW,
        canvasHeight: targetH,
        backgroundColor: "#FFFFFF",
      });
      const blob = dataUrlToBlob(dataUrl);
      return { blob, dataUrl };
    } catch (e) {
      console.error("[AURA] export", e);
      toast.error(t("outfitBuilder.couldntExportCanvas"));
      return null;
    } finally {
      // Restore original signed URLs so the live canvas keeps working
      // normally (drag/resize/rotate) after export.
      imgs.forEach((img, i) => { img.src = originalSrcs[i]; });
    }
  }, [ratio, placed, items]);


  const save = useCallback(async () => {
    if (!user) return;
    if (!placed.length) { toast.error(t("outfitBuilder.addAtLeastOneItem")); return; }
    setSaving(true);
    try {
      const exported = await exportCanvas();
      if (!exported) return;
      const path = `${user.id}/outfit-${Date.now()}.png`;
      const up = await supabase.storage.from("outfits").upload(path, exported.blob, {
        contentType: "image/png",
        upsert: false,
        cacheControl: "3600",
      });
      if (up.error) throw up.error;

      // Small JPEG used by gallery views (chat outfit picker). Best-effort:
      // a failed thumbnail never blocks saving the outfit.
      const thumbPath = await uploadOutfitThumb(user.id, exported.dataUrl);

      const seasonTag = weather ? [season] : [];
      const payload = {
        name: name.trim() || t("outfitBuilder.defaultOutfitName", { date: new Date().toLocaleDateString(i18n.language) }),
        item_ids: placed.map((p) => p.itemId),
        canvas_image_url: path,
        thumbnail_path: thumbPath,
        occasion: occasion ? [occasion] : [],
        season: seasonTag,
        notes: notes.trim() || null,
      };
            const { data: savedRow, error } = init?.outfitId
        ? await supabase.from("outfits").update(payload).eq("id", init.outfitId).eq("user_id", user.id).select("id").single()
        : await supabase.from("outfits").insert({ user_id: user.id, ...payload }).select("id").single();
      if (error) throw error;
      setSavedOutfitId((savedRow as { id: string } | null)?.id ?? init?.outfitId ?? null);

      const signedUrl = (await supabase.storage.from("outfits")
        .createSignedUrl(path, 60 * 60 * 24 * 7)).data?.signedUrl ?? null;
      setShareState({ blob: exported.blob, dataUrl: exported.dataUrl, signedUrl });
      // Save no longer forces the share sheet open — the user opens it
      // explicitly via the "Share" button once they're ready.
      toast.success(init?.outfitId ? t("outfitBuilder.toastOutfitUpdated") : t("outfitBuilder.toastOutfitSaved"));
    } catch (e: unknown) {
      console.error("[AURA] save outfit", e);
      toast.error(e instanceof Error ? e.message : t("outfitBuilder.toastSaveFailed"));
    } finally {
      setSaving(false);
    }
    }, [user, placed, exportCanvas, name, occasion, notes, season, weather, init]);

  const addToCalendar = async () => {
    if (!user || !placed.length) return;
    setAddingToCalendar(true);
    try {
      // Builder "add to calendar" has no event context: general slot.
      const { data, error } = await supabase.from("outfit_plans").upsert({
        user_id: user.id,
        date: calendarDate,
        item_ids: placed.map((p) => p.itemId),
        occasion: occasion || null,
        notes: notes.trim() || name.trim() || null,
        status: "planned",
        calendar_event_id: null,
      } as never, { onConflict: resolvePlanSlot({}).onConflict }).select("id").single();
      if (error) throw error;
      const { error: eventErr } = await logWardrobeEvent({
        userId: user.id,
        eventType: "planned",
        date: calendarDate,
        itemIds: placed.map((p) => p.itemId),
        outfitPlanId: (data as { id: string }).id,
        outfitId: savedOutfitId,
        occasion: occasion || null,
        notes: notes.trim() || name.trim() || null,
      });
      if (eventErr) console.error("[AURA wardrobe-events] log failed", eventErr);
      toast.success(t("outfitBuilder.toastAddedToCalendar"));
      setCalendarOpen(false);
    } catch (e) {
      console.error("[AURA] add to calendar", e);
      toast.error(e instanceof Error ? e.message : t("outfitBuilder.toastCouldntAddToCalendar"));
    } finally {
      setAddingToCalendar(false);
    }
  };



  const doNativeShare = async () => {
    if (!shareState) return;
    const file = new File([shareState.blob], "aura-outfit.png", { type: "image/png" });
    const ok = await nativeShareFile(file, AURA_SHARE_CAPTION);
    if (!ok) toast.message(t("outfitBuilder.nativeShareNotAvailable"));
  };

  /** WhatsApp's wa.me links can only pre-fill TEXT, never attach an image
   *  file — that's a hard limitation of that API, not something a URL
   *  tweak can fix. So we try the native OS share sheet first (it lists
   *  WhatsApp as an option and attaches the real image); only if that's
   *  unsupported (e.g. some desktop browsers) do we fall back to a
   *  plain wa.me text link. */
  const shareToWhatsApp = async () => {
    if (!shareState) return;
    const file = new File([shareState.blob], "aura-outfit.png", { type: "image/png" });
    const ok = await nativeShareFile(file, AURA_SHARE_CAPTION);
    if (!ok) {
      window.open(shareLinks(shareState.signedUrl ?? AURA_APP_URL, AURA_SHARE_CAPTION).whatsapp, "_blank");
    }
  };

  const copyLink = async () => {
    if (!shareState?.signedUrl) { toast.error(t("outfitBuilder.noShareableLinkYet")); return; }
    try {
      await navigator.clipboard.writeText(`${AURA_SHARE_CAPTION}\n${shareState.signedUrl}`);
      toast.success(t("outfitBuilder.linkCopied"));
    } catch {
      toast.error(t("outfitBuilder.copyFailed"));
    }
  };

  // Item filter for picker
  const eligibleForWeather = weather ? items.filter(weatherOk) : items;
  const [pickerFilter, setPickerFilter] = useState<"all" | "weather">("all");
  const pickerItems = pickerFilter === "weather" ? eligibleForWeather : items;

  const aspect = ratio === "1:1" ? "aspect-square" : "aspect-[9/16]";

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("planner")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("outfitBuilder.title")}</p>
        <button
          onClick={() => go("saved-outfits")}
          className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground"
        >{t("outfitBuilder.saved")}</button>
      </header>

      {/* Weather */}
      {weather && wDesc && (
        <div className="mx-6 mt-2 rounded-2xl bg-card border border-border/60 px-4 py-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">{wDesc.icon}</span>
            <div>
              <p className="font-serif text-lg leading-none">{Math.round(weather.current.temperature)}° {t(weatherLabelKey(weather.current.weatherCode))}</p>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{city ?? t("outfitBuilder.today")} · {classifyTemp(weather.current.temperature)}</p>
            </div>
          </div>
          <button
            onClick={aiSuggest}
            disabled={aiBusy || loading}
            className="h-9 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-95 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {t("outfitBuilder.aiSuggest")}
          </button>
        </div>
      )}
      {aiExplanation && (
        <p className="mx-6 mt-2 text-xs text-muted-foreground italic leading-relaxed">
          {aiExplanation}
        </p>
      )}

      {/* Ratio + occasion */}
      <div className="mx-6 mt-3 flex items-center justify-between gap-2">
        
