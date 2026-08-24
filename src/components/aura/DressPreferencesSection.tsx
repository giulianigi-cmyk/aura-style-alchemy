import { useEffect, useState } from "react";
import { Pencil, X, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  BOOL_PREFS,
  SKIRT_OPTIONS,
  SLEEVE_OPTIONS,
  activePreferenceLabels,
  hasAnyPreference,
  type DressPreferences,
  type SkirtLength,
  type SleeveLength,
} from "@/lib/dress-preferences";

const BOOL_PREF_KEYS: Record<string, string> = {
  cover_head: "dressPrefs.coverHead",
  cover_shoulders: "dressPrefs.coverShoulders",
  cover_arms: "dressPrefs.coverArms",
  cover_legs: "dressPrefs.coverLegs",
  avoid_tight: "dressPrefs.avoidTight",
  avoid_sheer: "dressPrefs.avoidSheer",
  avoid_low_neckline: "dressPrefs.avoidLowNeckline",
};
const SKIRT_KEYS: Record<string, string> = {
  mini: "dressPrefs.skirtMini", knee: "dressPrefs.skirtKnee", midi: "dressPrefs.skirtMidi", long: "dressPrefs.skirtLong",
};
const SLEEVE_KEYS: Record<string, string> = {
  none: "dressPrefs.sleeveNone", short: "dressPrefs.sleeveShort", "three-quarter": "dressPrefs.sleeveThreeQuarter", long: "dressPrefs.sleeveLong",
};

type Scope = "general" | "work";

export function DressPreferencesSection({ userId }: { userId: string | undefined }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>("general");
  const [generalPrefs, setGeneralPrefs] = useState<DressPreferences>({});
  const [generalSnapshot, setGeneralSnapshot] = useState<DressPreferences>({});
  const [workPrefs, setWorkPrefs] = useState<DressPreferences>({});
  const [workSnapshot, setWorkSnapshot] = useState<DressPreferences>({});
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("dress_preferences, work_dress_preferences")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) {
        if (error) console.error("[AURA dress-prefs] load", error);
        const row = data as { dress_preferences?: DressPreferences; work_dress_preferences?: DressPreferences } | null;
        const g = (row?.dress_preferences ?? {}) as DressPreferences;
        const w = (row?.work_dress_preferences ?? {}) as DressPreferences;
        setGeneralPrefs(g);
        setGeneralSnapshot(g);
        setWorkPrefs(w);
        setWorkSnapshot(w);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const prefs = scope === "work" ? workPrefs : generalPrefs;
  const setPrefs = scope === "work" ? setWorkPrefs : setGeneralPrefs;
  const snapshot = scope === "work" ? workSnapshot : generalSnapshot;
  const dirty = JSON.stringify(prefs) !== JSON.stringify(snapshot);

  const toggle = (key: keyof DressPreferences) =>
    setPrefs((p) => {
      const turningOn = !p[key];
      const next: DressPreferences = { ...p, [key]: turningOn || undefined };
      // "Cover arms" without "long sleeves only" (or "cover legs" without
      // "long skirts only") is a direct contradiction — enforce the
      // matching minimum length the moment the coverage rule turns on,
      // instead of letting the two disagree with each other.
      if (key === "cover_arms" && turningOn) next.min_sleeve_length = "long";
      if (key === "cover_legs" && turningOn) next.min_skirt_length = "long";
      return next;
    });

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    const clean: DressPreferences = { ...prefs };
    if (clean.custom_notes !== undefined && !clean.custom_notes.trim()) delete clean.custom_notes;
    const column = scope === "work" ? "work_dress_preferences" : "dress_preferences";
    const { error } = await supabase
      .from("profiles")
      .update({ [column]: clean, updated_at: new Date().toISOString() } as never)
      .eq("id", userId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (scope === "work") { setWorkPrefs(clean); setWorkSnapshot(clean); }
    else { setGeneralPrefs(clean); setGeneralSnapshot(clean); }
    setEditing(false);
    toast.success(t("dressPrefs.preferencesSaved"));
  };

  const chip = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`;

  return (
    <section className="mx-6 mt-5 rounded-3xl gradient-warm border border-border/60 p-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("dressPrefs.dressPreferences")}</p>
        {editing ? (
          <button
            onClick={() => { setPrefs(snapshot); setEditing(false); }}
            aria-label={t("dressPrefs.cancelEditingAria")}
            className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
          ><X size={13} /></button>
        ) : (
          <button
            onClick={() => { if (scope === "work") setWorkSnapshot(workPrefs); else setGeneralSnapshot(generalPrefs); setEditing(true); }}
            aria-label={t("dressPrefs.editAria")}
            className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
          ><Pencil size={13} /></button>
        )}
      </div>

      <div className="mt-3 flex rounded-full border border-border p-1">
        {(["general", "work"] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => { setEditing(false); setScope(s); }}
            className={`flex-1 h-8 rounded-full text-[10px] uppercase tracking-[0.2em] transition ${scope === s ? "bg-foreground text-background" : "text-foreground/70"}`}
          >{s === "general" ? t("dressPrefs.general") : t("dressPrefs.work")}</button>
        ))}
      </div>
      {scope === "work" && (
        <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
          {t("dressPrefs.workHint")}
        </p>
      )}

      {!editing ? (
        <div className="mt-3">
          {loading ? (
            <p className="font-serif text-lg">…</p>
          ) : hasAnyPreference(prefs) ? (
            <div className="flex flex-wrap gap-1.5">
              {activePreferenceLabels(prefs).map((l) => (
                <span key={l} className="rounded-full bg-secondary/60 px-3 py-1 text-xs text-foreground/80">{l}</span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {scope === "work" ? t("dressPrefs.emptyWorkHint") : t("dressPrefs.emptyGeneralHint")}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {BOOL_PREFS.map((b) => (
              <button key={b.key} onClick={() => toggle(b.key)} className={chip(Boolean(prefs[b.key]))}>
                {t(BOOL_PREF_KEYS[b.key])}
              </button>
            ))}
          </div>

          <div>
                        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("dressPrefs.skirtDressLength")}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SKIRT_OPTIONS.map((o) => {
                const locked = Boolean(prefs.cover_legs) && o.value !== "long";
                return (
                  <button
                    key={o.value}
                    disabled={locked}
                    onClick={() => setPrefs((p) => ({ ...p, min_skirt_length: p.min_skirt_length === o.value ? undefined : (o.value as SkirtLength) }))}
                    className={`${chip(prefs.min_skirt_length === o.value)} ${locked ? "opacity-30" : ""}`}
                  >{t(SKIRT_KEYS[o.value])}</button>
                );
              })}
            </div>
            {prefs.cover_legs && (
              <p className="mt-1 text-[10px] text-muted-foreground">{t("dressPrefs.lockedLong")}</p>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("dressPrefs.minimumSleeveLength")}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SLEEVE_OPTIONS.map((o) => {
                const locked = Boolean(prefs.cover_arms) && o.value !== "long";
                return (
                  <button
                    key={o.value}
                    disabled={locked}
                    onClick={() => setPrefs((p) => ({ ...p, min_sleeve_length: p.min_sleeve_length === o.value ? undefined : (o.value as SleeveLength) }))}
                    className={`${chip(prefs.min_sleeve_length === o.value)} ${locked ? "opacity-30" : ""}`}
                  >{t(SLEEVE_KEYS[o.value])}</button>
                );
              })}
            </div>
            {prefs.cover_arms && (
              <p className="mt-1 text-[10px] text-muted-foreground">{t("dressPrefs.lockedLongArms")}</p>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("dressPrefs.otherRules")}</p>
            <textarea
              value={prefs.custom_notes ?? ""}
              onChange={(e) => setPrefs((p) => ({ ...p, custom_notes: e.target.value }))}
              placeholder={scope === "work" ? t("dressPrefs.otherRulesWorkPlaceholder") : t("dressPrefs.otherRulesPlaceholder")}
              rows={2}
              className="mt-1.5 w-full bg-secondary/60 rounded-2xl px-4 py-2 text-sm outline-none placeholder:text-muted-foreground resize-none"
            />
          </div>

          <button
            onClick={save}
            disabled={saving || !dirty}
            className="w-full h-11 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            <span className="text-[10px] uppercase tracking-[0.3em]">{t("dressPrefs.savePreferences")}</span>
          </button>
        </div>
      )}
    </section>
  );
}
