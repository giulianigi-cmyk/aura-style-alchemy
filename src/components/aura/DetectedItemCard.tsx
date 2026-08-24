import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { MaterialCombobox } from "@/components/aura/MaterialCombobox";
import {
  ITEM_CATEGORIES,
  MATERIAL_OPTIONS,
  SEASON_OPTIONS,
  STYLE_OPTIONS,
  OCCASION_OPTIONS,
  CURRENCY_OPTIONS,
  SLEEVE_LENGTH_OPTIONS,
  subcategoriesFor,
} from "@/lib/wardrobe-options";

const FORMALITY_KEYS = ["addItem.formality1", "addItem.formality2", "addItem.formality3", "addItem.formality4", "addItem.formality5"];
const DAY_EVENING_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "day", labelKey: "addItem.dayEveningDay" },
  { value: "evening", labelKey: "addItem.dayEveningEvening" },
  { value: "both", labelKey: "addItem.dayEveningBoth" },
];
/** Sleeve length is only meaningful for garments with sleeves/shoulders —
 *  showing it for Shoes or Bags would be noise, not a useful field. */
const SLEEVE_APPLIES_TO = new Set(["Tops", "Dresses", "Outerwear", "Jumpsuits"]);

export type DetectedItemDraft = {
  category: string;
  subcategory: string;
  colors: string[];
  materials: string[];
  seasons: string[];
  brand: string;
  description: string;
  price: string;
  currency: string;
  size: string;
  styles: string[];
  occasions: string[];
  purchaseDate: string;
  sleeveLength: string;
  formality: number | null;
  dayEvening: string;
};

export function DetectedItemCard({
  item,
  imageUrl,
  onChange,
  onRemove,
  footer,
}: {
  item: DetectedItemDraft;
  imageUrl: string | null;
  onChange: (patch: Partial<DetectedItemDraft>) => void;
  onRemove?: () => void;
  footer?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const subs = subcategoriesFor(item.category);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 relative">
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={t("detectedItem.removeItemAria")}
          className="absolute top-3 right-3 h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90"
        ><Trash2 size={14} /></button>
      )}

      <div className="h-24 w-24 rounded-xl overflow-hidden mx-auto" style={{ background: "#FFFFFF" }}>
        {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-contain p-1.5" />}
      </div>
      {item.description && (
        <p className="mt-2 text-center text-xs text-muted-foreground italic">{item.description}</p>
      )}

      <div className="mt-4">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.category")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ITEM_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ category: c, subcategory: "" })}
              className={`rounded-full px-3 py-1.5 text-xs ${item.category === c ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
            >{c}</button>
          ))}
        </div>
      </div>

      {subs.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.type")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {subs.map((s) => (
              <button
                key={s}
                onClick={() => onChange({ subcategory: item.subcategory === s ? "" : s })}
                className={`rounded-full px-3 py-1.5 text-xs ${item.subcategory === s ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{s}</button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <ColorPicker value={item.colors} onChange={(next) => onChange({ colors: next })} />
      </div>

      <div className="mt-3">
        <MaterialCombobox
          label={t("detectedItem.material")}
          options={MATERIAL_OPTIONS}
          values={item.materials}
          onChange={(v) => onChange({ materials: v })}
        />
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.season")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
                   {SEASON_OPTIONS.map((s) => {
            const on = item.seasons.includes(s);
            const nextSeasons = (() => {
              if (s === "All Seasons") return on ? [] : ["All Seasons"];
              const withoutAll = item.seasons.filter((x) => x !== "All Seasons");
              return withoutAll.includes(s) ? withoutAll.filter((x) => x !== s) : [...withoutAll, s];
            })();
            return (
              <button
                key={s}
                onClick={() => onChange({ seasons: nextSeasons })}
                className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{s}</button>
            );
          })}

        </div>
      </div>

      {SLEEVE_APPLIES_TO.has(item.category) && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.sleeve")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SLEEVE_LENGTH_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => onChange({ sleeveLength: item.sleeveLength === s ? "" : s })}
                className={`rounded-full px-3 py-1.5 text-xs ${item.sleeveLength === s ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{s}</button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.formality")}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{t("detectedItem.formalityHint")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {FORMALITY_KEYS.map((key, i) => {
            const level = i + 1;
            const on = item.formality === level;
            return (
              <button
                key={key}
                onClick={() => onChange({ formality: level })}
                className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{t(key)}</button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.dayEvening")}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{t("detectedItem.dayEveningHint")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DAY_EVENING_OPTIONS.map(({ value, labelKey }) => {
            const on = item.dayEvening === value;
            return (
              <button
                key={value}
                onClick={() => onChange({ dayEvening: value })}
                className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{t(labelKey)}</button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.brand")}</p>
        <input
          value={item.brand}
          onChange={(e) => onChange({ brand: e.target.value })}
          placeholder={t("detectedItem.brandPlaceholder")}
          className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.style")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STYLE_OPTIONS.map((s) => {
            const on = item.styles.includes(s);
            return (
              <button
                key={s}
                onClick={() => onChange({ styles: on ? item.styles.filter((x) => x !== s) : [...item.styles, s] })}
                className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{s}</button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.occasion")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {OCCASION_OPTIONS.map((o) => {
            const on = item.occasions.includes(o);
            return (
              <button
                key={o}
                onClick={() => onChange({ occasions: on ? item.occasions.filter((x) => x !== o) : [...item.occasions, o] })}
                className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{o}</button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.size")}</p>
          <input
            value={item.size}
            onChange={(e) => onChange({ size: e.target.value })}
            placeholder={t("detectedItem.sizePlaceholder")}
            className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.price")}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={item.price}
              onChange={(e) => onChange({ price: e.target.value })}
              placeholder="0.00"
              inputMode="decimal"
              className="w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <select
              value={item.currency}
              onChange={(e) => onChange({ currency: e.target.value })}
              className="bg-secondary/60 rounded-full px-2 py-2.5 text-xs outline-none shrink-0"
            >
              {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{t("detectedItem.purchaseDate")}</p>
        <input
          type="date"
          value={item.purchaseDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => onChange({ purchaseDate: e.target.value })}
          className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none"
        />
      </div>

      {footer}
    </div>
  );
}
