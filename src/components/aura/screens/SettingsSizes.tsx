import { useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { sizeEquivalences } from "@/lib/size-conversion";

type SizeKey = "tops" | "bottoms" | "dresses" | "shoes";
const SIZE_FIELDS: { key: SizeKey; label: string; shoes?: boolean; wardrobeCategory: string }[] = [
  { key: "tops", label: "Tops", wardrobeCategory: "Tops" },
  { key: "bottoms", label: "Bottoms", wardrobeCategory: "Bottoms" },
  { key: "dresses", label: "Dresses", wardrobeCategory: "Dresses" },
  { key: "shoes", label: "Shoes", shoes: true, wardrobeCategory: "Shoes" },
];

export function SettingsSizes({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id;
  const empty: Record<SizeKey, string> = { tops: "", bottoms: "", dresses: "", shoes: "" };
  const [values, setValues] = useState<Record<SizeKey, string>>(empty);
  const [inferred, setInferred] = useState<Record<SizeKey, string>>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data, error }, { data: items }] = await Promise.all([
        supabase.from("profiles").select("sizes").eq("id", userId).maybeSingle(),
        supabase.from("wardrobe_items").select("category, size").eq("user_id", userId),
      ]);
      if (cancelled) return;
      if (error) console.error("[AURA sizes] load", error);
      const s = (data as { sizes?: Partial<Record<SizeKey, string>> } | null)?.sizes ?? {};
      setValues({ tops: s.tops ?? "", bottoms: s.bottoms ?? "", dresses: s.dresses ?? "", shoes: s.shoes ?? "" });

      const counts: Record<SizeKey, Map<string, number>> = { tops: new Map(), bottoms: new Map(), dresses: new Map(), shoes: new Map() };
      for (const it of (items ?? []) as { category: string | null; size: string | null }[]) {
        const size = it.size?.trim();
        if (!size) continue;
        const field = SIZE_FIELDS.find((f) => f.wardrobeCategory === it.category);
        if (!field) continue;
        const m = counts[field.key];
        m.set(size, (m.get(size) ?? 0) + 1);
      }
      const nextInferred = { ...empty };
      (Object.keys(counts) as SizeKey[]).forEach((k) => {
        const m = counts[k];
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        if (total < 2) return;
        const [topSize] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
        nextInferred[k] = topSize;
      });
      setInferred(nextInferred);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    const payload: Record<string, string> = {};
    (Object.keys(values) as SizeKey[]).forEach((k) => {
      const v = values[k].trim();
      if (v) payload[k] = v;
    });
    const { error } = await supabase
      .from("profiles")
      .update({ sizes: payload, updated_at: new Date().toISOString() })
      .eq("id", userId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("settings.saved"));
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("settings")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("settings.sizes")}</p>
        <span className="w-10" />
      </header>

      <section className="mx-6 mt-6 grid grid-cols-2 gap-x-4 gap-y-5">
        {SIZE_FIELDS.map((f) => {
          const v = values[f.key];
          const usingInferred = !v && !!inferred[f.key];
          const shown = v || inferred[f.key];
          const hint = sizeEquivalences(shown, f.shoes ? { shoes: true } : undefined);
          return (
            <div key={f.key} className="min-w-0 border-b border-border/60 pb-1.5">
              <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{f.label}</p>
              <input
                value={v}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={loading ? "…" : inferred[f.key] || (f.shoes ? "38" : "42 / M")}
                className="mt-0.5 w-full min-w-0 bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
              />
              {shown && hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
              {usingInferred && <p className="text-[9px] text-muted-foreground italic truncate">{t("settings.fromYourWardrobe")}</p>}
            </div>
          );
        })}
      </section>

      <section className="mx-6 mt-8">
        <button
          onClick={save} disabled={saving}
          className="w-full h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          <span className="text-[10px] uppercase tracking-[0.3em]">{t("settings.saveChanges")}</span>
        </button>
      </section>
    </div>
  );
}
