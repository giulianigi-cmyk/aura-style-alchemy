import { useEffect, useState } from "react";
import { ArrowRight, Camera, Check, Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { USERNAME_RE } from "@/lib/community";
import i18n, { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, type SupportedLanguage } from "@/i18n/config";

const STYLES = [
  "Minimal", "Editorial", "Quiet luxury", "Parisian", "Street",
  "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage", "Avant-garde", "Coastal",
];
const BRANDS = [
  "The Row", "Toteme", "Khaite", "Lemaire", "Jacquemus", "Loewe",
  "Bottega Veneta", "Celine", "Hermès", "Prada", "Chloé", "Acne Studios",
  "Saint Laurent", "Massimo Dutti", "COS", "Aritzia",
];
const GENDERS = ["Woman", "Man", "Prefer not to say"];
// Same duplication noted in PersonalInfo.tsx/Profile.tsx — this file has
// its own copy of the gender list rather than sharing one, pre-existing
// and out of scope to unify here. Just translating the display label,
// not the underlying value written to the DB.
const GENDER_KEYS: Record<string, string> = {
  Woman: "profileSetup.genderWoman",
  Man: "profileSetup.genderMan",
  "Prefer not to say": "profileSetup.genderPreferNotToSay",
};

export function ProfileSetup({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { update, uploadAvatar } = useProfile();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [birthDate, setBirthDate] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const [language, setLanguage] = useState<SupportedLanguage | "">("");
  const [styles, setStyles] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [shareLibrary, setShareLibrary] = useState(false);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const usernameValid = USERNAME_RE.test(username);

  useEffect(() => {
    if (!usernameValid) { setUsernameAvailable(null); return; }
    setUsernameChecking(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("username_available", { _username: username });
      setUsernameChecking(false);
      setUsernameAvailable(error ? null : Boolean(data));
    }, 400);
    return () => { clearTimeout(t); setUsernameChecking(false); };
  }, [username, usernameValid]);

  const toggle = (list: string[], setList: (v: string[]) => void, v: string) =>
    setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const steps = [
    { eyebrow: t("profileSetup.step0Eyebrow"), title: t("profileSetup.step0Title") },
    { eyebrow: t("profileSetup.step1Eyebrow"), title: t("profileSetup.step1Title") },
    { eyebrow: t("profileSetup.step2Eyebrow"), title: t("profileSetup.step2Title") },
    { eyebrow: t("profileSetup.step3Eyebrow"), title: t("profileSetup.step3Title") },
    { eyebrow: t("profileSetup.step4Eyebrow"), title: t("profileSetup.step4Title") },
    { eyebrow: t("profileSetup.step5Eyebrow"), title: t("profileSetup.step5Title") },
  ];
  const last = step === steps.length - 1;

  const identityComplete = fullName.trim().length > 1 && usernameValid && usernameAvailable === true;

  const canAdvance = () => {
    if (step === 0) return language !== "";
    if (step === 1) return identityComplete;
    if (step === 2) return birthDate !== "" && gender !== "";
    if (step === 3) return styles.length > 0;
    if (step === 4) return brands.length > 0;
    return true;
  };

  const finish = async () => {
    setSaving(true); setErr(null);
    const patch: any = {
      full_name: fullName.trim(),
      username,
      birth_date: birthDate || null,
      gender: gender || null,
      language: language || null,
      style_preferences: styles,
      favorite_brands: brands,
      share_wardrobe_to_library: shareLibrary,
      setup_complete: true,
    };
    const { error } = await update(patch);
    if (error) { setErr(error); setSaving(false); return; }
    if (avatar) await uploadAvatar(avatar);
    setSaving(false);
    onDone();
  };

  const next = () => { if (last) finish(); else setStep(s => s + 1); };

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <header className="px-8 pt-14 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={12} />
          <span className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">AURA</span>
        </div>
        <button
          onClick={() => (identityComplete ? finish() : setErr(t("profileSetup.pickUsernameFirst")))}
          className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground"
        >{t("profileSetup.skip")}</button>
      </header>

      <div className="px-8 mt-4 flex gap-1.5">
        {steps.map((_, i) => (
          <span key={i} className={`h-[2px] flex-1 rounded-full transition-all ${i <= step ? "bg-foreground" : "bg-foreground/15"}`} />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pt-10 pb-6 animate-fade-up" key={step}>
        <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">{steps[step].eyebrow}</p>
        <h1 className="mt-3 font-serif text-[40px] leading-[1.05] italic whitespace-pre-line">{steps[step].title}</h1>

        <div className="mt-8">
          {step === 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-4">{t("profileSetup.languageHint")}</p>
              <div className="flex flex-col gap-2">
                {SUPPORTED_LANGUAGES.map(code => (
                  <button
                    key={code}
                    onClick={() => { setLanguage(code); void i18n.changeLanguage(code); }}
                    className={`flex items-center justify-between rounded-2xl px-5 py-4 text-left border transition ${language === code ? "bg-foreground text-background border-foreground" : "border-border bg-card"}`}
                  >
                    <span className="font-serif text-lg">{LANGUAGE_LABELS[code]}</span>
                    {language === code && <Check size={16} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("profileSetup.fullNameLabel")}</label>
                <input
                  autoFocus value={fullName} onChange={e => setFullName(e.target.value)}
                  placeholder="Elise Moreau"
                  className="w-full bg-transparent border-b border-border py-2 font-serif text-2xl outline-none focus:border-foreground transition"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("profileSetup.usernameLabel")}</label>
                <div className="flex items-center border-b border-border focus-within:border-foreground transition">
                  <span className="text-2xl font-serif text-muted-foreground">@</span>
                  <input
                    value={username}
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="username"
                    className="flex-1 bg-transparent py-2 pl-1 font-serif text-2xl outline-none"
                  />
                  {usernameChecking && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                </div>
                <p className="text-[11px] text-muted-foreground h-4">
                  {username.length === 0 ? t("profileSetup.usernameRules") :
                    !usernameValid ? t("profileSetup.usernameRules") :
                    usernameChecking ? t("profileSetup.checking") :
                    usernameAvailable === true ? t("profileSetup.available") :
                    usernameAvailable === false ? t("profileSetup.alreadyTaken") : ""}
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("profileSetup.birthDateLabel")}</label>
                <input
                  type="date" max={new Date().toISOString().slice(0, 10)}
                  value={birthDate} onChange={e => setBirthDate(e.target.value)}
                  className="mt-1 w-full bg-transparent border-b border-border py-2 font-serif text-2xl outline-none focus:border-foreground transition"
                />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("profileSetup.genderLabel")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {GENDERS.map(g => (
                    <button key={g} onClick={() => setGender(g)}
                      className={`rounded-full px-4 py-2 text-xs border transition ${gender === g ? "bg-foreground text-background border-foreground" : "border-border bg-card"}`}>
                      {t(GENDER_KEYS[g])}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="text-xs text-muted-foreground mb-4">{t("profileSetup.stylesHint")}</p>
              <div className="flex flex-wrap gap-2">
                {STYLES.map(s => {
                  const on = styles.includes(s);
                  return (
                    <button key={s} onClick={() => toggle(styles, setStyles, s)}
                      className={`rounded-full px-4 py-2 text-xs border transition ${on ? "bg-foreground text-background border-foreground" : "border-border bg-card"}`}>
                      {t(`profileScreen.styleTerm.${s}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <p className="text-xs text-muted-foreground mb-4">{t("profileSetup.brandsHint")}</p>
              <div className="flex flex-wrap gap-2">
                {BRANDS.map(b => {
                  const on = brands.includes(b);
                  return (
                    <button key={b} onClick={() => toggle(brands, setBrands, b)}
                      className={`rounded-full px-4 py-2 text-xs border transition ${on ? "bg-foreground text-background border-foreground" : "border-border bg-card"}`}>
                      {b}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col items-center text-center">
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]; if (!f) return;
                    setAvatar(f); setAvatarPreview(URL.createObjectURL(f));
                  }} />
                <div className="h-40 w-40 rounded-full p-[3px] bg-gradient-to-br from-[var(--champagne)] to-[var(--taupe)]">
                  <div className="h-full w-full rounded-full bg-secondary border-2 border-background overflow-hidden flex items-center justify-center text-muted-foreground">
                    {avatarPreview
                      ? <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                      : <Camera size={28} />}
                  </div>
                </div>
                <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("profileSetup.tapToUpload")}</p>
              </label>
              {/* Explicit "profile photo, not a wardrobe photo" framing —
                  this was previously only implied by the (English-only)
                  hint text below, easy to miss for anyone who can't read
                  it, or who's used to the wardrobe photo-capture flow
                  looking visually similar. */}
              <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("profileSetup.profilePhotoLabel")}</p>
              <p className="mt-2 text-xs text-muted-foreground max-w-[260px]">{t("profileSetup.profilePhotoHint")}</p>

              {/* Consenso libreria condivisa: checkbox VUOTA, opt-in esplicito. */}
              <button
                type="button"
                role="checkbox"
                aria-checked={shareLibrary}
                onClick={() => setShareLibrary(v => !v)}
                className="mt-8 w-full flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99] transition"
              >
                <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition ${shareLibrary ? "bg-foreground border-foreground text-background" : "border-border"}`}>
                  {shareLibrary && <Check size={12} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm">{t("profileSetup.shareLibraryLabel")}</span>
                  <span className="block text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    {t("profileSetup.shareLibraryDetail")}
                  </span>
                </span>
              </button>
            </div>
          )}

        </div>

        {err && <p className="mt-4 text-xs text-red-700">{err}</p>}
      </div>

      <div className="px-8 pb-10 pt-2 flex items-center justify-between">
        <button
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
          className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground disabled:opacity-30"
        >{t("profileSetup.back")}</button>
        <button
          onClick={next}
          disabled={!canAdvance() || saving}
          className="group flex h-14 px-6 items-center justify-center gap-3 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-[10px] transition active:scale-95 shadow-luxe disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : last ? <Check size={14} /> : <ArrowRight size={14} />}
          {last ? t("profileSetup.enterAura") : t("profileSetup.continue")}
        </button>
      </div>
    </div>
  );
}
