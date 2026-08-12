import { ArrowLeft, Sparkles, BarChart3, PiggyBank, TrendingDown, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { WardrobeItem } from "@/lib/aura-types";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { convertCurrency, RATES_AS_OF } from "@/lib/currency-rates";

import { Loader2 } from "lucide-react";

const currencySymbol: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
const fmt = (n: number, currency: string) => `${currencySymbol[currency] ?? currency}${Math.round(n).toLocaleString("it-IT")}`;



// Deliberately simple and stated plainly, not tuned to feel precise:
// linear decline from 100% at purchase to a 25% floor by year 5, flat
// after that. This is a general rule of thumb, not a market appraisal —
// it doesn't know brand, condition, or trends, and never claims to.
// Wear count is NOT a factor here on purpose: how often something has
// been worn barely moves resale value (condition and brand do); it's
// already the input for cost-per-wear above, which answers a different
// question ("was this worth it for me") from this one ("what's it
// roughly worth now").
const RETENTION_FLOOR = 0.25;
const RETENTION_CLIFF_YEARS = 5;
function retentionFactor(ageYears: number): number {
  const t = Math.min(Math.max(ageYears, 0), RETENTION_CLIFF_YEARS) / RETENTION_CLIFF_YEARS;
  return 1 - (1 - RETENTION_FLOOR) * t;
}

export function Insights({ go, openWardrobeGap }: { go: (s: Screen) => void; openWardrobeGap: (filter: "price" | "purchase_date") => void }) {
  const { user } = useAuth();
   const [items, setItems] = useState<WardrobeItem[]>([]);
  const [showValues, setShowValues] = useState(() => {
    try { return localStorage.getItem("aura-hide-values") !== "1"; } catch { return true; }
  });
  const toggleShowValues = () => {
    setShowValues((v) => {
      const next = !v;
      try { localStorage.setItem("aura-hide-values", next ? "0" : "1"); } catch { /* ignore */ }
      return next;
    });
  };
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    supabase.from("wardrobe_items").select("*").eq("user_id", user.id)
      .then(async ({ data, error }) => {
        if (error) { console.error("[AURA insights] load", error); setLoading(false); return; }
        const list = (data ?? []) as WardrobeItem[];
        setItems(list);
        setSigned(await resolveWardrobeUrls(list));
        setLoading(false);
      });
  }, [user]);

  const stats = useMemo(() => {
    const priced = items.filter((it) => it.price != null && it.price > 0);

    const currencyCounts = new Map<string,
    const neverWornCount = items.filter((it) => !(it.worn_count ?? 0)).length;
    const neverWornPct = items.length ? Math.round((neverWornCount / items.length) * 100) : 0;

    const cpwEligible = inPrimary
      .filter((it) => (it.worn_count ?? 0) > 0)
            .map((it) => ({ item: it, cpw: toPrimary(it) / (it.worn_count ?? 1) }));
    const avgCpw = cpwEligible.length ? cpwEligible.reduce((s, x) => s + x.cpw, 0) / cpwEligible.length : null;
    const bestValue = [...cpwEligible].sort((a, b) => a.cpw - b.cpw).slice(0, 5);

    const byCategory = new Map<string, { count: number; value: number }>();
    for (const it of items) {
      const cat = it.category || "Uncategorized";
      const cur = byCategory.get(cat) ?? { count: 0, value: 0 };
      cur.count += 1;
            if (priced.includes(it)) cur.value += toPrimary(it);
      byCategory.set(cat, cur);
    }
    const categoryRows = [...byCategory.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.value - a.value || b.count - a.count);
        const topCategory = categoryRows.find((c) => c.value > 0) ?? null;

    const now = Date.now();
    const withPurchaseDate = inPrimary.filter((it) => (it as unknown as { purchase_date?: string | null }).purchase_date);
    const estimatedValue = withPurchaseDate.reduce((sum, it) => {
      const pd = new Date(`${(it as unknown as { purchase_date: string }).purchase_date}T00:00:00`);
      const ageYears = (now - pd.getTime()) / (365.25 * 24 * 3600 * 1000);
            return sum + toPrimary(it) * retentionFactor(ageYears);
    }, 0);
    const estimatedValueCount = withPurchaseDate.length;
    const estimatedValueExcluded = inPrimary.length - withPurchaseDate.length;

    const missingPriceCount = items.filter((it) => it.price == null || it.price <= 0).length;
    const missingPurchaseDateCount = items.filter((it) => !(it as unknown as { purchase_date?: string | null }).purchase_date).length;

    return {
            totalValue, primaryCurrency, convertedCount, pricedCount: priced.length,

      neverWornCount, neverWornPct, avgCpw, bestValue, categoryRows, topCategory,
      estimatedValue, estimatedValueCount, estimatedValueExcluded,
      missingPriceCount, missingPurchaseDateCount,
    };
  }, [items]);


  const thumb = (it: WardrobeItem) => {
    const path = toStoragePath(it.image_url);
    return path ? signed[path] : null;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
        <header className="px-6 pt-14 pb-2 flex items-center justify-between">
          <button onClick={() => go("profile")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
            <ArrowLeft size={15} />
          </button>
          <p className="font-serif text-lg italic">Wardrobe insights</p>
          <span className="w-10" />
        </header>
        <section className="mx-6 mt-6 rounded-3xl gradient-warm border border-border/60 p-8 text-center shadow-soft animate-fade-up">
          <div className="mx-auto h-14 w-14 rounded-full bg-background flex items-center justify-center mb-4">
            <BarChart3 size={20} />
          </div>
          <h2 className="font-serif text-2xl italic">No insights yet</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Add a few pieces to your wardrobe and we'll surface value, cost-per-wear and wear rate here.
          </p>
          <button onClick={() => go("add")} className="mt-6 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center gap-2">
            <Sparkles size={12} /> Add a piece
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28 bg-background">
      <header className="px-6 pt-14 pb-2 flex items-center justify-between">
        <button onClick={() => go("profile")} className="h-10 w-10 rounded-full border border-border flex items-center justify-center active:scale-90">
          <ArrowLeft size={15} />
        </button>
        <p className="font-serif text-lg italic">Wardrobe insights</p>
        <span className="w-10" />
      </header>

            <section className="mx-6 mt-4 rounded-3xl gradient-warm border border-border/60 p-6 animate-fade-up">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Total wardrobe value</p>
          {stats.pricedCount > 0 && (
            <button
              onClick={toggleShowValues}
              aria-label={showValues ? "Hide values" : "Show values"}
              className="text-muted-foreground active:scale-90"
            >{showValues ? <Eye size={14} /> : <EyeOff size={14} />}</button>
          )}
        </div>
        {stats.pricedCount > 0 ? (
          <>
            <p className="font-serif text-4xl mt-1">{showValues ? fmt(stats.totalValue, stats.primaryCurrency) : "••••"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
                            Based on {stats.pricedCount} of {items.length} pieces with a price on file
              {stats.convertedCount > 0 ? ` · ${stats.convertedCount} converted from other currencies (approx., rates as of ${RATES_AS_OF})` : ""}

            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No prices on file yet — add a price to your pieces to see this.
          </p>
        )}
      </section>

      {(stats.missingPriceCount > 0 || stats.missingPurchaseDateCount > 0) && (
        <section className="mx-6 mt-3 flex gap-2">
          {stats.missingPriceCount > 0 && (
            <button
              onClick={() => openWardrobeGap("price")}
              className="flex-1 rounded-2xl border border-dashed border-border bg-card px-4 py-3 text-left active:scale-[0.98] transition"
            >
              <p className="font-serif text-lg">{stats.missingPriceCount}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Without a price →</p>
            </button>
          )}
          {stats.missingPurchaseDateCount > 0 && (
            <button
              onClick={() => openWardrobeGap("purchase_date")}
              className="flex-1 rounded-2xl border border-dashed border-border bg-card px-4 py-3 text-left active:scale-[0.98] transition"
            >
              <p className="font-serif text-lg">{stats.missingPurchaseDateCount}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Without a purchase date →</p>
            </button>
          )}
        </section>
      )}


      <section className="mx-6 mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card border border-border/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Avg cost per wear</p>
          <p className="font-serif text-2xl mt-1">
            {stats.avgCpw != null ? fmt(stats.avgCpw, stats.primaryCurrency) : "—"}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {stats.avgCpw != null ? "Priced pieces you've actually worn" : "No priced, worn pieces yet"}
          </p>
        </div>
        <div className="rounded-2xl bg-card border border-border/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Never worn</p>
          <p className="font-serif text-2xl mt-1">{stats.neverWornPct}%</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{stats.neverWornCount} of {items.length} pieces</p>
        </div>
      </section>

      <section className="mx-6 mt-6 animate-fade-up">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">By category</p>
        <div className="rounded-2xl bg-card border border-border/60 divide-y divide-border/60 overflow-hidden">
          {stats.categoryRows.map((c) => {
            const pct = items.length ? Math.round((c.count / items.length) * 100) : 0;
            return (
              <div key={c.category} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">{c.category}</p>
                  <p className="text-[10px] text-muted-foreground">{c.count} piece{c.count === 1 ? "" : "s"} · {pct}%</p>
                </div>
                <p className="text-sm font-serif shrink-0">
                  {c.value > 0 ? fmt(c.value, stats.primaryCurrency) : "—"}
                </p>
              </div>
            );
          })}
        </div>
        {stats.topCategory && (
          <p className="mt-2 text-[11px] text-muted-foreground px-1">
            <span className="font-medium text-foreground">{stats.topCategory.category}</span> is your highest-value category.
          </p>
        )}
      </section>

      {stats.bestValue.length > 0 && (
        <section className="mx-6 mt-6 animate-fade-up">
          <div className="flex items-center gap-1.5 mb-2">
            <PiggyBank size={12} className="text-muted-foreground" />
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Best value pieces</p>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar">
            {stats.bestValue.map(({ item, cpw }) => (
              <div key={item.id} className="shrink-0 w-28">
                <div className="aspect-square rounded-xl overflow-hidden" style={{ background: "#FFFFFF" }}>
                  {thumb(item) ? <img src={thumb(item)!} alt="" className="h-full w-full object-contain p-1.5" loading="lazy" /> : null}
                </div>
                <p className="mt-1.5 text-[10px] uppercase tracking-widest text-muted-foreground truncate">{item.brand ?? item.category}</p>
                <p className="text-xs font-serif">{fmt(cpw, stats.primaryCurrency)}/wear</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {stats.neverWornCount > 0 && (
        <section className="mx-6 mt-6 animate-fade-up">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingDown size={12} className="text-muted-foreground" />
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Never worn ({stats.neverWornCount})</p>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar">
            {items.filter((it) => !(it.worn_count ?? 0)).slice(0, 10).map((item) => (
              <div key={item.id} className="shrink-0 w-20">
                <div className="aspect-square rounded-xl overflow-hidden" style={{ background: "#FFFFFF" }}>
                  {thumb(item) ? <img src={thumb(item)!} alt="" className="h-full w-full object-contain p-1" loading="lazy" /> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

           <section className="mx-6 mt-6 mb-2 rounded-2xl border border-dashed border-border/60 p-4 animate-fade-up">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Estimated current value</p>
                {stats.estimatedValueCount > 0 ? (
          <>
            <p className="font-serif text-2xl mt-1">{showValues ? fmt(stats.estimatedValue, stats.primaryCurrency) : "••••"}</p>

            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              Estimated — based on {stats.estimatedValueCount} piece{stats.estimatedValueCount === 1 ? "" : "s"} with a purchase date, assuming value tapers gradually to about {Math.round(RETENTION_FLOOR * 100)}% of the original price by year {RETENTION_CLIFF_YEARS}. Not a market appraisal — it doesn't know brand, condition or trends.
              {stats.estimatedValueExcluded > 0 ? ` ${stats.estimatedValueExcluded} more priced piece${stats.estimatedValueExcluded === 1 ? "" : "s"} ${stats.estimatedValueExcluded === 1 ? "doesn't" : "don't"} have a purchase date, so ${stats.estimatedValueExcluded === 1 ? "isn't" : "aren't"} included.` : ""}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Add a purchase date to your pieces to see this.
          </p>
        )}
      </section>
    </div>
  );
}
