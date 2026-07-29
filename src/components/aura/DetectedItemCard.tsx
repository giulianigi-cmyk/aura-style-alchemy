import { Trash2 } from "lucide-react";
import { ColorPicker } from "@/components/aura/ColorPicker";
import { MaterialCombobox } from "@/components/aura/MaterialCombobox";
import { ITEM_CATEGORIES, MATERIAL_OPTIONS, SEASON_OPTIONS, subcategoriesFor } from "@/lib/wardrobe-options";

export type DetectedItemDraft = {
  category: string;
  subcategory: string;
  colors: string[];
  materials: string[];
  seasons: string[];
  brand: string;
  description: string;
};

/** Shared review/edit card for AI-detected garments.
 *  Used by both the single-photo OutfitScan flow and the batch review. */
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
  const subs = subcategoriesFor(item.category);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 relative">
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Remove item"
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
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Category</p>
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
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Type</p>
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
          label="Material"
          options={MATERIAL_OPTIONS}
          values={item.materials}
          onChange={(v) => onChange({ materials: v })}
        />
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Season</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SEASON_OPTIONS.map((s) => {
            const on = item.seasons.includes(s);
            return (
              <button
                key={s}
                onClick={() => onChange({ seasons: on ? item.seasons.filter((x) => x !== s) : [...item.seasons, s] })}
                className={`rounded-full px-3 py-1.5 text-xs ${on ? "bg-foreground text-background" : "bg-secondary/60 text-foreground/70"}`}
              >{s}</button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Brand</p>
        <input
          value={item.brand}
          onChange={(e) => onChange({ brand: e.target.value })}
          placeholder="leave empty if unknown"
          className="mt-2 w-full bg-secondary/60 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {footer}
    </div>
  );
}
