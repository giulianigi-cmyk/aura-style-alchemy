// Conversione taglie IT ↔ EU ↔ UK ↔ US ↔ internazionale.
// Tabelle statiche, nessuna API. Le equivalenze tra sistemi sono
// indicative: i brand variano, quindi mostriamo sempre "≈".

export type Gender = "donna" | "uomo";
export type SizeRow = { it: string; eu: string; uk: string; us: string; intl: string };

export const WOMEN_CLOTHING: SizeRow[] = [
  { it: "36", eu: "32", uk: "4",  us: "0",  intl: "XXS" },
  { it: "38", eu: "34", uk: "6",  us: "2",  intl: "XS"  },
  { it: "40", eu: "36", uk: "8",  us: "4",  intl: "S"   },
  { it: "42", eu: "38", uk: "10", us: "6",  intl: "M"   },
  { it: "44", eu: "40", uk: "12", us: "8",  intl: "L"   },
  { it: "46", eu: "42", uk: "14", us: "10", intl: "XL"  },
  { it: "48", eu: "44", uk: "16", us: "12", intl: "XXL" },
  { it: "50", eu: "46", uk: "18", us: "14", intl: "3XL" },
];

export const MEN_CLOTHING: SizeRow[] = [
  { it: "44", eu: "44", uk: "34", us: "34", intl: "XS"  },
  { it: "46", eu: "46", uk: "36", us: "36", intl: "S"   },
  { it: "48", eu: "48", uk: "38", us: "38", intl: "M"   },
  { it: "50", eu: "50", uk: "40", us: "40", intl: "L"   },
  { it: "52", eu: "52", uk: "42", us: "42", intl: "XL"  },
  { it: "54", eu: "54", uk: "44", us: "44", intl: "XXL" },
  { it: "56", eu: "56", uk: "46", us: "46", intl: "3XL" },
];

export const WOMEN_SHOES: SizeRow[] = [
  { it: "35", eu: "35", uk: "2",   us: "5",   intl: "35" },
  { it: "36", eu: "36", uk: "3",   us: "6",   intl: "36" },
  { it: "37", eu: "37", uk: "4",   us: "6.5", intl: "37" },
  { it: "38", eu: "38", uk: "5",   us: "7.5", intl: "38" },
  { it: "39", eu: "39", uk: "6",   us: "8.5", intl: "39" },
  { it: "40", eu: "40", uk: "6.5", us: "9",   intl: "40" },
  { it: "41", eu: "41", uk: "7.5", us: "9.5", intl: "41" },
  { it: "42", eu: "42", uk: "8",   us: "10.5",intl: "42" },
];

export const MEN_SHOES: SizeRow[] = [
  { it: "39", eu: "39", uk: "5.5",  us: "6.5",  intl: "39" },
  { it: "40", eu: "40", uk: "6.5",  us: "7",    intl: "40" },
  { it: "41", eu: "41", uk: "7.5",  us: "8",    intl: "41" },
  { it: "42", eu: "42", uk: "8",    us: "8.5",  intl: "42" },
  { it: "43", eu: "43", uk: "9",    us: "9.5",  intl: "43" },
  { it: "44", eu: "44", uk: "9.5",  us: "10",   intl: "44" },
  { it: "45", eu: "45", uk: "10.5", us: "11",   intl: "45" },
  { it: "46", eu: "46", uk: "11",   us: "11.5", intl: "46" },
];

const ALPHA = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"];

// Import guard: these two helpers are consumed from several screens
// (AddItem, Wardrobe, Profile, BatchReview). They must never throw on
// undefined/null/non-string input, otherwise a single bad field crashes
// the whole route through the error boundary.
export function normalizeSize(input?: string | null): string {
  if (typeof input !== "string") return "";
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function isShoeCategory(category?: string | null): boolean {
  if (typeof category !== "string") return false;
  return category.toLowerCase().includes("shoe");
}

/**
 * Trova la riga di conversione per la taglia inserita (numerica IT o alfabetica),
 * in base a categoria (abbigliamento vs scarpe) e genere (default donna).
 */
export function findSizeRow(
  input?: string | null,
  opts?: { shoes?: boolean; gender?: Gender },
): SizeRow | null {
  const v = normalizeSize(input);
  if (!v) return null;
  const gender = opts?.gender ?? "donna";
  const table = opts?.shoes
    ? (gender === "uomo" ? MEN_SHOES : WOMEN_SHOES)
    : (gender === "uomo" ? MEN_CLOTHING : WOMEN_CLOTHING);
  if (ALPHA.includes(v)) {
    return table.find((r) => r.intl === v) ?? null;
  }
  return table.find((r) => r.it === v) ?? null;
}

/** Stringa compatta di equivalenze da mostrare in scheda, es. "IT 42 ≈ EU 38 · UK 10 · US 6 · M" */
export function sizeEquivalences(
  input?: string | null,
  opts?: { shoes?: boolean; gender?: Gender },
): string | null {
  const row = findSizeRow(input, opts);
  if (!row) return null;
  if (opts?.shoes) {
    return `EU ${row.eu} · US ${row.us}`;
  }
  return `EU ${row.eu} · US ${row.us} · ${row.intl}`;
}

