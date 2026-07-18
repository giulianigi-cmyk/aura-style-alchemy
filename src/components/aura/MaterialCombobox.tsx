import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";

interface MaterialComboboxProps {
  options: string[];
  values: string[];
  onChange: (values: string[]) => void;
  label?: string;
}

export function MaterialCombobox({ options, values, onChange, label }: MaterialComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter(
    (o) => o.toLowerCase().includes(query.toLowerCase()) && !values.includes(o)
  );

  const toggle = (o: string) => {
    onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o]);
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 w-full flex items-center justify-between rounded-full bg-secondary/60 px-4 py-2.5 text-sm text-left active:scale-[0.99] transition"
      >
        <span className={values.length ? "text-foreground" : "text-muted-foreground"}>
          {values.length ? `${values.length} selected` : "Select materials"}
        </span>
        <ChevronsUpDown size={14} className="text-muted-foreground" />
      </button>

      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-foreground text-background px-3 py-1 text-xs"
            >
              {v}
              <button
                type="button"
                onClick={() => toggle(v)}
                className="hover:text-background/70"
                aria-label={`Remove ${v}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-2xl border border-border bg-card shadow-md p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search materials…"
            className="w-full bg-secondary/60 rounded-full px-3 py-2 text-sm outline-none placeholder:text-muted-foreground mb-2"
            onClick={(e) => e.stopPropagation()}
          />
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No materials found</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  toggle(o);
                  setQuery("");
                }}
                className="w-full text-left rounded-full px-3 py-2 text-sm hover:bg-secondary/60 transition"
              >
                {o}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
