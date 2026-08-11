import { Copy, Loader2, Share2, Sparkles, Search, Calendar as CalendarIcon, Trash2, Check, X, Archive, ArchiveRestore, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { BuilderInit, Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import type { Outfit, WardrobeItem } from "@/lib/aura-types";
import { useAuth } from "@/hooks/use-auth";
import { ShareOutfitSheet } from "../ShareOutfitSheet";
import { useLocation } from "@/hooks/use-location";
import { useWeather } from "@/hooks/use-weather";
import { describeWeather } from "@/lib/weather";
import { suggestOutfitAI } from "@/lib/ai-suggest-outfit.functions";
import { generateWeeklyOutfits } from "@/lib/weekly-outfits.functions";
import { listLocations } from "@/lib/wardrobe-locations.functions";
import type { WardrobeLocation } from "@/lib/wardrobe-location";
import { loadDressRules } from "@/lib/dress-preferences";
import { logWardrobeEvent, confirmOutfitPlanWorn } from "@/lib/wardrobe-events";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { ITEM_CATEGORIES } from "@/lib/wardrobe-options";
const OCCASIONS = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"];

type OutfitPlan = {
  id: string; date: string; item_ids: string[]; occasion: string | null;
  notes: string | null; status: string; weather_temp: number | null; weather_condition: string | null;
  calendar_event_id?: string | null;
};

type WornEntry = {
  eventId: string; date: string; itemIds: string[]; outfitName: string | null; occasion: string | null;
};
type CalEvent = { id: string; title: string | null; start_time: string; all_day: boolean };

type OutfitTab = "upcoming" | "worn" | "saved" | "archive";

const todayIso = () => new Date().toISOString().slice(0, 10);

/** The Stylist tab: outfit creation, and now the full home for "what do
 *  I have and what has it meant to me" — Today's Look, catching up on
 *  unconfirmed past plans, and the four-way outfit library (Upcoming,
 *  Worn, Saved, Archive). Deliberately distinct from the Calendar tab:
 *  Calendar answers "when do I wear this", this tab answers "what do I
 *  have". Reuses wardrobe_events / outfit_plans / outfits as-is — no new
 *  tables, this is an interface consolidating data that already existed
 *  across three separate screens.
 */
export function AIStylist({ go, openBuilder }: { go: (s: Screen) => void; openBuilder: (init: BuilderInit) => void }) {
  const { user } = useAuth();
  const { latitude, longitude } = useLocation();
  const { data: weather } = useWeather(latitude, longitude);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [itemSigned, setItemSigned] = useState<Record<string, string>>({});
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<OutfitPlan[]>([]);
  const [wornEntries, setWornEntries] = useState<WornEntry[]>([]);
  const [todayCalEvents, setTodayCalEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [occasion, setOccasion] = useState<string>("Everyday");
  const [aiBusy, setAiBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<Outfit | null>(null);
  const [assignDate, setAssignDate] = useState<string>(() => todayIso());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [outfitTab, setOutfitTab] = useState<OutfitTab>("upcoming");
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null);
  const [editedItems, setEditedItems] = useState<Record<string, string[]>>({});
  const [pickerForPlan, setPickerForPlan] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerCat, setPickerCat] = useState("All");
  const [locations, setLocations] = useState<WardrobeLocation[]>([]);
  const [weeklySheetOpen, setWeeklySheetOpen] = useState(false);
  const [weeklyDays, setWeeklyDays] = useState<7 | 14>(7);
  const [weeklyLocationId, setWeeklyLocationId] = useState<string | null>(null);
  const [weeklyGenerating, setWeeklyGenerating] = useState(false);
  const [weeklyResult, setWeeklyResult] = useState<{ created: number; skippedExisting: number; failed: number } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const today = todayIso();
    const [{ data: i }, { data: o }, { data: pl }, { data: ev }, { data: cal }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("outfits").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("outfit_plans").select("*").eq("user_id", user.id).order("date"),
      (supabase.from("wardrobe_events" as never) as any)
        .select("id, event_date, occasion, outfit_id")
        .eq("user_id", user.id).eq("event_type", "worn")
        .order("event_date", { ascending: false }).limit(30),
      (supabase.from("calendar_events_cache" as never) as any)
        .select("id, title, start_time, all_day")
        .eq("user_id", user.id)
        .gte("start_time", `${today}T00:00:00`).lt("start_time", `${today}T23:59:59`),
    ]);

    const itemList = (i ?? []) as WardrobeItem[];
    setItems(itemList);
    setItemSigned(await resolveWardrobeUrls(itemList));

    const olist = (o ?? []) as Outfit[];
    setOutfits(olist);
    const paths = olist.map((x) => x.canvas_image_url).filter(Boolean) as string[];
    if (paths.length) {
      const { data: urls } = await supabase.storage.from("outfits").createSignedUrls(paths, 60 * 60);
      const map: Record<string, string> = {};
      urls?.forEach((r, idx) => { if (r.signedUrl) map[paths[idx]] = r.signedUrl; });
      setSigned(map);
    } else {
      setSigned({});
    }

    setPlans((pl ?? []) as OutfitPlan[]);
    setTodayCalEvents((cal ?? []) as CalEvent[]);

    const wornEvents = (ev ?? []) as { id: string; event_date: string; occasion: string | null; outfit_id: string | null }[];
    if (wornEvents.length) {
      const { data: evItems } = await (supabase.from("wardrobe_event_items" as never) as any)
        .select("event_id, item_id").in("event_id", wornEvents.map((e) => e.id));
      const itemsByEvent = new Map<string, string[]>();
      (evItems ?? []).forEach((r: { event_id: string; item_id: string }) => {
        const arr = itemsByEvent.get(r.event_id) ?? [];
        arr.push(r.item_id);
        itemsByEvent.set(r.event_id, arr);
      });
      const outfitNameById = new Map(olist.map((x) => [x.id, x.name]));
      setWornEntries(wornEvents.map((e) => ({
        eventId: e.id,
        date: e.event_date,
        itemIds: itemsByEvent.get(e.id) ?? [],
        outfitName: e.outfit_id ? outfitNameById.get(e.outfit_id) ?? null : null,
        occasion: e.occasion,
      })).filter((w) => w.itemIds.length > 0));
    } else {
      setWornEntries([]);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    listLocations()
      .then((res) => { setLocations(res.locations); setWeeklyLocationId(res.activeLocationId); })
      .catch((e) => console.error("[AURA stylist] locations load failed", e));
  }, []);

  const aiPick = async () => {
    const activeItems = items.filter((it) => !(it as unknown as { archived?: boolean }).archived);
    if (activeItems.length < 3) {
      toast.error(`You have ${activeItems.length} piece${activeItems.length === 1 ? "" : "s"} in your active wardrobe — add at least 3 (or restore an archived one) to generate an AI outfit.`);
      return;
    }
    const categories = Array.from(new Set(activeItems.map((it) => it.category).filter(Boolean)));
    if (categories.length < 2) {
      toast.error(
        categories.length === 0
          ? "None of your pieces have a category set. Edit your items and assign a category (Tops, Bottoms, Shoes…) so AURA can compose an outfit."
          : `All your pieces are tagged "${categories[0]}". Add at least one item from another category (e.g. Bottoms or Shoes) to unlock AI suggestions.`
      );
      return;
    }
    setAiBusy(true);
    try {
      const desc = weather ? describeWeather(weather.current.weatherCode, weather.current.isDay).label : null;
      const dressRules = await loadDressRules(user?.id);
      const res = await suggestOutfitAI({
        data: {
          dressRules,
          temperature: weather?.current.temperature ?? null,
          condition: desc,
          occasion,
          items: activeItems.map((it) => ({
            id: it.id,
            category: it.category,
            subcategory: it.subcategory,
            colors: it.colors ?? (it.color ? [it.color] : []),
            style: it.style ? (Array.isArray(it.style) ? it.style : [it.style]) : [],
            season: it.season,
            brand: it.brand,
            material: it.material ?? [],
            locationId: (it as unknown as { location_id?: string | null }).location_id ?? null,
          })),
        },
      });

      if (!res.ok) {
        toast.error(res.error || "AI suggestion failed — please try again.");
        return;
      }
      if (!res.item_ids.length) {
        toast.error("Not enough matching pieces in your wardrobe yet for a complete outfit — try adding more items.");
        return;
      }
      openBuilder({
        itemIds: res.item_ids,
        name: "AI styled look",
        occasion,
        notes: res.explanation || undefined,
      });
    } catch (e) {
      console.error(e);
      toast.error("AI suggest failed");
    } finally {
      setAiBusy(false);
    }
  };

  const runWeeklyGeneration = async () => {
    if (!user) return;
    setWeeklyGenerating(true);
    setWeeklyResult(null);
    try {
      const start = new Date();
      start.setDate(start.getDate() + 1); // start tomorrow — today is handled by Today's Look already
      const startDate = start.toISOString().slice(0, 10);

      const dailyWeather = (weather?.daily ?? [])
        .filter((d) => d.date >= startDate)
        .slice(0, weeklyDays)
        .map((d) => ({ date: d.date, tempMin: d.tempMin, tempMax: d.tempMax, weatherCode: d.weatherCode }));

      const res = await generateWeeklyOutfits({
        data: { startDate, numDays: weeklyDays, locationId: weeklyLocationId, dailyWeather },
      });
      setWeeklyResult({ created: res.created, skippedExisting: res.skippedExisting, failed: res.failed.length });
      if (res.created > 0) void load();
    } catch (e) {
      console.error("[AURA weekly-outfits]", e);
      toast.error(e instanceof Error ? e.message : "Couldn't generate work outfits");
    } finally {
      setWeeklyGenerating(false);
    }
  };

  const savedOutfits = outfits.filter((o) => !(o as unknown as { archived?: boolean }).archived);
  const archivedOutfits = outfits.filter((o) => (o as unknown as { archived?: boolean }).archived);

  const filteredOutfits = (outfitTab === "archive" ? archivedOutfits : savedOutfits).filter((o) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    const hay = `${o.name} ${(o.occasion ?? []).join(" ")} ${(o.season ?? []).join(" ")} ${o.notes ?? ""}`.toLowerCase();
    return hay.includes(q);
  });

  const today = todayIso();
  const todayPlans = plans.filter((p) => p.date === today && p.status !== "cancelled");

  const pendingConfirmation = plans
    .filter((p) => p.date < today && p.status === "planned")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const upcomingPlans = plans
    .filter((p) => p.date > today && p.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date));

  const openOutfit = (o: Outfit) => openBuilder({
    itemIds: o.item_ids, name: o.name, occasion: o.occasion?.[0],
    notes: o.notes ?? undefined, outfitId: o.id,
  });
  const duplicateOutfit = (o: Outfit) => openBuilder({
    itemIds: o.item_ids, name: `${o.name} Copy`, occasion: o.occasion?.[0],
    notes: o.notes ?? undefined,
  });

  const toggleArchive = async (o: Outfit, archived: boolean) => {
    const { error } = await (supabase.from("outfits" as never) as any).update({ archived }).eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    setOutfits((prev) => prev.map((x) => (x.id === o.id ? { ...x, archived } as Outfit : x)));
    toast.success(archived ? "Archived" : "Restored to Saved");
  };

  const assignToDay = async () => {
    if (!assignFor || !user) return;
    const { data, error } = await supabase.from("outfit_plans").upsert({
      user_id: user.id,
      date: assignDate,
      item_ids: assignFor.item_ids,
      occasion: assignFor.occasion?.[0] ?? null,
      notes: assignFor.notes ?? assignFor.name ?? null,
      status: "planned",
    } as never, { onConflict: "user_id,general_date" }).select("id").single();
    if (error) { toast.error(error.message); return; }
    const { error: eventErr } = await logWardrobeEvent({
      userId: user.id,
      eventType: "planned",
      date: assignDate,
      itemIds: assignFor.item_ids,
      outfitPlanId: (data as { id: string }).id,
      outfitId: assignFor.id,
      occasion: assignFor.occasion?.[0] ?? null,
      notes: assignFor.notes ?? assignFor.name ?? null,
    });
    if (eventErr) console.error("[AURA wardrobe-events] log failed", eventErr);
    toast.success("Added to calendar");
    setAssignFor(null);
    void load();
  };

  const deleteOutfit = async (id: string) => {
    if (!user) return;
    const outfit = outfits.find((o) => o.id === id);
    setDeleting(true);
    const { error } = await supabase.from("outfits").delete().eq("id", id).eq("user_id", user.id);
    if (error) { setDeleting(false); toast.error(error.message); return; }
    if (outfit?.canvas_image_url) {
      try { await supabase.storage.from("outfits").remove([outfit.canvas_image_url]); } catch { /* best-effort */ }
    }
    setOutfits((prev) => prev.filter((o) => o.id !== id));
    setConfirmDelete(null);
    setDeleting(false);
    toast.success("Outfit deleted");
  };

  const getWornIds = (plan: OutfitPlan) => editedItems[plan.id] ?? plan.item_ids;

  const removeFromPlan = (planId: string, itemId: string) => {
    setEditedItems((prev) => {
      const current = prev[planId] ?? plans.find((p) => p.id === planId)?.item_ids ?? [];
      return { ...prev, [planId]: current.filter((id) => id !== itemId) };
    });
  };

  const addToPlan = (planId: string, itemId: string) => {
    setEditedItems((prev) => {
      const current = prev[planId] ?? plans.find((p) => p.id === planId)?.item_ids ?? [];
      if (current.includes(itemId)) return prev;
      return { ...prev, [planId]: [...current, itemId] };
    });
    setPickerForPlan(null);
    setPickerQuery("");
    setPickerCat("All");
  };

  const confirmWorn = async (plan: OutfitPlan) => {
    if (!user) return;
    setConfirmingPlanId(plan.id);
    const actual = editedItems[plan.id];
    const { error } = await confirmOutfitPlanWorn(plan, user.id, actual);
    setConfirmingPlanId(null);
    if (error) { toast.error(error); return; }
    setEditedItems((prev) => { const next = { ...prev }; delete next[plan.id]; return next; });
    toast.success("Marked as worn");
    void load();
  };

  const dismissPlan = async (plan: OutfitPlan) => {
    if (!user) return;
    setConfirmingPlanId(plan.id);
    const { error } = await supabase.from("outfit_plans").update({ status: "cancelled" } as never).eq("id", plan.id);
    setConfirmingPlanId(null);
    if (error) { toast.error(error.message); return; }
    void logWardrobeEvent({ userId: user.id, eventType: "cancelled", date: plan.date, itemIds: plan.item_ids, outfitPlanId: plan.id });
    void load();
  };

  const ItemThumbs = ({ ids, size = "h-16 w-16" }: { ids: string[]; size?: string }) => (
    <div className="flex gap-2 overflow-x-auto no-scrollbar">
      {ids.map((id) => {
        const it = items.find((x) => x.id === id);
        const path = it ? toStoragePath(it.image_url) : null;
        const src = path ? itemSigned[path] : null;
        return (
          <div key={id} className={`${size} shrink-0 rounded-xl overflow-hidden border border-border/60`} style={{ background: "#FFFFFF" }}>
            {src ? <img src={src} alt="" className="h-full w-full object-contain p-1" loading="lazy" /> : null}
          </div>
        );
      })}
    </div>
  );

  /** Same idea as ItemThumbs, but for confirming what was ACTUALLY worn:
   *  each piece can be removed (swapped the bag, etc.), and a tile at the
   *  end opens a searchable picker to add whatever replaced it. */
  const EditableItemThumbs = ({ planId, ids, size = "h-16 w-16" }: { planId: string; ids: string[]; size?: string }) => (
    <div className="flex gap-2 overflow-x-auto no-scrollbar">
      {ids.map((id) => {
        const it = items.find((x) => x.id === id);
        const path = it ? toStoragePath(it.image_url) : null;
        const src = path ? itemSigned[path] : null;
        return (
          <div key={id} className={`${size} shrink-0 relative rounded-xl overflow-hidden border border-border/60`} style={{ background: "#FFFFFF" }}>
            {src ? <img src={src} alt="" className="h-full w-full object-contain p-1" loading="lazy" /> : null}
            <button
              onClick={() => removeFromPlan(planId, id)}
              aria-label="Remove this piece"
              className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-background/90 border border-border flex items-center justify-center"
            ><X size={10} /></button>
          </div>
        );
      })}
      <button
        onClick={() => setPickerForPlan(planId)}
        aria-label="Add a piece"
        className={`${size} shrink-0 rounded-xl border border-dashed border-border flex items-center justify-center text-muted-foreground`}
      ><Plus size={16} /></button>
    </div>
  );

  const dateLabel = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Atelier</p>
        <h1 className="font-serif text-4xl mt-1 italic">Stylist</h1>
      </header>

      {!loading && todayPlans.length > 0 && (
        <section className="mx-6 mt-5 space-y-3">
          {todayPlans.map((tp) => {
            const linkedEvent = tp.calendar_event_id ? todayCalEvents.find((e) => e.id === tp.calendar_event_id) : null;
            const label = tp.calendar_event_id ? (linkedEvent?.title || "Event") : "General";
            return (
              <div key={tp.id} className="rounded-3xl gradient-warm border border-border/60 p-4 animate-fade-up">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Today's look</p>
                    <p className="text-xs mt-0.5">{label}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full ${tp.status === "worn" ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground"}`}>
                      {tp.status === "worn" ? "Worn" : "Planned"}
                    </span>
                    {tp.status !== "worn" && (
                      <button
                        onClick={() => void dismissPlan(tp)}
                        disabled={confirmingPlanId === tp.id}
                        aria-label="Remove this planned outfit"
                        className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-muted-foreground disabled:opacity-50"
                      ><X size={13} /></button>
                    )}
                  </div>
                </div>
                <div className="mt-3">
                  {tp.status === "worn"
                    ? <ItemThumbs ids={tp.item_ids} />
                    : <EditableItemThumbs planId={tp.id} ids={getWornIds(tp)} />}
                </div>
                {tp.weather_temp != null && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {Math.round(tp.weather_temp)}°{tp.weather_condition ? ` · ${tp.weather_condition}` : ""}
                  </p>
                )}
                {tp.status !== "worn" && (
                  <button
                    onClick={() => void confirmWorn(tp)}
                    disabled={confirmingPlanId === tp.id || getWornIds(tp).length === 0}
                    className="mt-3 w-full h-9 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 disabled:opacity-60"
                  ><Check size={12} /> This is what I'm wearing</button>
                )}
              </div>
            );
          })}
        </section>
      )}

      {!loading && pendingConfirmation.length > 0 && (
        <section className="mx-6 mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Did you wear this?</p>
          {pendingConfirmation.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border/60 bg-card p-3 animate-fade-up">
              <p className="text-xs text-muted-foreground mb-2">{dateLabel(p.date)}{p.occasion ? ` · ${p.occasion}` : ""}</p>
              <EditableItemThumbs planId={p.id} ids={getWornIds(p)} size="h-14 w-14" />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void confirmWorn(p)}
                  disabled={confirmingPlanId === p.id || getWornIds(p).length === 0}
                  className="flex-1 h-9 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-1.5 disabled:opacity-60"
                ><Check size={12} /> Yes, this is what I wore</button>
                <button
                  onClick={() => void dismissPlan(p)}
                  disabled={confirmingPlanId === p.id}
                  className="h-9 w-9 rounded-full border border-border flex items-center justify-center disabled:opacity-60"
                  aria-label="I didn't wear this"
                ><X size={14} /></button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="px-6 mt-8">
        <h2 className="font-serif text-2xl italic mb-3">My Outfits</h2>
        <div className="flex rounded-full border border-border p-1 mb-4">
          {([
            { key: "upcoming", label: "Upcoming" },
            { key: "worn", label: "Worn" },
            { key: "saved", label: "Saved" },
            { key: "archive", label: "Archive" },
          ] as { key: OutfitTab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setOutfitTab(t.key)}
              className={`flex-1 h-8 rounded-full text-[10px] uppercase tracking-[0.15em] ${outfitTab === t.key ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >{t.label}</button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : outfitTab === "upcoming" ? (
          upcomingPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming looks planned yet — plan one from a saved outfit, or from the Calendar tab.</p>
          ) : (
            <div className="space-y-2">
              {upcomingPlans.map((p) => (
                <div key={p.id} className="rounded-2xl border border-border/60 bg-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">{dateLabel(p.date)}{p.occasion ? ` · ${p.occasion}` : ""}</p>
                    <button
                      onClick={() => void dismissPlan(p)}
                      disabled={confirmingPlanId === p.id}
                      aria-label="Remove this planned outfit"
                      className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-muted-foreground disabled:opacity-50"
                    ><X size={13} /></button>
                  </div>
                  <ItemThumbs ids={p.item_ids} size="h-14 w-14" />
                </div>
              ))}
            </div>
          )
        ) : outfitTab === "worn" ? (
          wornEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing logged as worn yet — confirm a planned outfit above, or mark one worn from the Calendar tab.</p>
          ) : (
            <div className="space-y-2">
              {wornEntries.map((w) => (
                <div key={w.eventId} className="rounded-2xl border border-border/60 bg-card p-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    {dateLabel(w.date)}{w.outfitName ? ` · ${w.outfitName}` : w.occasion ? ` · ${w.occasion}` : ""}
                  </p>
                  <ItemThumbs ids={w.itemIds} size="h-14 w-14" />
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {(savedOutfits.length > 0 || archivedOutfits.length > 0) && (
              <div className="mb-4 flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
                <Search size={15} className="text-muted-foreground" />
                <input
                  value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, occasion, season…"
                  className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
                />
              </div>
            )}

            {filteredOutfits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {outfitTab === "archive"
                  ? "No archived outfits — archive a look from Saved when it's out of rotation but still worth keeping (like a seasonal piece)."
                  : "No outfits yet. Compose your first with AI suggest or build manually below."}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredOutfits.map((o) => {
                  const url = o.canvas_image_url ? signed[o.canvas_image_url] : null;
                  return (
                    <div key={o.id} className="animate-fade-up relative rounded-2xl overflow-hidden border border-border/60 bg-card shadow-soft">
                      <button onClick={() => openOutfit(o)} className="block w-full text-left active:scale-[0.98]">
                        <div className="aspect-square" style={{ background: "#FFFFFF" }}>
                          {url ? (
                            <img src={url} alt={o.name} className="w-full h-full object-contain p-2" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">Open canvas</div>
                          )}
                        </div>
                      </button>
                      {outfitTab === "saved" && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); duplicateOutfit(o); }}
                            aria-label="Duplicate outfit"
                            className="absolute top-2 right-20 h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft"
                          ><Copy size={14} /></button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setShareFor(o.id); }}
                            aria-label="Share outfit"
                            className="absolute top-2 right-11 h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft"
                          ><Share2 size={14} /></button>
                        </>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); void toggleArchive(o, outfitTab !== "archive"); }}
                        aria-label={outfitTab === "archive" ? "Restore to Saved" : "Archive outfit"}
                        className={`absolute top-2 ${outfitTab === "archive" ? "right-11" : "right-2"} h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft`}
                      >{outfitTab === "archive" ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>
                      {outfitTab === "archive" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(o.id); }}
                          aria-label="Delete outfit"
                          className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/80 backdrop-blur flex items-center justify-center active:scale-90 shadow-soft"
                        ><Trash2 size={14} /></button>
                      )}
                      <div className="p-3">
                        <button onClick={() => openOutfit(o)} className="block w-full text-left">
                          <p className="font-serif text-base truncate">{o.name}</p>
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{o.item_ids.length} pieces</p>
                        </button>
                        {outfitTab === "saved" && (
                          <button
                            onClick={() => setAssignFor(o)}
                            className="mt-2 h-8 w-full rounded-full border border-border text-[10px] uppercase tracking-[0.25em] active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
                          ><CalendarIcon size={11} /> Plan</button>
                        )}
                      </div>

                      {confirmDelete === o.id && (
                        <div className="absolute inset-0 z-10 bg-background/90 backdrop-blur flex flex-col items-center justify-center gap-2 p-3 text-center">
                          <p className="text-xs">Delete this outfit?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="h-8 px-4 rounded-full border border-border text-[10px] uppercase tracking-[0.2em]"
                            >Cancel</button>
                            <button
                              disabled={deleting}
                              onClick={() => void deleteOutfit(o.id)}
                              className="h-8 px-4 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.2em] disabled:opacity-60"
                            >{deleting ? "…" : "Delete"}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="px-6 mt-10">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Create</p>
        <div className="flex gap-2">
          <button
            onClick={() => go("builder")}
            className="flex-1 h-12 rounded-full bg-foreground text-background text-xs uppercase tracking-[0.3em] active:scale-[0.98] shadow-luxe"
          >Build manually</button>
        </div>
        <button
          onClick={() => go("stylist-chat")}
          className="mt-2 w-full h-12 rounded-full border border-foreground text-foreground text-xs uppercase tracking-[0.3em] active:scale-[0.98] flex items-center justify-center gap-2"
        ><Sparkles size={13} /> Ask your stylist</button>

        <button
          onClick={() => setWeeklySheetOpen(true)}
          className="mt-2 w-full h-12 rounded-full border border-border text-foreground text-xs uppercase tracking-[0.3em] active:scale-[0.98] flex items-center justify-center gap-2"
        ><CalendarIcon size={13} /> Create work outfits</button>

        <details className="mt-4">
          <summary className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground cursor-pointer">More options</summary>
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Occasion</p>
            <div className="flex flex-wrap gap-1.5">
              {OCCASIONS.map((o) => (
                <button
                  key={o}
                  onClick={() => setOccasion(o)}
                  className={`rounded-full px-3 py-1.5 text-xs transition ${occasion === o ? "bg-foreground text-background" : "bg-secondary/60"}`}
                >{o}</button>
              ))}
            </div>
            <button
              onClick={aiPick}
              disabled={aiBusy}
              className="mt-3 w-full h-11 rounded-full border border-border text-muted-foreground flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
            >
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              <span className="text-[10px] uppercase tracking-[0.3em]">AI suggest</span>
            </button>
          </div>
        </details>
      </section>

      {shareFor && <ShareOutfitSheet outfitId={shareFor} onClose={() => setShareFor(null)} />}

      {assignFor && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end" onClick={() => setAssignFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full bg-card rounded-t-3xl border-t border-border p-5 space-y-3">
            <p className="font-serif italic text-lg">Assign to a date</p>
            <input
              type="date"
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              className="w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
            />
            <button
              onClick={() => void assignToDay()}
              className="w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98]"
            >Save to calendar</button>
          </div>
        </div>
      )}

      {pickerForPlan && (() => {
        const currentIds = new Set(editedItems[pickerForPlan] ?? plans.find((p) => p.id === pickerForPlan)?.item_ids ?? []);
        const activeOnly = items.filter((it) => !(it as unknown as { archived?: boolean }).archived);
        const q = pickerQuery.trim().toLowerCase();
        const matches = activeOnly.filter((it) => {
          if (currentIds.has(it.id)) return false;
          if (pickerCat !== "All" && it.category !== pickerCat) return false;
          if (!q) return true;
          return [it.brand, it.category, it.subcategory, it.color, ...(it.colors ?? [])]
            .some((v) => v?.toLowerCase().includes(q));
        });
        return (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end" onClick={() => setPickerForPlan(null)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full max-h-[80vh] bg-card rounded-t-3xl border-t border-border p-5 flex flex-col">
              <div className="flex items-center justify-between shrink-0">
                <p className="font-serif italic text-lg">What did you wear instead?</p>
                <button onClick={() => setPickerForPlan(null)} aria-label="Close" className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"><X size={14} /></button>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5 shrink-0">
                <Search size={15} className="text-muted-foreground" />
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search by color, brand, fabric…"
                  className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
                />
              </div>
              <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar shrink-0">
                {["All", ...ITEM_CATEGORIES].map((c) => (
                  <button
                    key={c}
                    onClick={() => setPickerCat(c)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] ${pickerCat === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
                  >{c}</button>
                ))}
              </div>
              <div className="mt-3 overflow-y-auto grid grid-cols-3 gap-2 pb-4">
                {matches.length === 0 ? (
                  <p className="col-span-3 text-sm text-muted-foreground py-6 text-center">No pieces match.</p>
                ) : matches.map((it) => {
                  const path = toStoragePath(it.image_url);
                  const src = path ? itemSigned[path] : null;
                  return (
                    <button
                      key={it.id}
                      onClick={() => addToPlan(pickerForPlan, it.id)}
                      className="aspect-square rounded-xl overflow-hidden border border-border/60"
                      style={{ background: "#FFFFFF" }}
                    >
                      {src ? <img src={src} alt="" className="h-full w-full object-contain p-1" loading="lazy" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {weeklySheetOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end" onClick={() => !weeklyGenerating && setWeeklySheetOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full bg-card rounded-t-3xl border-t border-border p-5 space-y-4">
            <p className="font-serif italic text-lg">Create work outfits</p>

            {weeklyResult ? (
              <div className="text-center py-2">
                <p className="font-serif text-2xl">{weeklyResult.created} outfit{weeklyResult.created === 1 ? "" : "s"} created</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {weeklyResult.skippedExisting > 0 ? `${weeklyResult.skippedExisting} day${weeklyResult.skippedExisting === 1 ? "" : "s"} already had a plan, left untouched. ` : ""}
                  {weeklyResult.failed > 0 ? `${weeklyResult.failed} day${weeklyResult.failed === 1 ? "" : "s"} couldn't be generated.` : ""}
                </p>
                <button
                  onClick={() => { setWeeklySheetOpen(false); setWeeklyResult(null); }}
                  className="mt-4 w-full h-11 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em]"
                >Done</button>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Period</p>
                  <div className="flex gap-2">
                    {([7, 14] as const).map((n) => (
                      <button
                        key={n}
                        onClick={() => setWeeklyDays(n)}
                        className={`flex-1 h-10 rounded-full text-xs ${weeklyDays === n ? "bg-foreground text-background" : "bg-secondary/60"}`}
                      >{n} days</button>
                    ))}
                  </div>
                </div>
                {locations.length > 1 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Wardrobe to use</p>
                    <div className="flex flex-wrap gap-2">
                      {locations.map((loc) => (
                        <button
                          key={loc.id}
                          onClick={() => setWeeklyLocationId(loc.id)}
                          className={`rounded-full px-3 py-1.5 text-xs border ${weeklyLocationId === loc.id ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}
                        >{loc.name}</button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      If this period splits across two places, run this once per place instead.
                    </p>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Fills in your work days only (set in your profile) — never touches a day you've already planned, and never touches an outfit already linked to a specific event.
                </p>
                <button
                  onClick={() => void runWeeklyGeneration()}
                  disabled={weeklyGenerating}
                  className="w-full h-12 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {weeklyGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Generate
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
