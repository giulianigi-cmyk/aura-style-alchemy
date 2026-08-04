import { useMemo, useState } from "react";
import { X, ChevronDown, ChevronUp, ChevronRight, Search } from "lucide-react";
import { COLOR_FAMILIES, COLOR_PALETTE, findColorByName, type PaletteColor } from "@/lib/color-palette";

export function ColorPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openFamily, setOpenFamily] = useState<string | null>("Neutrals");
  const [q, setQ] = useState("");

  const byFamily = useMemo(() => {
    const map: Record<string, PaletteColor[]> = {};
    for (const c of COLOR_PALETTE) {
      if (q && !c.name.toLowerCase().includes(q.toLowerCase())) continue;
      (map[c.family] ??= []).push(c);
    }
    return map;
  }, [q]);

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter(v => v !== name) : [...value, name]);
  };

  const selected = value.map(findColorByName).filter(Boolean) as PaletteColor[];

  return (
    <div className="border-b border-border/60 pb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between"
      >
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          Colors{selected.length > 0 ? ` · ${selected.length}` : ""}
        </p>
        <ChevronRight
          size={14}
          className={`text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map(c => (
            <span key={c.name} className="inline-flex items-center gap-2 rounded-full bg-foreground text-background pl-1.5 pr-2 py-1 text-xs">
              <span className="h-4 w-4 rounded-full border border-white/30" style={{ background: c.hex }} />
              {c.name}
              <button onClick={() => toggle(c.name)} aria-label={`Remove ${c.name}`} className="opacity-70 hover:opacity-100">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 text-xs text-muted-foreground underline"
          >Add colors</button>
        )
      )}

      {expanded && (
        <>
          <div className="mt-3 flex items-center gap-2 rounded-full bg-secondary/60 px-3 py-1.5">
            <Search size={13} className="text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a color"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="mt-3 space-y-2">
            {COLOR_FAMILIES.map(fam => {
              const list = byFamily[fam];
              if (!list?.length) return null;
              const open = q ? true : openFamily === fam;
              return (
                <div key={fam} className="rounded-xl bg-secondary/30 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFamily(open ? null : fam)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <span className="text-[11px] uppercase tracking-[0.25em]">{fam}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="text-[10px]">{list.length}</span>
                      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 flex flex-wrap gap-2">
                      {list.map(c => {
                        const on = value.includes(c.name);
                        return (
                          <button
                            key={c.name}
                            type="button"
                            onClick={() => toggle(c.name)}
                            className={`inline-flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 text-xs transition ${
                              on ? "bg-foreground text-background" : "bg-background border border-border"
                            }`}
                          >
                            <span
                              className="h-4 w-4 rounded-full border border-black/10"
                              style={{ background: c.hex }}
                            />
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
