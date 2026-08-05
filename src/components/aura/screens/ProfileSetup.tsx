import { useEffect, useState } from "react";
import { ArrowRight, Camera, Check, Loader2, Sparkles } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { supabase } from "@/integrations/supabase/client";
import { USERNAME_RE } from "@/lib/community";

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

export function ProfileSetup({ onDone }: { onDone: () => void }) {
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
  const [styles, setStyles] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
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
    { eyebrow: "01 · Identity", title: "What should we\ncall you?" },
    { eyebrow: "02 · You", title: "Tell us\nabout you." },
    { eyebrow: "03 · Aesthetic", title: "Your style\nlanguage." },
    { eyebrow: "04 · Houses", title: "Brands you\nlove." },
    { eyebrow: "05 · Portrait", title: "A face to\nthe wardrobe." },
  ];
  const last = step === steps.length - 1;

  const identityComplete = fullName.trim().length > 1 && usernameValid && usernameAvailable === true;

  const canAdvance = () => {
    if (step === 0) return identityComplete;
    if (step === 1) return birthDate !== "" && gender !== "";
    if (step === 2) return styles.length > 0;
    if (step === 3) return brands.length > 0;
    return true;
  };

  const finish = async () => {
    setSaving(true); setErr(null);
    const patch: any = {
      full_name: fullName.trim(),
      username,
      birth_date: birthDate || null,
      gender: gender || null,
      style_preferences: styles,
      favorite_brands: brands,
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
          onClick={() => (identityComplete ? finish() : setErr("Please pick a username before continuing."))}
          className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground"
        >Skip</button>
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
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Full name</label>
                <input
                  autoFocus value={fullName} onChange={e => setFullName(e.target.value)}
                  placeholder="Elise Moreau"
                  className="w-full bg-transparent border-b border-border py-2 font-serif text-2xl outline-none focus:border-foreground transition"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Username</label>
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
                  {username.length === 0 ? "3-20 characters: lowercase letters, numbers, underscores." :
                    !usernameValid ? "3-20 characters: lowercase letters, numbers, underscores." :
                    usernameChecking ? "Checking…" :
                    usernameAvailable === true ? "Available" :
                    usernameAvailable === false ? "Already taken" : ""}
                </p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Birth date</label>
                <input
                  type="date" max={new Date().toISOString().slice(0, 10)}
                  value={birthDate} onChange={e => setBirthDate(e.target.value)}
                  className="mt-1 w-full bg-transparent border-b border-border py-2 font-serif text-2xl outline-none focus:border-foreground transition"
                />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Gender</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {GENDERS.map(g => (
                    <button key={g} onClick={() => setGender(g)}
                      className={`rounded-full px-4 py-2 text-xs border transition ${gender === g ? "bg-foreground text-background border-foreground" : "border-border bg-card"}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-xs text-muted-foreground mb-4">Pick a few that resonate. We'll tune your styling from here.</p>
              <div className="flex flex-wrap gap-2">
                {STYLES.map(s => {
                  const on = styles.includes(s);
                  return (
                    <button key={s} onClick={() => toggle(styles, setStyles, s)}
                      className={`rounded-full px-4 py-2 text-xs border transition ${on ? "bg-foreground text-background border-foreground" : "border-border bg-card"}`}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="text-xs text-muted-foreground mb-4">Houses you already wear, admire, or aspire to.</p>
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

          {step === 4 && (
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
                <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Tap to upload</p>
              </label>
              <p className="mt-6 text-xs text-muted-foreground max-w-[260px]">Optional — but a portrait helps personalize your color analysis later.</p>
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
        >Back</button>
        <button
          onClick={next}
          disabled={!canAdvance() || saving}
          className="group flex h-14 px-6 items-center justify-center gap-3 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-[10px] transition active:scale-95 shadow-luxe disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : last ? <Check size={14} /> : <ArrowRight size={14} />}
          {last ? "Enter AURA" : "Continue"}
        </button>
      </div>
    </div>
  );
}
