import { useEffect, useState } from "react";
import { Pencil, X, Check, Loader2 } from "lucide-react";
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

export function DressPreferencesSection({ userId }: { userId: string | undefined }) {
  const [prefs, setPrefs] = useState<DressPreferences>({});
  const [snapshot, setSnapshot] = useState<DressPreferences>({});
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
        .select("dress_preferences")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) {
        if (error) console.error("[AURA dress-prefs] load", error);
        const p = ((data as { dress_preferences?: DressPreferences } | null)?.dress_preferences ?? {}) as DressPreferences;
        setPrefs(p);
        setSnapshot(p);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(snapshot);

  const toggle = (key: keyof DressPreferences) =>
    setPrefs((p) => ({ ...p, [key]: !p[key] || undefined }));

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    const clean: DressPreferences = { ...prefs };
    if (clean.custom_notes !== undefined && !clean.custom_notes.trim()) delete clean.custom_notes;
    const { error } = await supabase
      .from("profiles")
      .update({ dress_preferences: clean, updated_at: new Date().toISOString() } as never)
      .eq("id", userId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setPrefs(clean);
    setSnapshot(clean);
    setEditing(false);
    toast.success("Preferences saved");
  };

  const chip = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`;

  return (
    <section className="mx-6 mt-5 rounded-3xl gradient-warm border border-border/60 p-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Dress preferences</p>
        {editing ? (
          <button
            onClick={() => { setPrefs(snapshot); setEditing(false); }}
            aria-label="Cancel editing preferences"
            className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
          ><X size={13} /></button>
        ) : (
          <button
            onClick={() => { setSnapshot(prefs); setEditing(true); }}
            aria-label="Edit preferences"
            className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
          ><Pencil size={13} /></button>
        )}
      </div>

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
              Optional. Set any dressing rules you always follow — AURA will respect
              them in every outfit and shopping suggestion, no exceptions.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {BOOL_PREFS.map((b) => (
              <button key={b.key} onClick={() => toggle(b.key)} className={chip(Boolean(prefs[b.key]))}>
                {b.label}
              </button>
            ))}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Minimum skirt / dress length</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SKIRT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setPrefs((p) => ({ ...p, min_skirt_length: p.min_skirt_length === o.value ? undefined : (o.value as SkirtLength) }))}
                  className={chip(prefs.min_skirt_length === o.value)}
                >{o.label}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Minimum sleeve length</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SLEEVE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setPrefs((p) => ({ ...p, min_sleeve_length: p.min_sleeve_length === o.value ? undefined : (o.value as SleeveLength) }))}
                  className={chip(prefs.min_sleeve_length === o.value)}
                >{o.label}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Other rules (free text)</p>
            <textarea
              value={prefs.custom_notes ?? ""}
              onChange={(e) => setPrefs((p) => ({ ...p, custom_notes: e.target.value }))}
              placeholder="e.g. never short skirts, never heels…"
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
            <span className="text-[10px] uppercase tracking-[0.3em]">Save preferences</span>
          </button>
        </div>
      )}
    </section>
  );
}
