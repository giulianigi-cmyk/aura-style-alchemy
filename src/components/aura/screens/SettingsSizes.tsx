import { useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { sizeEquivalences } from "@/lib/size-conversion";

type SizeKey = "tops" | "bottoms" | "dresses" | "shoes" | "bra" | "underwear";
const SIZE_FIELDS: { key: SizeKey; labelKey: string; shoes?: boolean; wardrobeCategory: string }[] = [
  { key: "tops", labelKey: "sizes.tops", wardrobeCategory: "Tops" },
  { key: "bottoms", labelKey: "sizes.bottoms", wardrobeCategory: "Bottoms" },
  { key: "dresses", labelKey: "sizes.dresses", wardrobeCategory: "Dresses" },
  { key: "shoes", labelKey: "sizes.shoes", shoes: true, wardrobeCategory: "Shoes" },
];

export function SettingsSizes({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id;
  const empty: Record<SizeKey, string> = { tops: "", bottoms: "", dresses: "", shoes: "", bra: "", underwear: "" };
  const [values, setValues] = useState<Record<SizeKey, string>>(empty);
  const [inferred, setInferred] = useState<Record<SizeKey, string>>(empty);
  const [gender, setGender] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data, error }, { data: items }] = await Promise.all([
        supabase.from("profiles").select("sizes, gender").eq("id", userId).maybeSingle(),
        supabase.from("wardrobe_items").select("category, size").eq("user_id", userId),
      ]);
      if (cancelled) return;
      if (error) console.error("[AURA sizes] load", error);
      const profileRow = data as { sizes?: Partial<Record<SizeKey, string>>; gender?: string | null } | null;
      const s = profileRow?.sizes ?? {};
      setGender(profileRow?.gender ?? null);
      setValues({ tops: s.tops ?? "", bottoms: s.bottoms ?? "", dresses: s.dresses ?? "", shoes: s.shoes ?? "", bra: s.bra ?? "", underwear: s.underwear ?? "" });

      const counts: Record<SizeKey, Map<string, number>> = {
        tops: new Map(),
        bottoms: new Map(),
        dresses: new Map(),
        shoes: new Map(),
        bra: new Map(),
        underwear: new Map(),
      };
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
              <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{t(f.labelKey)}</p>
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
        {gender === "Woman" && (
          <div className="min-w-0 border-b border-border/60 pb-1.5">
            <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{t("sizes.bra")}</p>
            <input
              value={values.bra}
              onChange={(e) => setValues((prev) => ({ ...prev, bra: e.target.value }))}
              placeholder={loading ? "…" : "70B"}
              className="mt-0.5 w-full min-w-0 bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        )}
        {gender === "Man" && (
          <div className="min-w-0 border-b border-border/60 pb-1.5">
            <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{t("sizes.underwear")}</p>
            <input
              value={values.underwear}
              onChange={(e) => setValues((prev) => ({ ...prev, underwear: e.target.value }))}
              placeholder={loading ? "…" : "M"}
              className="mt-0.5 w-full min-w-0 bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        )}
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
