import { useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, calcAge } from "@/hooks/use-profile";

const GENDERS = ["Woman", "Man", "Prefer not to say"];
const INDUSTRIES = [
  "Finance / Legal", "Consulting / Corporate", "Tech / Startup",
  "Fashion / Creative", "Healthcare", "Education", "Hospitality / Retail",
  "Media / Marketing", "Public sector", "Other",
];
// Display-label translation, same pattern as ProfileSetup.tsx — the
// underlying value written to the DB stays the fixed English string.
const GENDER_KEYS: Record<string, string> = {
  Woman: "settings.genderWoman",
  Man: "settings.genderMan",
  "Prefer not to say": "settings.genderPreferNotToSay",
};
const INDUSTRY_KEYS: Record<string, string> = {
  "Finance / Legal": "settings.industryFinanceLegal",
  "Consulting / Corporate": "settings.industryConsultingCorporate",
  "Tech / Startup": "settings.industryTechStartup",
  "Fashion / Creative": "settings.industryFashionCreative",
  "Healthcare": "settings.industryHealthcare",
  "Education": "settings.industryEducation",
  "Hospitality / Retail": "settings.industryHospitalityRetail",
  "Media / Marketing": "settings.industryMediaMarketing",
  "Public sector": "settings.industryPublicSector",
  "Other": "settings.industryOther",
};

export function PersonalInfo({ go }: { go: (s: Screen) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile, update } = useProfile();
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [industry, setIndustry] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setBirthDate(profile.birth_date ?? "");
    setGender(profile.gender ?? "");
    setIndustry(profile.industry ?? "");
  }, [profile]);

  const save = async () => {
    setSaving(true);
    const { error } = await update({
      birth_date: birthDate || null,
      gender: gender || null,
      industry: industry || null,
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
        <p className="font-serif text-lg italic">{t("settings.personalInfo")}</p>
        <span className="w-10" />
      </header>

      <section className="mx-6 mt-6 space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("settings.email")}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{user?.email}</p>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("settings.birthDate")}</label>
          <input
            type="date" max={new Date().toISOString().slice(0, 10)}
            value={birthDate} onChange={e => setBirthDate(e.target.value)}
            className="mt-1 w-full bg-transparent border-b border-border py-1.5 font-serif text-xl outline-none focus:border-foreground transition"
          />
          {birthDate && (
            <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              {t("settings.age")} · {calcAge(birthDate) ?? "—"}
            </p>
          )}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("settings.gender")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {GENDERS.map(g => (
              <button key={g} onClick={() => setGender(g)}
                className={`rounded-full px-3 py-1.5 text-xs border transition ${gender === g ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                {t(GENDER_KEYS[g])}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("settings.industry")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {INDUSTRIES.map(i => (
              <button key={i} onClick={() => setIndustry(i)}
                className={`rounded-full px-3 py-1.5 text-xs border transition ${industry === i ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                {t(INDUSTRY_KEYS[i])}
              </button>
            ))}
          </div>
        </div>

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
