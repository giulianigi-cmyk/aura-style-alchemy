import { ArrowLeft, Sparkles, BarChart3, PiggyBank, TrendingDown, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Screen } from "../AuraApp";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { WardrobeItem } from "@/lib/aura-types";
import { resolveWardrobeUrls, toStoragePath } from "@/lib/wardrobe-image";
import { convertCurrency, RATES_AS_OF } from "@/lib/currency-rates";
import { Loader2 } from "lucide-react";
import i18n from "@/i18n/config";
import {
  aggregateWardrobeValuation,
  fetchValuationConfig,
  EMPTY_VALUATION_CONFIG,
  type ValuationConfig,
  type Iconicity,
} from "@/lib/wardrobe-value-engine";

const currencySymbol: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
const fmt = (n: number, currency: string) => `${currencySymbol[currency] ?? currency}${Math.round(n).toLocaleString(i18n.language)}`;
const fmtRange = (low: number, high: number, currency: string) => `${fmt(low, currency)}–${fmt(high, currency)}`;

export function Insights({ go, openWardrobeGap }: { go: (s: Screen) => void; openWardrobeGap: (filter: "price" | "purchase_date") => void }) {
  const { t } = useTranslation();
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
  const [valuationConfig, setValuationConfig] = useState<ValuationConfig>(EMPTY_VALUATION_CONFIG);

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
    fetchValuationConfig().then(setValuationConfig).catch((e) => console.error("[AURA insights] valuation config", e));
  }, [user]);

  const stats = useMemo(() => {
    const priced = items.filter((it) => it.price != null && it.price > 0);

    const currencyCounts = new Map<string, number>();
    for (const it of priced) currencyCounts.set(it.currency || "EUR", (currencyCounts.get(it.currency || "EUR") ?? 0) + 1);
    const primaryCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
    const toPrimary = (it: WardrobeItem) => convertCurrency(it.price ?? 0, it.currency || "EUR", primaryCurrency);
    const inPrimary = priced;
    const convertedCount = priced.filter((it) => (it.currency || "EUR") !== primaryCurrency).length;

    const totalValue = priced.reduce((s, it) => s + toPrimary(it), 0);

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

    // Value engine works in the primary currency: every item's price and
    // current_retail_price get converted before being handed to it, so the
    // resulting ranges/sums are directly comparable and summable.
    const valuationItems = items.map((it) => {
      const raw = it as unknown as {
        current_retail_price?: number | null;
        current_retail_source?: string | null;
        purchase_date?: string | null;
        iconicity?: Iconicity | null;
        subcategory?: string | null;
        model?: string | null;
        bag_size_class?: string | null;
      };
      return {
        id: it.id,
        price: it.price != null ? convertCurrency(it.price, it.currency || "EUR", primaryCurrency) : null,
        currentRetailPrice: raw.current_retail_price != null ? convertCurrency(raw.current_retail_price, it.currency || "EUR", primaryCurrency) : null,
        currentRetailSource: (raw.current_retail_source as "user" | "ai_lookup_verified" | "ai_lookup_unverified" | "product_link" | null) ?? null,
        purchaseDate: raw.purchase_date ?? null,
        wornCount: it.worn_count ?? 0,
        brand: it.brand ?? null,
        category: it.category ?? null,
        subcategory: raw.subcategory ?? null,
        materials: Array.isArray(it.material) ? it.material : [],
        model: raw.model ?? null,
        bagSizeClass: raw.bag_size_class ?? null,
        iconicity: raw.iconicity ?? null,
      };
    });
    const valuation = aggregateWardrobeValuation(valuationItems, valuationConfig);
    const estimatedValueLow = valuation.totalResaleLow;
    const estimatedValueHigh = valuation.totalResaleHigh;
    const estimatedValueCount = valuation.resaleCount;
    const estimatedValueExcluded = items.length - valuation.resaleCount;
    const totalCurrentRetail = valuation.totalCurrentRetail;
    const currentRetailCount = valuation.currentRetailCount;

    const missingPriceCount = items.filter((it) => it.price == null || it.price <= 0).length;
    const missingPurchaseDateCount = items.filter((it) => !(it as unknown as { purchase_date?: string | null }).purchase_date).length;

    return {
      totalValue, primaryCurrency, convertedCount, pricedCount: priced.length,
      neverWornCount, neverWornPct, avgCpw, bestValue, categoryRows, topCategory,
      estimatedValueLow, estimatedValueHigh, estimatedValueCount, estimatedValueExcluded,
      totalCurrentRetail, currentRetailCount,
      missingPriceCount, missingPurchaseDateCount,
    };
  }, [items, valuationConfig]);

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
          <p className="font-serif text-lg italic">{t("insights.wardrobeInsights")}</p>
          <span className="w-10" />
        </header>
        <section className="mx-6 mt-6 rounded-3xl gradient-warm border border-border/60 p-8 text-center shadow-soft animate-fade-up">
          <div className="mx-auto h-14 w-14 rounded-full bg-background flex items-center justify-center mb-4">
            <BarChart3 size={20} />
          </div>
          <h2 className="font-serif text-2xl italic">{t("insights.noInsightsYet")}</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {t("insights.addPiecesHint")}
          </p>
          <button onClick={() => go("add")} className="mt-6 h-11 px-6 rounded-full bg-foreground text-background text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] inline-flex items-center gap-2">
            <Sparkles size={12} /> {t("insights.addAPiece")}
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
        <p className="font-serif text-lg italic">{t("insights.wardrobeInsights")}</p>
        <span className="w-10" />
      </header>

      <section className="mx-6 mt-4 rounded-3xl gradient-warm border border-border/60 p-6 animate-fade-up">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("insights.totalWardrobeValue")}</p>
          {stats.pricedCount > 0 && (
            <button
              onClick={toggleShowValues}
              aria-label={showValues ? t("insights.hideValuesAria") : t("insights.showValuesAria")}
              className="text-muted-foreground active:scale-90"
            >{showValues ? <Eye size={14} /> : <EyeOff size={14} />}</button>
          )}
        </div>
        {stats.pricedCount > 0 ? (
          <>
            <p className="font-serif text-4xl mt-1">{showValues ? fmt(stats.totalValue, stats.primaryCurrency) : "••••"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("insights.basedOnPieces", { priced: stats.pricedCount, total: items.length })}
              {stats.convertedCount > 0 ? ` · ${t("insights.convertedFromOther", { count: stats.convertedCount, date: RATES_AS_OF })}` : ""}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("insights.noPricesYet")}
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
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("insights.withoutPrice")}</p>
            </button>
          )}
          {stats.missingPurchaseDateCount > 0 && (
            <button
              onClick={() => openWardrobeGap("purchase_date")}
              className="flex-1 rounded-2xl border border-dashed border-border bg-card px-4 py-3 text-left active:scale-[0.98] transition"
            >
              <p className="font-serif text-lg">{stats.missingPurchaseDateCount}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("insights.withoutPurchaseDate")}</p>
            </button>
          )}
        </section>
      )}

      <section className="mx-6 mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card border border-border/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("insights.avgCostPerWear")}</p>
          <p className="font-serif text-2xl mt-1">
            {stats.avgCpw != null ? fmt(stats.avgCpw, stats.primaryCurrency) : "—"}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {stats.avgCpw != null ? t("insights.pricedPiecesWorn") : t("insights.noPricedWornPieces")}
          </p>
        </div>
        <div className="rounded-2xl bg-card border border-border/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("insights.neverWorn")}</p>
          <p className="font-serif text-2xl mt-1">{stats.neverWornPct}%</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("insights.piecesOfTotal", { count: stats.neverWornCount, total: items.length })}</p>
        </div>
      </section>

      <section className="mx-6 mt-6 animate-fade-up">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">{t("insights.byCategory")}</p>
        <div className="rounded-2xl bg-card border border-border/60 divide-y divide-border/60 overflow-hidden">
          {stats.categoryRows.map((c) => {
            const pct = items.length ? Math.round((c.count / items.length) * 100) : 0;
            return (
              <div key={c.category} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">{c.category}</p>
                  <p className="text-[10px] text-muted-foreground">{t("insights.piecesCount", { count: c.count })} · {pct}%</p>
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
            {t("insights.highestValueCategory", { category: stats.topCategory.category })}
          </p>
        )}
      </section>

      {stats.bestValue.length > 0 && (
        <section className="mx-6 mt-6 animate-fade-up">
          <div className="flex items-center gap-1.5 mb-2">
            <PiggyBank size={12} className="text-muted-foreground" />
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("insights.bestValuePieces")}</p>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar">
            {stats.bestValue.map(({ item, cpw }) => (
              <div key={item.id} className="shrink-0 w-28">
                <div className="aspect-square rounded-xl overflow-hidden" style={{ background: "#FFFFFF" }}>
                  {thumb(item) ? <img src={thumb(item)!} alt="" className="h-full w-full object-contain p-1.5" loading="lazy" /> : null}
                </div>
                <p className="mt-1.5 text-[10px] uppercase tracking-widest text-muted-foreground truncate">{item.brand ?? item.category}</p>
                <p className="text-xs font-serif">{t("insights.perWear", { amount: fmt(cpw, stats.primaryCurrency) })}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {stats.neverWornCount > 0 && (
        <section className="mx-6 mt-6 animate-fade-up">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingDown size={12} className="text-muted-foreground" />
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("insights.neverWornCount", { count: stats.neverWornCount })}</p>
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

      {stats.currentRetailCount > 0 && (
        <section className="mx-6 mt-6 rounded-2xl border border-dashed border-border/60 p-4 animate-fade-up">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("insights.currentRetailValue")}</p>
          <p className="font-serif text-2xl mt-1">{showValues ? fmt(stats.totalCurrentRetail, stats.primaryCurrency) : "••••"}</p>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            {t("insights.currentRetailBasedOn", { count: stats.currentRetailCount })}
          </p>
        </section>
      )}

      <section className="mx-6 mt-6 mb-2 rounded-2xl border border-dashed border-border/60 p-4 animate-fade-up">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("insights.estimatedCurrentValue")}</p>
        {stats.estimatedValueCount > 0 ? (
          <>
            <p className="font-serif text-2xl mt-1">
              {showValues ? fmtRange(stats.estimatedValueLow, stats.estimatedValueHigh, stats.primaryCurrency) : "••••"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              {t("insights.estimatedBasedOnRange", { count: stats.estimatedValueCount })}
              {stats.estimatedValueExcluded > 0 ? ` ${t("insights.moreNotIncluded", { count: stats.estimatedValueExcluded })}` : ""}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("insights.addPurchaseDateHint")}
          </p>
        )}
      </section>
    </div>
  );
}
