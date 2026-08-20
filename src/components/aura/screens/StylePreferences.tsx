import { useEffect, useState } from "react";
import { ArrowLeft, Check, Info, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useProfile } from "@/hooks/use-profile";

const WORK_DRESS_CODES = ["None", "Casual", "Smart Casual", "Business Casual", "Business Formal", "Uniform"];
const PERSONAL_FORMALITY = ["Very casual", "Casual", "Smart Casual", "Elegant", "Very elegant"];
const STYLE_BOLDNESS = ["Classic", "Balanced", "Creative", "Bold"];
const WEEKDAYS: { code: string; label: string }[] = [
  { code: "MO", label: "Mon" }, { code: "TU", label: "Tue" }, { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" }, { code: "FR", label: "Fri" }, { code: "SA", label: "Sat" }, { code: "SU", label: "Sun" },
];

const DRESS_CODE_DEFINITIONS: { term: string; description: string }[] = [
  { term: "None", description: "No specific dress code — wear whatever you like." },
  { term: "Casual", description: "Relaxed everyday clothes: jeans, t-shirts, sneakers." },
  { term: "Smart Casual", description: "Neat and put-together without being formal — chinos, blouses, loafers." },
  { term: "Business Casual", description: "Professional but relaxed — no tie needed, but polished (dress pants, collared shirts)." },
  { term: "Business Formal", description: "Fully professional — suits, blazers, structured tailoring." },
  { term: "Uniform", description: "A required uniform is provided or specified by the employer." },
];
const FORMALITY_DEFINITIONS: { term: string; description: string }[] = [
  { term: "Very casual", description: "Almost always in relaxed, comfortable clothing." },
  { term: "Casual", description: "Generally relaxed, dressed up only occasionally." },
  { term: "Smart Casual", description: "Put-together most days without going fully formal." },
  { term: "Elegant", description: "Prefers polished, refined outfits most of the time." },
  { term: "Very elegant", description: "Consistently dresses in a formal, elevated style." },
];

export function StylePreferences({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const { profile, update } = useProfile();
  const [workDressCode, setWorkDressCode] = useState("");
  const [personalFormality, setPersonalFormality] = useState("");
  const [styleBoldness, setStyleBoldness] = useState("");
  const [workDays, setWorkDays] = useState<string[]>(["MO", "TU", "WE", "TH", "FR"]);
  const [workStartTime, setWorkStartTime] = useState("09:00");
  const [workEndTime, setWorkEndTime] = useState("18:00");
  const [saving, setSaving] = useState(false);
  const [infoPopup, setInfoPopup] = useState<"work" | "formality" | null>(null);

  useEffect(() => {
    if (!profile) return;
    setWorkDressCode(profile.work_dress_code ?? "");
    setPersonalFormality(profile.personal_formality ?? "");
    setStyleBoldness(profile.style_boldness ?? "");
    setWorkDays(profile.work_days ?? ["MO", "TU", "WE", "TH", "FR"]);
    setWorkStartTime(profile.work_start_time ?? "09:00");
    setWorkEndTime(profile.work_end_time ?? "18:00");
  }, [profile]);

  const save = async () => {
    setSaving(true);
    const { error } = await update({
      work_dress_code: workDressCode || null,
      personal_formality: personalFormality || null,
      style_boldness: styleBoldness || null,
      work_days: workDays,
      work_start_time: workStartTime,
      work_end_time: workEndTime,
    });
    setSaving(false);
    if (error) { toast.error(error); return; }
    toast.success(t("settings.saved"));
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("settings")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">{t("settings.stylePrefs")}</p>
        <span className="w-10" />
      </header>

      <section className="mx-6 mt-6 space-y-6">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("settings.workDressCode")}</p>
            <button onClick={() => setInfoPopup("work")} aria-label={t("settings.whatDoesThisMean")} className="text-muted-foreground active:scale-90">
              <Info size={12} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {WORK_DRESS_CODES.map(w => (
              <button key={w} onClick={() => setWorkDressCode(w)}
                className={`rounded-full px-3 py-1.5 text-xs border transition ${workDressCode === w ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                {w}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("settings.personalFormality")}</p>
            <button onClick={() => setInfoPopup("formality")} aria-label={t("settings.whatDoesThisMean")} className="text-muted-foreground active:scale-90">
              <Info size={12} />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">{t("settings.personalFormalityHint")}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {PERSONAL_FORMALITY.map(f => (
              <button key={f} onClick={() => setPersonalFormality(f)}
                className={`rounded-full px-3 py-1.5 text-xs border transition ${personalFormality === f ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("settings.styleBoldness")}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">{t("settings.styleBoldnessHint")}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {STYLE_BOLDNESS.map(b => (
              <button key={b} onClick={() => setStyleBoldness(styleBoldness === b ? "" : b)}
                className={`rounded-full px-3 py-1.5 text-xs border transition ${styleBoldness === b ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                {b}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("settings.workDays")}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">{t("settings.workDaysHint")}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {WEEKDAYS.map(d => {
              const on = workDays.includes(d.code);
              return (
                <button key={d.code} onClick={() => setWorkDays(on ? workDays.filter(c => c !== d.code) : [...workDays, d.code])}
                  className={`rounded-full px-3 py-1.5 text-xs border transition ${on ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                  {d.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1">
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">{t("settings.from")}</p>
              <input
                type="time" value={workStartTime} onChange={(e) => setWorkStartTime(e.target.value)}
                className="w-full bg-background border border-border rounded-full px-3 py-2 text-sm outline-none"
              />
            </div>
            <div className="flex-1">
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">{t("settings.to")}</p>
              <input
                type="time" value={workEndTime} onChange={(e) => setWorkEndTime(e.target.value)}
                className="w-full bg-background border border-border rounded-full px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">{t("settings.workDaysNote")}</p>
        </div>

        <button
          onClick={save} disabled={saving}
          className="w-full h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          <span className="text-[10px] uppercase tracking-[0.3em]">{t("settings.saveChanges")}</span>
        </button>
      </section>

      {infoPopup && (
        <div
          className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-center justify-center px-6"
          onClick={() => setInfoPopup(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-luxe max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="font-serif text-lg italic">
                {infoPopup === "work" ? t("settings.dressCodeTerms") : t("settings.formalityTerms")}
              </p>
              <button onClick={() => setInfoPopup(null)} aria-label={t("settings.close")} className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90">
                <X size={14} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {(infoPopup === "work" ? DRESS_CODE_DEFINITIONS : FORMALITY_DEFINITIONS).map((d) => (
                <div key={d.term}>
                  <p className="text-sm font-medium">{d.term}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
