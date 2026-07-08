import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, Save, Trash2, ChevronUp, ChevronDown, Plus,
  Loader2, Share2, Download, Copy, Mail, Instagram, Facebook, Music2, MessageCircle,
} from "lucide-react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import {
  describeWeather, classifyTemp, suggestOutfit,
} from "@/lib/weather";
import type { WardrobeItem } from "@/lib/aura-types";
import { resolveWardrobeUrls, toStoragePath, currentSeason, itemMatchesSeason } from "@/lib/wardrobe-image";
import {
  AURA_APP_URL, AURA_SHARE_CAPTION, downloadBlob, dataUrlToBlob,
  nativeShareFile, shareLinks,
} from "@/lib/aura-share";

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

export function OutfitBuilder({ go }: { go: (s: Screen) => void }) {
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
  const [aiBusy, setAiBusy] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const zSeqRef = useRef(1);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoading(true);
      const { data } = await supabase.from("wardrobe_items").select("*").eq("user_id", user.id);
      const list = (data ?? []) as WardrobeItem[];
      setItems(list);
      setSigned(await resolveWardrobeUrls(list));
      setLoading(false);
    })();
  }, [user]);

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
    if (!url) { toast.error("This item has no image yet"); return; }
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

  // AI Suggest: pick 1 top, 1 bottom or dress, 1 shoes ---------------------
  const aiSuggest = useCallback(() => {
    if (!items.length) { toast.error("Add wardrobe items first"); return; }
    setAiBusy(true);
    try {
      const wxSug = weather ? suggestOutfit(weather.current) : null;
      const eligible = weather ? items.filter(weatherOk) : items;
      const src = eligible.length >= 3 ? eligible : items;

      const bucketOf = (it: WardrobeItem): "top" | "bottom" | "dress" | "shoes" | null => {
        const c = `${it.category ?? ""} ${it.style ?? ""}`.toLowerCase();
        if (/dress|gown|jumpsuit/.test(c)) return "dress";
        if (/shoe|boot|sneaker|sandal|loafer|heel/.test(c)) return "shoes";
        if (/pant|trouser|jean|short|skirt|bottom/.test(c)) return "bottom";
        if (/shirt|top|tee|blouse|knit|sweater|jacket|coat|blazer|outerwear/.test(c)) return "top";
        return null;
      };
      const kwScore = (it: WardrobeItem): number => {
        if (!wxSug) return 0;
        const hay = `${it.category ?? ""} ${it.style ?? ""} ${it.season ?? ""}`.toLowerCase();
        return wxSug.categories.reduce((n, k) => n + (hay.includes(k) ? 1 : 0), 0);
      };

      const buckets: Record<string, WardrobeItem[]> = { top: [], bottom: [], dress: [], shoes: [] };
      src.forEach((it) => { const b = bucketOf(it); if (b) buckets[b].push(it); });
      Object.values(buckets).forEach((arr) => arr.sort((a, b) => kwScore(b) - kwScore(a)));

      const picks: WardrobeItem[] = [];
      if (buckets.dress.length && (!buckets.top.length || !buckets.bottom.length)) {
        picks.push(buckets.dress[0]);
      } else {
        if (buckets.top[0]) picks.push(buckets.top[0]);
        if (buckets.bottom[0]) picks.push(buckets.bottom[0]);
      }
      if (buckets.shoes[0]) picks.push(buckets.shoes[0]);
      if (!picks.length) { picks.push(...src.slice(0, 3)); }

      // Clear current layout and place picks
      const zs = { top: 3, dress: 3, bottom: 2, shoes: 1 };
      const layoutY = { top: 0.32, dress: 0.5, bottom: 0.62, shoes: 0.85 };
      setPlaced(picks.map((it, i) => {
        const b = bucketOf(it) ?? "top";
        const path = toStoragePath(it.image_url);
        const url = path ? signed[path] : "";
        zSeqRef.current += 1;
        return {
          key: `${it.id}-ai-${i}-${Date.now()}`,
          itemId: it.id, imgUrl: url,
          x: 0.5, y: layoutY[b as keyof typeof layoutY] ?? 0.5,
          scale: b === "shoes" ? 0.28 : 0.42,
          rotation: 0,
          z: zs[b as keyof typeof zs] ?? 1,
        };
      }));
      toast.success("Starter outfit added — tweak away");
    } finally {
      setAiBusy(false);
    }
  }, [items, weather, weatherOk, signed]);

  // Export & save ---------------------------------------------------------
  const exportCanvas = useCallback(async (): Promise<{ blob: Blob; dataUrl: string } | null> => {
    if (!canvasRef.current) return null;
    const targetW = ratio === "1:1" ? 1080 : 1080;
    const targetH = ratio === "1:1" ? 1080 : 1920;
    const rect = canvasRef.current.getBoundingClientRect();
    const pixelRatio = targetW / rect.width;
    try {
      const dataUrl = await toPng(canvasRef.current, {
        pixelRatio,
        cacheBust: true,
        width: rect.width,
        height: rect.height,
        canvasWidth: targetW,
        canvasHeight: targetH,
        backgroundColor: "#F5F5F5",
      });
      const blob = dataUrlToBlob(dataUrl);
      return { blob, dataUrl };
    } catch (e) {
      console.error("[AURA] export", e);
      toast.error("Couldn't export the canvas");
      return null;
    }
  }, [ratio]);

  const save = useCallback(async () => {
    if (!user) return;
    if (!placed.length) { toast.error("Add at least one item"); return; }
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

      const seasonTag = weather ? [season] : [];
      const { error } = await supabase.from("outfits").insert({
        user_id: user.id,
        name: name.trim() || `Outfit ${new Date().toLocaleDateString()}`,
        item_ids: placed.map((p) => p.itemId),
        canvas_image_url: path,
        occasion: occasion ? [occasion] : [],
        season: seasonTag,
        notes: notes.trim() || null,
      });
      if (error) throw error;

      const signedUrl = (await supabase.storage.from("outfits")
        .createSignedUrl(path, 60 * 60 * 24 * 7)).data?.signedUrl ?? null;
      setShareState({ blob: exported.blob, dataUrl: exported.dataUrl, signedUrl });
      toast.success("Outfit saved");
    } catch (e: unknown) {
      console.error("[AURA] save outfit", e);
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [user, placed, exportCanvas, name, occasion, notes, season, weather]);

  const doNativeShare = async () => {
    if (!shareState) return;
    const file = new File([shareState.blob], "aura-outfit.png", { type: "image/png" });
    const ok = await nativeShareFile(file, AURA_SHARE_CAPTION);
    if (!ok) toast.message("Native share not available — use the buttons below");
  };

  const copyLink = async () => {
    if (!shareState?.signedUrl) { toast.error("No shareable link yet"); return; }
    try {
      await navigator.clipboard.writeText(`${AURA_SHARE_CAPTION}\n${shareState.signedUrl}`);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed");
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
        <p className="font-serif text-lg italic">Outfit builder</p>
        <button
          onClick={() => go("saved-outfits")}
          className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground"
        >Saved</button>
      </header>

      {/* Weather */}
      {weather && wDesc && (
        <div className="mx-6 mt-2 rounded-2xl bg-card border border-border/60 px-4 py-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">{wDesc.icon}</span>
            <div>
              <p className="font-serif text-lg leading-none">{Math.round(weather.current.temperature)}° {wDesc.label}</p>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{city ?? "Today"} · {classifyTemp(weather.current.temperature)}</p>
            </div>
          </div>
          <button
            onClick={aiSuggest}
            disabled={aiBusy || loading}
            className="h-9 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-95 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            AI suggest
          </button>
        </div>
      )}

      {/* Ratio + occasion */}
      <div className="mx-6 mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full bg-secondary/60 p-1">
          {(["1:1", "9:16"] as Ratio[]).map((r) => (
            <button
              key={r}
              onClick={() => setRatio(r)}
              className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-[0.25em] ${
                ratio === r ? "bg-foreground text-background" : "text-foreground/70"
              }`}
            >{r === "1:1" ? "Feed 1:1" : "Story 9:16"}</button>
          ))}
        </div>
        <select
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
          className="h-9 px-3 rounded-full bg-secondary/60 text-[10px] uppercase tracking-[0.25em] border-none outline-none"
        >
          <option value="">Occasion</option>
          {OCCASIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      {/* Canvas */}
      <div className="mx-4 mt-4">
        <div
          ref={canvasRef}
          onClick={() => setSelectedKey(null)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`relative w-full ${aspect} rounded-2xl overflow-hidden shadow-soft select-none touch-none`}
          style={{ background: "#F5F5F5" }}
        >
          {placed
            .slice()
            .sort((a, b) => a.z - b.z)
            .map((p) => {
              const isSel = p.key === selectedKey;
              const short = 100; // in cqmin — use padding trick with % of container
              return (
                <div
                  key={p.key}
                  className="absolute"
                  style={{
                    left: `${p.x * 100}%`,
                    top: `${p.y * 100}%`,
                    width: `${p.scale * short}%`,
                    transform: `translate(-50%, -50%) rotate(${p.rotation}deg)`,
                    zIndex: p.z,
                  }}
                  onPointerDown={onPointerDown("move", p.key)}
                >
                  <img
                    src={p.imgUrl}
                    alt=""
                    draggable={false}
                    className="w-full h-auto pointer-events-none"
                    crossOrigin="anonymous"
                    style={{ display: "block" }}
                  />
                  {isSel && (
                    <>
                      <div className="absolute inset-0 border-2 border-dashed border-foreground/60 pointer-events-none" />
                      {/* resize handle */}
                      <button
                        onPointerDown={onPointerDown("resize", p.key)}
                        aria-label="Resize"
                        className="absolute -right-3 -bottom-3 h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center text-[10px] shadow-md"
                      >↘</button>
                      {/* rotate handle */}
                      <button
                        onPointerDown={onPointerDown("rotate", p.key)}
                        aria-label="Rotate"
                        className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center text-[10px] shadow-md"
                      >⟳</button>
                      {/* delete */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setPlaced((arr) => arr.filter((x) => x.key !== p.key)); setSelectedKey(null); }}
                        aria-label="Remove"
                        className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-background border border-border flex items-center justify-center shadow-md"
                      ><Trash2 size={11} /></button>
                    </>
                  )}
                </div>
              );
            })}

          {/* AURA watermark */}
          <div className="absolute bottom-3 right-4 pointer-events-none select-none">
            <span
              className="font-serif italic tracking-[0.4em] text-black/70"
              style={{ fontSize: "clamp(10px, 2.2cqmin, 22px)" }}
            >AURA</span>
          </div>

          {placed.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-center px-8">
              <p className="text-muted-foreground text-sm">
                Add items from your wardrobe to start composing.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="mx-6 mt-3 grid grid-cols-4 gap-2">
        <button onClick={() => setPickerOpen(true)} className="h-11 rounded-2xl bg-foreground text-background inline-flex items-center justify-center gap-1 text-[10px] uppercase tracking-[0.25em]">
          <Plus size={12} /> Add
        </button>
        <button onClick={bringForward} disabled={!selectedKey} className="h-11 rounded-2xl border border-border inline-flex items-center justify-center gap-1 text-[10px] uppercase tracking-[0.25em] disabled:opacity-40">
          <ChevronUp size={12} /> Front
        </button>
        <button onClick={sendBackward} disabled={!selectedKey} className="h-11 rounded-2xl border border-border inline-flex items-center justify-center gap-1 text-[10px] uppercase tracking-[0.25em] disabled:opacity-40">
          <ChevronDown size={12} /> Back
        </button>
        <button onClick={removeSelected} disabled={!selectedKey} className="h-11 rounded-2xl border border-border inline-flex items-center justify-center gap-1 text-[10px] uppercase tracking-[0.25em] disabled:opacity-40">
          <Trash2 size={12} /> Del
        </button>
      </div>

      {/* Name / notes / save */}
      <div className="mx-6 mt-3 space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Outfit name"
          className="w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full bg-secondary/60 rounded-2xl px-4 py-2.5 text-sm outline-none resize-none"
        />
        <button
          onClick={save}
          disabled={saving || loading || !placed.length}
          className="w-full h-12 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save outfit
        </button>
      </div>

      {/* Item picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end" onClick={() => setPickerOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-h-[75%] bg-card rounded-t-3xl border-t border-border p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="font-serif italic text-lg">Add from closet</p>
              <div className="flex gap-1 rounded-full bg-secondary/60 p-1">
                {(["all", "weather"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setPickerFilter(f)}
                    className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.25em] ${pickerFilter === f ? "bg-foreground text-background" : "text-foreground/70"}`}
                  >{f === "all" ? "All" : `For ${season}`}</button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="py-10 flex justify-center"><Loader2 className="animate-spin" /></div>
            ) : pickerItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No items match this filter.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {pickerItems.map((it) => {
                  const path = toStoragePath(it.image_url);
                  const url = path ? signed[path] : null;
                  const ok = weatherOk(it);
                  return (
                    <button key={it.id} onClick={() => addItem(it)} className="relative aspect-square rounded-xl overflow-hidden active:scale-95" style={{ background: "#FFFFFF" }}>
                      {url ? <img src={url} alt="" className="h-full w-full object-contain p-2" /> : <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">No image</div>}
                      {weather && ok && (
                        <span className="absolute top-1 right-1 text-[8px] uppercase tracking-widest bg-foreground/90 text-background px-1.5 py-0.5 rounded-full">Today</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share sheet */}
      {shareState && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end" onClick={() => setShareState(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full bg-card rounded-t-3xl border-t border-border p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="font-serif italic text-lg">Share your look</p>
              <button className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground" onClick={() => setShareState(null)}>Close</button>
            </div>
            <img src={shareState.dataUrl} alt="preview" className="max-h-40 w-auto mx-auto rounded-xl mb-4" />
            <div className="grid grid-cols-4 gap-3">
              <ShareBtn icon={<Share2 size={16} />} label="Share" onClick={doNativeShare} />
              <ShareBtn icon={<Download size={16} />} label="Save" onClick={() => downloadBlob(shareState.blob, "aura-outfit.png")} />
              <ShareBtn icon={<Copy size={16} />} label="Copy link" onClick={copyLink} />
              <ShareBtn icon={<MessageCircle size={16} />} label="WhatsApp" onClick={() => window.open(shareLinks(shareState.signedUrl ?? AURA_APP_URL, AURA_SHARE_CAPTION).whatsapp, "_blank")} />
              <ShareBtn icon={<Instagram size={16} />} label="Instagram" onClick={() => {
                downloadBlob(shareState.blob, "aura-outfit.png");
                window.location.href = shareLinks("", "").instagram;
              }} />
              <ShareBtn icon={<Music2 size={16} />} label="TikTok" onClick={() => {
                downloadBlob(shareState.blob, "aura-outfit.png");
                window.location.href = shareLinks("", "").tiktok;
              }} />
              <ShareBtn icon={<Facebook size={16} />} label="Facebook" onClick={() => window.open(shareLinks(shareState.signedUrl ?? AURA_APP_URL, AURA_SHARE_CAPTION).facebook, "_blank")} />
              <ShareBtn icon={<Mail size={16} />} label="Email" onClick={() => window.location.href = shareLinks(shareState.signedUrl ?? AURA_APP_URL, AURA_SHARE_CAPTION).email} />
            </div>
            <p className="mt-4 text-[10px] text-center text-muted-foreground tracking-widest uppercase">
              Instagram &amp; TikTok require pasting from your camera roll
            </p>
          </div>
        </div>
      )}

      {currentTemp === null && !weather && (
        <p className="mx-6 mt-3 text-[11px] text-muted-foreground">
          Enable location in Calendar to see today&apos;s weather and matching items.
        </p>
      )}
    </div>
  );
}

function ShareBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 active:scale-95">
      <span className="h-12 w-12 rounded-full bg-secondary/60 flex items-center justify-center">{icon}</span>
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</span>
    </button>
  );
}
