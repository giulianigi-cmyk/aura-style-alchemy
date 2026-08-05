import { useEffect, useRef, useState } from "react";
import { Settings, Share2, ChevronRight, LogOut, Pencil, Check, X, Camera, Loader2, User, Info } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, calcAge } from "@/hooks/use-profile";
import { WeatherPanel } from "../WeatherPanel";
import { CalendarConnectionSection } from "../CalendarConnectionSection";
import { MyBrands } from "../MyBrands";
import { supabase } from "@/integrations/supabase/client";
import { sizeEquivalences } from "@/lib/size-conversion";
import { AvatarCropper } from "../AvatarCropper";
import { DressPreferencesSection } from "../DressPreferencesSection";
import { USERNAME_RE } from "@/lib/community";
import { AURA_APP_URL, nativeShareText } from "@/lib/aura-share";


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
const INDUSTRIES = [
  "Finance / Legal", "Consulting / Corporate", "Tech / Startup",
  "Fashion / Creative", "Healthcare", "Education", "Hospitality / Retail",
  "Media / Marketing", "Public sector", "Other",
];
const WORK_DRESS_CODES = ["None", "Casual", "Smart Casual", "Business Casual", "Business Formal", "Uniform"];
const PERSONAL_FORMALITY = ["Very casual", "Casual", "Smart Casual", "Elegant", "Very elegant"];

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

const STYLE_DEFINITIONS: { term: string; description: string }[] = [
  { term: "Minimal", description: "Clean lines, few colors, no clutter — quality over decoration." },
  { term: "Editorial", description: "Fashion-forward, styled like a magazine spread — bold silhouettes and combinations." },
  { term: "Quiet luxury", description: "Understated, high-quality basics with no visible logos." },
  { term: "Parisian", description: "Effortless, timeless French style — trench coats, striped tops, tailored basics." },
  { term: "Street", description: "Casual, urban-inspired — sneakers, oversized fits, streetwear brands." },
  { term: "Romantic", description: "Soft, feminine details — ruffles, florals, flowing fabrics." },
  { term: "Tailored", description: "Structured, fitted pieces — blazers, precise cuts." },
  { term: "Bohemian", description: "Free-spirited, textured, layered — prints, fringe, natural fabrics." },
  { term: "Sporty", description: "Athletic-inspired — activewear, sneakers, technical fabrics." },
  { term: "Vintage", description: "Inspired by past decades — retro cuts, patterns and details." },
  { term: "Avant-garde", description: "Experimental, unconventional shapes and combinations." },
  { term: "Coastal", description: "Relaxed, breezy, beach-inspired — linen, light colors, natural textures." },
];


export function Profile({ go: _go }: { go: (s: Screen) => void }) {
  const { user, signOut } = useAuth();
  const { profile, avatarUrl, loading, update, uploadAvatar } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");
  const [workDressCode, setWorkDressCode] = useState<string>("");
  const [personalFormality, setPersonalFormality] = useState<string>("");
  const [infoPopup, setInfoPopup] = useState<"work" | "formality" | "style" | null>(null);
  const [profession, setProfession] = useState<string>("");
  const [bio, setBio] = useState<string>("");
  const [styles, setStyles] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? "");
    setBirthDate(profile.birth_date ?? "");
    setGender(profile.gender ?? "");
    setIndustry(profile.industry ?? "");
    setWorkDressCode(profile.work_dress_code ?? "");
    setPersonalFormality(profile.personal_formality ?? "");
    setProfession(profile.profession ?? "");
    setBio(profile.bio ?? "");
    setStyles(profile.style_preferences ?? []);
    setBrands(profile.favorite_brands ?? []);
  }, [profile]);

  const toggle = (list: string[], setList: (v: string[]) => void, v: string) =>
    setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const save = async () => {
    setSaving(true); setErr(null);
    const { error } = await update({
      full_name: fullName.trim() || null,
      birth_date: birthDate || null,
      gender: gender || null,
      industry: industry || null,
      work_dress_code: workDressCode || null,
      personal_formality: personalFormality || null,
      profession: profession.trim() || null,
      bio: bio.trim() || null,
      style_preferences: styles,
      favorite_brands: brands,
      setup_complete: true,
    });
    setSaving(false);
    if (error) { setErr(error); toast.error("Couldn't save profile"); return; }
    toast.success("Profile updated");
    setEditing(false);
  };

  const onPickAvatar = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Please select an image"); return; }
    const reader = new FileReader();
    reader.onload = () => setCropSrc(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => toast.error("Couldn't read image");
    reader.readAsDataURL(f);
  };

  const onCropSave = async (blob: Blob) => {
    setUploading(true); setErr(null);
    const file = new File([blob], `avatar-${Date.now()}.jpg`, { type: "image/jpeg" });
    const { error } = await uploadAvatar(file);
    setUploading(false);
    setCropSrc(null);
    if (error) { setErr(error); toast.error("Upload failed"); }
    else toast.success("Profile photo updated");
  };

  const openEditPhoto = () => {
    if (!avatarUrl && !profile?.avatar_url) { fileRef.current?.click(); return; }
    setCropSrc(avatarUrl || profile?.avatar_url || null);
  };

  const avatarSrc = avatarUrl || profile?.avatar_url || null;
  const displayName = profile?.full_name || "Your name";
  const meta = [profile?.city, profile?.season].filter(Boolean).join(" · ");

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      {cropSrc && (
        <AvatarCropper src={cropSrc} onCancel={() => setCropSrc(null)} onSave={onCropSave} />
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { onPickAvatar(e.target.files?.[0] ?? null); if (fileRef.current) fileRef.current.value = ""; }} />

      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
       <button
          onClick={async () => {
            const who = profile?.full_name || "me";
            const result = await nativeShareText({
              title: "AURA",
              text: `Follow ${who} on AURA — download the app:`,
              url: AURA_APP_URL,
            });
            if (result === "copied") toast.success("Link copied");
            if (result === "failed") toast.error("Couldn't share right now");
          }}
          aria-label="Share profile"
          className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
        ><Share2 size={15} /></button>
        <h1 className="font-serif text-lg italic">Profile</h1>
        <button
          onClick={() => editing ? setEditing(false) : setEditing(true)}
          aria-label={editing ? "Cancel editing profile" : "Edit profile"}
          className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"
        >
          {editing ? <X size={15} /> : <Pencil size={14} />}
        </button>
      </header>

      {/* Identity */}
      <section className="mt-4 flex flex-col items-center text-center px-6">
        <button
          onClick={() => fileRef.current?.click()}
          className="relative h-24 w-24 rounded-full p-[3px] bg-gradient-to-br from-[var(--champagne)] to-[var(--taupe)] animate-scale-in active:scale-95 transition"
        >
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="h-full w-full rounded-full object-cover border-2 border-background" />
          ) : (
            <div className="h-full w-full rounded-full bg-secondary/80 border-2 border-background flex items-center justify-center">
              <User size={32} className="text-muted-foreground" strokeWidth={1.5} />
            </div>
          )}
          <span className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center shadow-luxe">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
          </span>
        </button>
        <button
          onClick={openEditPhoto}
          className="mt-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground active:text-foreground transition"
        >
          Edit photo
        </button>

        {editing ? (
          <input
            value={fullName} onChange={e => setFullName(e.target.value)}
            placeholder="Full name"
            className="mt-4 bg-transparent border-b border-border text-center font-serif text-3xl outline-none focus:border-foreground transition w-[80%]"
          />
        ) : (
          <h1 className="font-serif text-3xl mt-3">{displayName}</h1>
        )}
        <MyUsername userId={user?.id} />
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mt-1">
          {meta || "Tap edit to complete profile"}
        </p>

        <div className="mt-4 flex gap-8">
          {[
            { n: profile?.favorite_brands?.length ?? 0, l: "Brands" },
            { n: profile?.style_preferences?.length ?? 0, l: "Styles" },
            { n: calcAge(profile?.birth_date) ?? "—", l: "Age" },
          ].map(s => (
            <div key={s.l} className="text-center">
              <p className="font-serif text-xl">{s.n}</p>
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Editable details */}
      {editing && (
        <section className="mx-6 mt-6 rounded-3xl gradient-warm border border-border/60 p-5 space-y-5 animate-fade-up">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Birth date</p>
            <input
              type="date" max={new Date().toISOString().slice(0, 10)}
              value={birthDate} onChange={e => setBirthDate(e.target.value)}
              className="mt-1 w-full bg-transparent border-b border-border py-1.5 font-serif text-xl outline-none focus:border-foreground transition"
            />
            {birthDate && (
              <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Age · {calcAge(birthDate) ?? "—"}
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Gender</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {GENDERS.map(g => (
                <button key={g} onClick={() => setGender(g)}
                  className={`rounded-full px-3 py-1.5 text-xs border transition ${gender === g ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Industry</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">Optional — soft context AURA weighs alongside your work dress code and personal style, never a fixed rule.</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {INDUSTRIES.map(i => (
                <button key={i} onClick={() => setIndustry(i)}
                  className={`rounded-full px-3 py-1.5 text-xs border transition ${industry === i ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Usual work dress code</p>
              <button onClick={() => setInfoPopup("work")} aria-label="What do these terms mean?" className="text-muted-foreground active:scale-90">
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
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Your everyday formality</p>
              <button onClick={() => setInfoPopup("formality")} aria-label="What do these terms mean?" className="text-muted-foreground active:scale-90">
                <Info size={12} />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">So AURA never suggests a blazer to someone who hates them, even when "technically correct".</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {PERSONAL_FORMALITY.map(f => (
                <button key={f} onClick={() => setPersonalFormality(f)}
                  className={`rounded-full px-3 py-1.5 text-xs border transition ${personalFormality === f ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          {infoPopup && (
            <div
              className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-center justify-center px-6"
              onClick={() => setInfoPopup(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-luxe max-h-[70vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between">
                  <p className="font-serif text-lg italic">
                    {infoPopup === "work" ? "Dress code terms" : infoPopup === "formality" ? "Formality terms" : "Style terms"}
                  </p>
                  <button
                    onClick={() => setInfoPopup(null)}
                    aria-label="Close"
                    className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
                  ><X size={14} /></button>
                </div>
                <div className="mt-4 space-y-3">
                  {(infoPopup === "work" ? DRESS_CODE_DEFINITIONS : infoPopup === "formality" ? FORMALITY_DEFINITIONS : STYLE_DEFINITIONS).map((d) => (
                    <div key={d.term}>
                      <p className="text-sm font-medium">{d.term}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Profession / role</p>
            <input
              value={profession} onChange={e => setProfession(e.target.value)}
              placeholder="e.g. Product Manager, Lawyer, Founder — optional"
              className="mt-1 w-full bg-transparent border-b border-border py-1.5 text-sm outline-none focus:border-foreground transition"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Style preferences</p>
              <button onClick={() => setInfoPopup("style")} aria-label="What do these terms mean?" className="text-muted-foreground active:scale-90">
                <Info size={12} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {STYLES.map(s => {
                const on = styles.includes(s);
                return (
                  <button key={s} onClick={() => toggle(styles, setStyles, s)}
                    className={`rounded-full px-3 py-1.5 text-xs border transition ${on ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Favorite brands</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BRANDS.map(b => {
                const on = brands.includes(b);
                return (
                  <button key={b} onClick={() => toggle(brands, setBrands, b)}
                    className={`rounded-full px-3 py-1.5 text-xs border transition ${on ? "bg-foreground text-background border-foreground" : "border-border bg-background"}`}>
                    {b}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Bio</p>
            <textarea
              value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={240}
              placeholder="A line or two about your style…"
              className="mt-1 w-full bg-transparent border-b border-border py-2 text-sm outline-none focus:border-foreground transition resize-none"
            />
            <p className="text-right text-[9px] uppercase tracking-[0.3em] text-muted-foreground">{bio.length}/240</p>
          </div>

          {err && <p className="text-xs text-red-700">{err}</p>}

          <button
            onClick={save} disabled={saving}
            className="w-full h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            <span className="text-[10px] uppercase tracking-[0.3em]">Save changes</span>
          </button>
        </section>
      )}

      {/* Read-only summary chips */}
      {!editing && (
        <>
          {profile?.bio && (
            <section className="mx-6 mt-6 animate-fade-up">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Bio</p>
              <p className="text-sm leading-relaxed text-foreground/80">{profile.bio}</p>
            </section>
          )}
          {(profile?.style_preferences?.length ?? 0) > 0 && (
            <section className="mx-6 mt-6 animate-fade-up">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Style</p>
              <div className="flex flex-wrap gap-2">
                {profile!.style_preferences!.map(s => (
                  <span key={s} className="rounded-full px-3 py-1.5 text-xs bg-secondary/60">{s}</span>
                ))}
              </div>
            </section>
          )}
          <MyBrands />
          <MySizes userId={user?.id} />
          <DressPreferencesSection userId={user?.id} />

          {/* Color analysis */}
          <button
            onClick={() => _go("color-analysis")}
            className="mx-6 mt-6 w-[calc(100%-3rem)] text-left rounded-3xl gradient-warm border border-border/60 p-6 shadow-soft animate-fade-up active:scale-[0.99] transition"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Color analysis</p>
                <h2 className="font-serif text-3xl italic mt-1">
                  {profile?.season || "Discover your season"}
                </h2>
                {profile?.season ? (
                  <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Estimated{[profile?.value, profile?.clarity].filter(Boolean).length ? ` · ${[profile?.value, profile?.clarity].filter(Boolean).join(" · ")}` : ""}
                  </p>
                ) : null}
              </div>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 shrink-0">
                {profile?.season ? "Retake" : "Start"} <ChevronRight size={12} />
              </span>
            </div>
            <p className="text-xs leading-relaxed text-foreground/70 mt-3">
              A quick, camera-based estimate of the color season that flatters you — never a verified verdict.
            </p>
          </button>

                    <WeatherPanel />
          <CalendarConnectionSection />


          {/* Menu */}
          <section className="mx-6 mt-6 divide-y divide-border/60 rounded-2xl bg-background border border-border/60 overflow-hidden">
            {([
              { l: "Wardrobe insights", s: "insights" as Screen },
              { l: "Saved outfits", s: "saved-outfits" as Screen },
              { l: "Community", s: "community" as Screen },
              { l: "Notifications", s: "notifications" as Screen },
              { l: "Invite friends", s: "invite" as Screen },

            ]).map(({ l, s }) => (
              <button key={l} onClick={() => _go(s)} className="w-full flex items-center justify-between px-5 py-4 active:bg-secondary/40 transition">
                <span className="text-sm">{l}</span>
                <ChevronRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </section>
        </>
      )}

      <div className="px-6 mt-6">
        <p className="text-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">{user?.email}</p>
        <button
          onClick={signOut}
          className="w-full h-12 rounded-full border border-border flex items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] active:scale-[0.98]"
        >
          <LogOut size={14} /> Sign out
        </button>
        <button
          onClick={() => _go("storage-debug")}
          className="w-full h-10 mt-3 rounded-full border border-dashed border-border text-[10px] uppercase tracking-[0.3em] text-muted-foreground active:scale-[0.98]"
        >
          Storage debug (temporary)
        </button>
      </div>


      <p className="text-center mt-8 text-[9px] uppercase tracking-[0.4em] text-muted-foreground">aura · v 1.0</p>
    </div>
  );
}

type SizeKey = "tops" | "bottoms" | "dresses" | "shoes";
const SIZE_FIELDS: { key: SizeKey; label: string; shoes?: boolean }[] = [
  { key: "tops", label: "Tops" },
  { key: "bottoms", label: "Bottoms" },
  { key: "dresses", label: "Dresses" },
  { key: "shoes", label: "Shoes", shoes: true },
];
function MyUsername({ userId }: { userId: string | undefined }) {
  const [username, setUsername] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const valid = USERNAME_RE.test(value);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
      if (!cancelled) {
        setUsername((data as { username?: string | null } | null)?.username ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!editing || !valid || value === username) { setAvailable(null); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("username_available", { _username: value });
      setChecking(false);
      setAvailable(error ? null : Boolean(data));
    }, 400);
    return () => { clearTimeout(t); setChecking(false); };
  }, [value, valid, editing, username]);

  const startEdit = () => { setValue(username ?? ""); setEditing(true); };

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ username: value } as never).eq("id", userId);
    setSaving(false);
    if (error) {
      if (error.code === "23505") { setAvailable(false); toast.error("Username is no longer available."); }
      else toast.error(error.message);
      return;
    }
    setUsername(value);
    setEditing(false);
    toast.success("Username saved");
  };

  const unchanged = value === username;

  return (
    <div className="mt-1">
      {!editing ? (
        <button
          onClick={startEdit}
          className="flex items-center justify-center gap-1.5 mx-auto active:opacity-70 transition"
        >
          <span className="font-serif italic text-sm text-muted-foreground">
            {loading ? "" : username ? `@${username}` : "Set a username"}
          </span>
          <Pencil size={11} className="text-muted-foreground" />
        </button>
      ) : (
        <div className="flex flex-col items-center gap-1.5 mt-1">
          <div className="flex items-center gap-1.5">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.toLowerCase().replace(/\s+/g, ""))}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="username"
              autoFocus
              className="bg-secondary/60 rounded-full px-3 py-1 text-xs outline-none placeholder:text-muted-foreground w-32 text-center"
            />
            <button
              onClick={() => void save()}
              disabled={!valid || saving || (!unchanged && available !== true)}
              aria-label="Save username"
              className="h-6 w-6 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90 disabled:opacity-40"
            >
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
            </button>
            <button
              onClick={() => setEditing(false)}
              aria-label="Cancel"
              className="h-6 w-6 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
            ><X size={10} /></button>
          </div>
          <p className="text-[10px] text-muted-foreground h-3">
            {value.length === 0 ? "" :
              !valid ? "3-20 chars: lowercase, numbers, underscores" :
              unchanged ? "" :
              checking ? "Checking…" :
              available === true ? "Available" :
              available === false ? "Already taken" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function MySizes({ userId }: { userId: string | undefined }) {
  const empty: Record<SizeKey, string> = { tops: "", bottoms: "", dresses: "", shoes: "" };
  const [values, setValues] = useState<Record<SizeKey, string>>(empty);
  const [snapshot, setSnapshot] = useState<Record<SizeKey, string>>(empty);
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
        .select("sizes")
        .eq("id", userId)
        .maybeSingle();
      if (!cancelled) {
        if (error) console.error("[AURA sizes] load", error);
        const s = (data as { sizes?: Partial<Record<SizeKey, string>> } | null)?.sizes ?? {};
        const loaded = {
          tops: s.tops ?? "",
          bottoms: s.bottoms ?? "",
          dresses: s.dresses ?? "",
          shoes: s.shoes ?? "",
        };
        setValues(loaded);
        setSnapshot(loaded);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const dirty = (Object.keys(values) as SizeKey[]).some((k) => values[k] !== snapshot[k]);

  const startEdit = () => { setSnapshot(values); setEditing(true); };
  const cancelEdit = () => { setValues(snapshot); setEditing(false); };

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
    setSnapshot(values);
    setEditing(false);
    toast.success("Sizes saved");
  };

  return (
    <section className="mx-6 mt-4 rounded-3xl gradient-warm border border-border/60 p-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">My sizes</p>
        {editing ? (
          <button
            onClick={cancelEdit}
            aria-label="Cancel editing sizes"
            className="h-7 w-7 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
          ><X size={12} /></button>
        ) : (
          <button
            onClick={startEdit}
            aria-label="Edit sizes"
            className="h-7 w-7 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
          ><Pencil size={12} /></button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        {SIZE_FIELDS.map((f) => {
          const v = values[f.key];
          const hint = sizeEquivalences(v, f.shoes ? { shoes: true } : undefined);
          return (
            <div key={f.key} className="border-b border-border/60 pb-2">
              <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">{f.label}</p>
              {editing ? (
                <>
                  <input
                    value={v}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.shoes ? "38" : "42 / M"}
                    className="mt-0.5 w-full bg-transparent font-serif text-base outline-none placeholder:text-muted-foreground/50"
                  />
                  {hint && <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{hint}</p>}
                </>
              ) : (
                <>
                  <p className="mt-0.5 font-serif text-base">{loading ? "…" : v || "—"}</p>
                  {v && hint && <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{hint}</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
      {editing && (
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="mt-4 w-full h-11 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          <span className="text-[10px] uppercase tracking-[0.3em]">Save sizes</span>
        </button>
      )}
    </section>
  );
}
