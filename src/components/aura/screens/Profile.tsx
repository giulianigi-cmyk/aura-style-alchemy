import { useEffect, useRef, useState } from "react";
import { Settings, Share2, ChevronRight, LogOut, Pencil, Check, X, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Screen } from "../AuraApp";
import profile1 from "@/assets/profile-1.jpg";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, calcAge } from "@/hooks/use-profile";

const STYLES = [
  "Minimal", "Editorial", "Quiet luxury", "Parisian", "Street",
  "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage", "Avant-garde", "Coastal",
];
const BRANDS = [
  "The Row", "Toteme", "Khaite", "Lemaire", "Jacquemus", "Loewe",
  "Bottega Veneta", "Celine", "Hermès", "Prada", "Chloé", "Acne Studios",
  "Saint Laurent", "Massimo Dutti", "COS", "Aritzia",
];
const GENDERS = ["Donna", "Uomo", "Preferisco non specificare"];

const seasonPalette = [
  { name: "Cream", hex: "#f5ead6" },
  { name: "Champagne", hex: "#d9bf94" },
  { name: "Camel", hex: "#b59169" },
  { name: "Taupe", hex: "#8a6f5a" },
  { name: "Cocoa", hex: "#4d3b2c" },
  { name: "Ivory", hex: "#ece3d2" },
];

export function Profile({ go: _go }: { go: (s: Screen) => void }) {
  const { user, signOut } = useAuth();
  const { profile, loading, update, uploadAvatar } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const [bio, setBio] = useState<string>("");
  const [styles, setStyles] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? "");
    setBirthDate(profile.birth_date ?? "");
    setGender(profile.gender ?? "");
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

  const onPickAvatar = async (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Please select an image"); return; }
    setUploading(true); setErr(null);
    const { error } = await uploadAvatar(f);
    setUploading(false);
    if (error) { setErr(error); toast.error("Upload failed"); }
    else toast.success("Profile photo updated");
  };

  const avatarSrc = profile?.profile_image || profile?.avatar_url || profile1;
  const displayName = profile?.full_name || "Your name";
  const meta = [profile?.city, profile?.season || "Warm Autumn"].filter(Boolean).join(" · ");

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => onPickAvatar(e.target.files?.[0] ?? null)} />

      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90"><Share2 size={15} /></button>
        <p className="font-serif text-lg italic">Profile</p>
        <button
          onClick={() => editing ? setEditing(false) : setEditing(true)}
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
          <img src={avatarSrc} alt="" className="h-full w-full rounded-full object-cover border-2 border-background" />
          <span className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center shadow-luxe">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
          </span>
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
        <section className="mx-6 mt-6 rounded-3xl bg-card border border-border/60 p-5 space-y-5 animate-fade-up">
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
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Style preferences</p>
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
          {(profile?.favorite_brands?.length ?? 0) > 0 && (
            <section className="mx-6 mt-5 animate-fade-up">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Houses</p>
              <div className="flex flex-wrap gap-2">
                {profile!.favorite_brands!.map(b => (
                  <span key={b} className="rounded-full px-3 py-1.5 text-xs bg-secondary/60">{b}</span>
                ))}
              </div>
            </section>
          )}

          {/* Color analysis */}
          <section className="mx-6 mt-6 rounded-3xl gradient-warm border border-border/60 p-6 shadow-soft animate-fade-up">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Color analysis</p>
                <h2 className="font-serif text-3xl italic mt-1">Warm Autumn</h2>
              </div>
              <button className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                Retake <ChevronRight size={12} />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-foreground/70 mt-3">
              Your complexion glows with rich, earth-toned hues. Lean into golden undertones and avoid icy or jewel-cool shades.
            </p>
            <p className="mt-5 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Your palette</p>
            <div className="mt-2 grid grid-cols-6 gap-1.5">
              {seasonPalette.map(c => (
                <div key={c.name} className="flex flex-col items-center gap-1">
                  <div className="h-10 w-10 rounded-full shadow-soft border border-white/40" style={{ background: c.hex }} />
                  <span className="text-[8px] tracking-wider text-muted-foreground">{c.name}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Menu */}
          <section className="mx-6 mt-6 divide-y divide-border/60 rounded-2xl bg-card border border-border/60 overflow-hidden">
            {([
              { l: "Wardrobe insights", s: "insights" as Screen },
              { l: "Saved outfits", s: "saved-outfits" as Screen },
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
      </div>

      <p className="text-center mt-8 text-[9px] uppercase tracking-[0.4em] text-muted-foreground">aura · v 1.0</p>
    </div>
  );
}
