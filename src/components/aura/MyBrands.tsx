import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X, Sparkles, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BRAND_NAMES, canonicalBrandKey } from "@/lib/brand-domains";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";

type Suggestion = { brand: string; count: number; pct: number } | null;

const DISMISS_KEY = "aura.brands.dismissedSuggestions";

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.map((v) => String(v)) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function MyBrands() {
  const { user } = useAuth();
  const { profile, update } = useProfile();
  const [brands, setBrands] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBrands(profile?.owned_brands ?? []);
  }, [profile?.owned_brands]);

  const persist = async (next: string[]) => {
    setSaving(true);
    const { error } = await update({ owned_brands: next });
    setSaving(false);
    if (error) toast.error("Couldn't save brands");
  };

  const addBrand = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (brands.some(b => canonicalBrandKey(b) === canonicalBrandKey(trimmed))) {
      setQuery(""); setOpen(false); return;
    }
    const next = [...brands, trimmed];
    setBrands(next);
    setQuery(""); setOpen(false);
    void persist(next);
  };

  const removeBrand = (name: string) => {
    const next = brands.filter(b => b !== name);
    setBrands(next);
    void persist(next);
  };

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const owned = new Set(brands.map(canonicalBrandKey));
    return BRAND_NAMES.filter(b => b.toLowerCase().includes(q) && !owned.has(canonicalBrandKey(b))).slice(0, 8);
  }, [query, brands]);

  const canAddCustom =
    query.trim().length > 0 &&
    !suggestions.some(s => canonicalBrandKey(s) === canonicalBrandKey(query)) &&
    !brands.some(b => canonicalBrandKey(b) === canonicalBrandKey(query));

  const checkWardrobeSuggestion = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("wardrobe_items").select("brand").eq("user_id", user.id);
    if (error || !data || data.length < 3) return;

    // Count wardrobe brands by canonical key, keeping the first pretty label seen.
    const counts = new Map<string, { label: string; count: number }>();
    for (const row of data) {
      const label = (row.brand ?? "").trim();
      const key = canonicalBrandKey(label);
      if (!key) continue;
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else counts.set(key, { label, count: 1 });
    }

    // Compare against the union of local state and the saved profile brands,
    // so an already-added brand never gets suggested again.
    const owned = new Set(
      [...brands, ...(profile?.owned_brands ?? [])].map(canonicalBrandKey).filter(Boolean),
    );
    const total = data.length;

    let best: Suggestion = null;
    for (const [key, { label, count }] of counts.entries()) {
      const pct = count / total;
      if (pct < 0.1) continue;
      if (owned.has(key)) continue;
      if (dismissed.has(key)) continue;
      if (!best || count > best.count) best = { brand: label, count, pct };
    }
    setSuggestion(best);
  };

  useEffect(() => {
    void checkWardrobeSuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.owned_brands, brands, dismissed]);

  useEffect(() => {
    const handler = () => { void checkWardrobeSuggestion(); };
    window.addEventListener("aura:wardrobe-item-created", handler);
    return () => window.removeEventListener("aura:wardrobe-item-created", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.owned_brands, brands, dismissed]);

  return (
    <section className="mx-6 mt-4 animate-fade-up">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">My brands</p>
        {saving && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
      </div>

      {suggestion && (
        <div className="mb-3 rounded-2xl border border-[var(--champagne)]/60 bg-[var(--champagne)]/10 p-3 flex items-start gap-3 animate-fade-up">
          <Sparkles size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1 text-xs leading-relaxed">
            You have {suggestion.count} {suggestion.brand} piece{suggestion.count === 1 ? "" : "s"} —
            add <span className="font-medium">{suggestion.brand}</span> to your brands?
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => { addBrand(suggestion.brand); setSuggestion(null); }}
              className="h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center active:scale-90"
              aria-label="Accept suggestion"
            ><Check size={12} /></button>
            <button
              onClick={() => {
                setDismissed(prev => {
                  const next = new Set(prev).add(canonicalBrandKey(suggestion.brand));
                  saveDismissed(next);
                  return next;
                });
                setSuggestion(null);
              }}
              className="h-7 w-7 rounded-full border border-border flex items-center justify-center active:scale-90"
              aria-label="Dismiss suggestion"
            ><X size={12} /></button>
          </div>
        </div>
      )}

      {/* Pills */}
      <div className="flex flex-wrap gap-1.5">
        {brands.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No brands yet — search below to add your favourites.</p>
        )}
        {brands.map(b => (
          <span key={b} className="group inline-flex items-center gap-1 rounded-full bg-secondary/60 border border-border/60 text-foreground pl-2.5 pr-1 py-1 text-[11px]">
            {b}
            <button
              onClick={() => removeBrand(b)}
              className="h-4 w-4 rounded-full bg-foreground/10 flex items-center justify-center active:scale-90"
              aria-label={`Remove ${b}`}
            ><X size={9} /></button>
          </span>
        ))}
      </div>

      {/* Search / autocomplete */}
      <div className="mt-3 relative">
        <div className="flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-2.5">
          <Search size={14} className="text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (suggestions[0]) addBrand(suggestions[0]);
                else if (canAddCustom) addBrand(query);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Search brands or add your own…"
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground outline-none"
          />
          {query && (
            <button onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label="Clear">
              <X size={14} className="text-muted-foreground" />
            </button>
          )}
        </div>

        {open && (suggestions.length > 0 || canAddCustom) && (
          <div className="absolute z-50 left-0 right-0 mt-2 rounded-2xl border border-border bg-card shadow-luxe overflow-hidden max-h-72 overflow-y-auto">
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => addBrand(s)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary/60 active:bg-secondary/80 transition flex items-center justify-between"
              >
                <span>{s}</span>
                <Plus size={12} className="text-muted-foreground" />
              </button>
            ))}
            {canAddCustom && (
              <button
                onClick={() => addBrand(query)}
                className="w-full text-left px-4 py-2.5 text-sm border-t border-border hover:bg-secondary/60 flex items-center gap-2"
              >
                <Plus size={12} />
                <span>Add "<span className="font-medium">{query.trim()}</span>"</span>
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
