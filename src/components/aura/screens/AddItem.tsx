import { X, Camera, Image as ImageIcon, Sparkles, Check, Loader2, Upload } from "lucide-react";
import type { DragEvent } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const categories = ["Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories"];
const seasonOptions = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"];
const styleOptions = ["Minimal", "Editorial", "Quiet luxury", "Street", "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage"];
const occasionOptions = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"];
const wardrobeColumns = "id,user_id,image_url,category,brand,color,season,style,occasion,created_at";
const wardrobeSchemaAuditColumns = "id,user_id,image_url";

const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);
const colorWords = ["black", "white", "cream", "ivory", "beige", "brown", "camel", "grey", "gray", "navy", "blue", "denim", "red", "pink", "green", "olive", "yellow", "gold", "silver", "purple"];
const categoryHints: Array<[string, string[]]> = [
  ["Outerwear", ["coat", "jacket", "blazer", "trench", "parka", "puffer"]],
  ["Bottoms", ["jean", "trouser", "pant", "skirt", "short"]],
  ["Dresses", ["dress", "gown", "slip"]],
  ["Shoes", ["shoe", "boot", "heel", "sneaker", "loafer", "sandal"]],
  ["Bags", ["bag", "tote", "clutch", "purse"]],
  ["Accessories", ["belt", "scarf", "hat", "jewel", "sunglasses", "watch"]],
  ["Tops", ["top", "shirt", "tee", "t-shirt", "blouse", "knit", "sweater", "cardigan"]],
];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readJwtSubject(accessToken?: string) {
  if (!accessToken) return null;
  try {
    const [, payload] = accessToken.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as {
      sub?: string;
      role?: string;
      exp?: number;
    };
    return { sub: decoded.sub ?? null, role: decoded.role ?? null, exp: decoded.exp ?? null };
  } catch (error) {
    console.warn("[AURA wardrobe] could not decode auth uid from JWT", error);
    return null;
  }
}

function describeSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error.message : "Failed to save wardrobe item.";
  }

  const e = error as { message?: string; details?: string; hint?: string; code?: string; name?: string };
  const parts = [e.message, e.details, e.hint, e.code ? `Code: ${e.code}` : null].filter(Boolean);
  return parts.join(" · ") || e.name || "Failed to save wardrobe item.";
}

async function auditWardrobeSchemaAndRls(accessToken: string, uid: string) {
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    const schemaResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/wardrobe_items?select=${encodeURIComponent(wardrobeSchemaAuditColumns)}&limit=0`,
      { headers },
    );
    let schemaBody: unknown = null;
    try { schemaBody = await schemaResponse.clone().json(); } catch { schemaBody = await schemaResponse.text(); }
    console.log("[AURA wardrobe] schema audit", {
      table: "wardrobe_items",
      expectedColumns: {
        id: "uuid",
        user_id: "uuid (must match auth.uid())",
        image_url: "text",
      },
      status: schemaResponse.status,
      ok: schemaResponse.ok,
      result: schemaBody,
    });
  } catch (error) {
    console.error("[AURA wardrobe] schema audit request failed", error);
  }

  console.log("[AURA wardrobe] RLS policy audit", {
    table: "wardrobe_items",
    requiredPolicies: {
      SELECT: "authenticated users can select rows where auth.uid() = user_id",
      INSERT: "authenticated users can insert rows with check auth.uid() = user_id",
      UPDATE: "authenticated users can update rows where auth.uid() = user_id with check auth.uid() = user_id",
      DELETE: "authenticated users can delete rows where auth.uid() = user_id",
    },
    runtimeCheck: "The actual save request below is sent with an explicit Authorization bearer token; if INSERT still fails, the logged Postgres 42501 response is the policy failure point.",
    authUid: uid,
  });
}

function fileExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && imageExtensions.has(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/heic") return "heic";
  if (file.type === "image/heif") return "heif";
  return "jpg";
}

function makeUuid() {
  const browserCrypto = globalThis.crypto;
  if (browserCrypto?.randomUUID) return browserCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  browserCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function isImageFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("image/") || imageExtensions.has(ext) || file.type === "";
}

function suggestDetails(file: File) {
  const hay = file.name.toLowerCase().replace(/[_-]/g, " ");
  const category = categoryHints.find(([, hints]) => hints.some((h) => hay.includes(h)))?.[0] ?? "Tops";
  const color = colorWords.find((c) => hay.includes(c)) ?? "";
  const styles = [
    ...(hay.includes("tailor") || hay.includes("blazer") ? ["Tailored"] : []),
    ...(hay.includes("street") || hay.includes("sneaker") || hay.includes("denim") ? ["Street"] : []),
    ...(hay.includes("vintage") ? ["Vintage"] : []),
    ...(hay.includes("romantic") || hay.includes("lace") || hay.includes("silk") ? ["Romantic"] : []),
  ];
  const occasions = [
    ...(hay.includes("work") || hay.includes("office") || hay.includes("blazer") ? ["Work"] : []),
    ...(hay.includes("evening") || hay.includes("party") || hay.includes("formal") ? ["Evening"] : []),
    ...(hay.includes("travel") ? ["Travel"] : []),
  ];
  return { category, color, seasons: ["All Seasons"], styles, occasions };
}

export function AddItem({ onClose }: { onClose: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"capture" | "details">("capture");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("Tops");
  const [color, setColor] = useState("");
  const [seasons, setSeasons] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);

  const onPick = (f: File | null) => {
    if (!f) return;
    if (!isImageFile(f)) { toast.error("Please select an image"); return; }
    const suggestions = suggestDetails(f);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setName(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    setCategory(suggestions.category);
    if (suggestions.color) setColor(suggestions.color);
    setSeasons(suggestions.seasons);
    setStyles(suggestions.styles);
    setOccasions(suggestions.occasions);
    setStep("details");
  };

  const toggle = (values: string[], setter: (next: string[]) => void, value: string) =>
    setter(values.includes(value) ? values.filter((x) => x !== value) : [...values, value]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onPick(event.dataTransfer.files?.[0] ?? null);
  };

  const save = async () => {
    if (!file) return;
    setSaving(true); setErr(null);
    try {
      // Always resolve user_id from Supabase auth (auth.uid()), never trust form/state alone.
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      console.log("[AURA wardrobe] current session", {
        hasSession: Boolean(sessionData.session),
        userId: sessionData.session?.user?.id ?? null,
        sessionError: sessionErr?.message ?? null,
      });
      if (authLoading || !user?.id) {
        throw new Error("Authentication is still loading. Please try again in a moment.");
      }
      if (sessionErr || !sessionData.session?.user?.id) {
        throw new Error("Your session is missing. Please sign in again before adding a piece.");
      }
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      console.log("[AURA wardrobe] current authenticated user", {
        userId: auth?.user?.id ?? null,
        authError: authErr?.message ?? null,
      });
      if (authErr || !auth?.user?.id) {
        throw new Error("You must be signed in to add a piece.");
      }
      const uid = auth.user.id;
      if (sessionData.session.user.id !== uid || user.id !== uid) {
        throw new Error("Authentication mismatch. Please sign in again before adding a piece.");
      }

      const ext = fileExtension(file);
      const path = `${uid}/item-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      console.log("[AURA wardrobe] uploading image", { bucket: "wardrobe", path, fileType: file.type, fileSize: file.size });
      const { data: uploadData, error: upErr } = await supabase.storage.from("wardrobe").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg",
      });
      console.log("[AURA wardrobe] upload result", { data: uploadData, error: upErr });
      if (upErr) { console.error("[AURA wardrobe] upload error", upErr); throw upErr; }
      const { data: pub } = supabase.storage.from("wardrobe").getPublicUrl(path);
      if (!pub.publicUrl) throw new Error("Upload succeeded, but no public image URL was returned.");

      const payload = {
        user_id: uid,
        brand: brand.trim() || name.trim() || null,
        category: categories.includes(category) ? category : "Tops",
        color: color.trim() || null,
        season: seasons.filter((s) => seasonOptions.includes(s)).join(", ") || null,
        style: styles.filter((s) => styleOptions.includes(s)).join(", ") || null,
        occasion: occasions.filter((o) => occasionOptions.includes(o)).join(", ") || null,
        image_url: pub.publicUrl,
      };
      console.log("[AURA wardrobe] insert payload", payload, { matchesAuthUid: payload.user_id === uid });

      const { data: inserted, error: dbErr } = await supabase.from("wardrobe_items").insert(payload).select(wardrobeColumns).single();
      console.log("[AURA wardrobe] database insert result", { data: inserted, error: dbErr });
      if (dbErr) { console.error("[AURA wardrobe] insert error", dbErr, payload); throw dbErr; }
      toast.success("Added to your closet");
      window.dispatchEvent(new CustomEvent("aura:wardrobe-item-created", { detail: inserted }));
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      setErr(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-background animate-slide-up flex flex-col">
      <header className="flex items-center justify-between px-6 pt-14 pb-3">
        <button onClick={onClose} className="h-10 w-10 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90">
          <X size={18} />
        </button>
        <p className="font-serif text-lg italic">Add a piece</p>
        <div className="w-10" />
      </header>

      <input ref={galleryRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <input ref={fileRef} type="file" accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />

      {step === "capture" ? (
        <div className="flex-1 flex flex-col px-6 pb-10">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="relative flex-1 rounded-[2rem] overflow-hidden bg-gradient-to-br from-[oklch(0.35_0.02_60)] to-[oklch(0.18_0.012_60)] mb-6"
          >
            <div className="absolute inset-0 grain opacity-30" />
            <div className="absolute inset-8 border border-white/20 rounded-2xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-white/60">
              <Sparkles size={28} className="mx-auto animate-float" />
              <p className="mt-3 text-[10px] uppercase tracking-[0.35em]">Add a garment</p>
              <p className="text-[10px] uppercase tracking-[0.35em] mt-1 opacity-60">camera · gallery · upload</p>
            </div>
            <div className="absolute bottom-5 left-0 right-0 flex items-center justify-around">
              <button onClick={() => galleryRef.current?.click()} className="text-white/70 flex flex-col items-center gap-1">
                <ImageIcon size={22} />
                <span className="text-[8px] uppercase tracking-widest">Gallery</span>
              </button>
              <button
                onClick={() => cameraRef.current?.click()}
                className="h-18 w-18 rounded-full border-4 border-white p-1 active:scale-90 transition"
                aria-label="Take photo"
              >
                <div className="h-14 w-14 rounded-full bg-white" />
              </button>
              <button onClick={() => cameraRef.current?.click()} className="text-white/70 flex flex-col items-center gap-1">
                <Camera size={20} />
                <span className="text-[8px] uppercase tracking-widest">Camera</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => galleryRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <ImageIcon size={16} />
              <span className="text-[10px] uppercase tracking-widest">From gallery</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl border border-border bg-card py-4 flex flex-col items-center gap-1.5 active:scale-95 transition"
            >
              <Upload size={16} />
              <span className="text-[10px] uppercase tracking-widest">Upload file</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-10 animate-fade-in">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="rounded-2xl overflow-hidden bg-secondary/40 aspect-[4/5]"
          >
            {preview && <img src={preview} alt="" className="h-full w-full object-cover" />}
          </div>

          <div className="mt-6 flex items-center gap-2 rounded-full bg-[var(--champagne)]/20 border border-[var(--champagne)]/40 px-3.5 py-2 w-fit">
            <Sparkles size={12} />
            <span className="text-[10px] uppercase tracking-widest">All fields are optional</span>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Name" value={name} onChange={setName} />
            <Field label="Brand" value={brand} onChange={setBrand} placeholder="optional" />
            <Field label="Color" value={color} onChange={setColor} placeholder="e.g. cream · warm" />

            <ChipGroup label="Category" options={categories} value={category} onChange={setCategory} />

            <div className="border-b border-border/60 pb-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Season</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {seasonOptions.map(s => {
                  const on = seasons.includes(s);
                  return (
                    <button key={s} onClick={() => toggle(seasons, setSeasons, s)}
                      className={`rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60"}`}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <MultiChipGroup label="Style" options={styleOptions} values={styles} onToggle={(v: string) => toggle(styles, setStyles, v)} />
            <MultiChipGroup label="Occasion" options={occasionOptions} values={occasions} onToggle={(v: string) => toggle(occasions, setOccasions, v)} />
          </div>

          {err && <p className="mt-4 text-xs text-red-700">{err}</p>}

          <button
            onClick={save}
            disabled={saving || authLoading}
            className="mt-8 w-full h-14 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] transition shadow-luxe disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            <span className="text-xs uppercase tracking-[0.3em]">Save to closet</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full bg-transparent font-serif text-lg outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );
}

function ChipGroup({ label, options, value, onChange, clearable }: { label: string; options: string[]; value: string; onChange: (v: string) => void; clearable?: boolean }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(o => (
          <button key={o}
            onClick={() => onChange(clearable && value === o ? "" : o)}
            className={`rounded-full px-3 py-1.5 text-xs transition ${value === o ? "bg-foreground text-background" : "bg-secondary/60"}`}
          >{o}</button>
        ))}
      </div>
    </div>
  );
}

function MultiChipGroup({ label, options, values, onToggle }: { label: string; options: string[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="border-b border-border/60 pb-3">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(o => {
          const on = values.includes(o);
          return (
            <button key={o}
              onClick={() => onToggle(o)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${on ? "bg-foreground text-background" : "bg-secondary/60"}`}
            >{o}</button>
          );
        })}
      </div>
    </div>
  );
}
