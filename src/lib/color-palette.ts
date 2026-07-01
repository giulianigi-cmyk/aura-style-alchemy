export type PaletteColor = { name: string; hex: string; family: string };

export const COLOR_FAMILIES = [
  "Neutrals",
  "Whites",
  "Blacks & Greys",
  "Browns",
  "Beiges",
  "Reds",
  "Pinks",
  "Oranges",
  "Yellows",
  "Greens",
  "Blues",
  "Purples",
  "Metallics",
  "Multicolor",
] as const;

export const COLOR_PALETTE: PaletteColor[] = [
  // Whites
  { name: "Pure White", hex: "#FFFFFF", family: "Whites" },
  { name: "Off White", hex: "#F8F5EF", family: "Whites" },
  { name: "Ivory", hex: "#FFFFF0", family: "Whites" },
  { name: "Cream", hex: "#F5EFE0", family: "Whites" },
  { name: "Ecru", hex: "#EFE7D2", family: "Whites" },
  { name: "Pearl", hex: "#EAE0C8", family: "Whites" },

  // Blacks & Greys
  { name: "Jet Black", hex: "#0A0A0A", family: "Blacks & Greys" },
  { name: "Soft Black", hex: "#1C1C1C", family: "Blacks & Greys" },
  { name: "Charcoal", hex: "#36454F", family: "Blacks & Greys" },
  { name: "Graphite", hex: "#4B4B4B", family: "Blacks & Greys" },
  { name: "Slate Grey", hex: "#708090", family: "Blacks & Greys" },
  { name: "Cool Grey", hex: "#8C92AC", family: "Blacks & Greys" },
  { name: "Warm Grey", hex: "#8B8378", family: "Blacks & Greys" },
  { name: "Silver Grey", hex: "#BEBEBE", family: "Blacks & Greys" },
  { name: "Dove Grey", hex: "#D3D3D3", family: "Blacks & Greys" },

  // Beiges (neutrals warm)
  { name: "Beige", hex: "#E8DCC4", family: "Beiges" },
  { name: "Sand", hex: "#DCC9A6", family: "Beiges" },
  { name: "Champagne", hex: "#F1E1C6", family: "Beiges" },
  { name: "Taupe", hex: "#B8A492", family: "Beiges" },
  { name: "Stone", hex: "#C7B8A1", family: "Beiges" },
  { name: "Nude", hex: "#E3BC9A", family: "Beiges" },
  { name: "Buttermilk", hex: "#F4E7C5", family: "Beiges" },
  { name: "Oat", hex: "#D8C9A3", family: "Beiges" },

  // Browns
  { name: "Camel", hex: "#C19A6B", family: "Browns" },
  { name: "Tan", hex: "#D2B48C", family: "Browns" },
  { name: "Caramel", hex: "#AF6E4D", family: "Browns" },
  { name: "Cognac", hex: "#9A463D", family: "Browns" },
  { name: "Chocolate", hex: "#5A3A22", family: "Browns" },
  { name: "Espresso", hex: "#3B2A1A", family: "Browns" },
  { name: "Mocha", hex: "#6F4E37" , family: "Browns" },
  { name: "Chestnut", hex: "#954535", family: "Browns" },
  { name: "Rust", hex: "#B7410E", family: "Browns" },
  { name: "Sienna", hex: "#A0522D", family: "Browns" },
  { name: "Khaki", hex: "#8F8564", family: "Browns" },

  // Reds
  { name: "Cherry Red", hex: "#D2042D", family: "Reds" },
  { name: "Crimson", hex: "#B00020", family: "Reds" },
  { name: "Ruby", hex: "#9B111E", family: "Reds" },
  { name: "Burgundy", hex: "#6E1423", family: "Reds" },
  { name: "Wine", hex: "#722F37", family: "Reds" },
  { name: "Brick", hex: "#8B3A3A", family: "Reds" },
  { name: "Coral Red", hex: "#E44D2E", family: "Reds" },

  // Pinks
  { name: "Blush", hex: "#F2C6C2", family: "Pinks" },
  { name: "Powder Pink", hex: "#F4D9DC", family: "Pinks" },
  { name: "Rose", hex: "#D98695", family: "Pinks" },
  { name: "Dusty Pink", hex: "#C99A9A", family: "Pinks" },
  { name: "Hot Pink", hex: "#E64F8A", family: "Pinks" },
  { name: "Fuchsia", hex: "#C154C1", family: "Pinks" },
  { name: "Magenta", hex: "#B23A7F", family: "Pinks" },
  { name: "Salmon", hex: "#FA8072", family: "Pinks" },

  // Oranges
  { name: "Peach", hex: "#F6C6A3", family: "Oranges" },
  { name: "Apricot", hex: "#F1B87F", family: "Oranges" },
  { name: "Coral", hex: "#FF7F50", family: "Oranges" },
  { name: "Tangerine", hex: "#EE8A2B", family: "Oranges" },
  { name: "Orange", hex: "#E96B27", family: "Oranges" },
  { name: "Terracotta", hex: "#C97253", family: "Oranges" },
  { name: "Burnt Orange", hex: "#CC5500", family: "Oranges" },

  // Yellows
  { name: "Butter", hex: "#F7E9B4", family: "Yellows" },
  { name: "Lemon", hex: "#F6E27A", family: "Yellows" },
  { name: "Canary", hex: "#F6D51F", family: "Yellows" },
  { name: "Mustard", hex: "#C9A227", family: "Yellows" },
  { name: "Ochre", hex: "#CC7722", family: "Yellows" },
  { name: "Gold Yellow", hex: "#E5B300", family: "Yellows" },

  // Greens
  { name: "Mint", hex: "#B7E4C7", family: "Greens" },
  { name: "Sage", hex: "#9CAF88", family: "Greens" },
  { name: "Pistachio", hex: "#93C572", family: "Greens" },
  { name: "Olive", hex: "#6B7A3A", family: "Greens" },
  { name: "Army Green", hex: "#4B5320", family: "Greens" },
  { name: "Forest Green", hex: "#2E5D3A", family: "Greens" },
  { name: "Emerald", hex: "#046A38", family: "Greens" },
  { name: "Kelly Green", hex: "#4CBB17", family: "Greens" },
  { name: "Hunter Green", hex: "#355E3B", family: "Greens" },
  { name: "Teal", hex: "#008080", family: "Greens" },
  { name: "Turquoise", hex: "#40E0D0", family: "Greens" },
  { name: "Seafoam", hex: "#93E9BE", family: "Greens" },

  // Blues
  { name: "Powder Blue", hex: "#B0E0E6", family: "Blues" },
  { name: "Sky Blue", hex: "#87CEEB", family: "Blues" },
  { name: "Baby Blue", hex: "#BFDDF2", family: "Blues" },
  { name: "Denim", hex: "#4A6D8C", family: "Blues" },
  { name: "Cobalt", hex: "#0047AB", family: "Blues" },
  { name: "Royal Blue", hex: "#1F3A93", family: "Blues" },
  { name: "Navy", hex: "#0A1F44", family: "Blues" },
  { name: "Midnight Blue", hex: "#191970", family: "Blues" },
  { name: "Slate Blue", hex: "#6A5ACD", family: "Blues" },
  { name: "Steel Blue", hex: "#4682B4", family: "Blues" },
  { name: "Ice Blue", hex: "#DCEEFB", family: "Blues" },

  // Purples
  { name: "Lavender", hex: "#C5B4E3", family: "Purples" },
  { name: "Lilac", hex: "#C8A2C8", family: "Purples" },
  { name: "Mauve", hex: "#B784A7", family: "Purples" },
  { name: "Violet", hex: "#7F00FF", family: "Purples" },
  { name: "Plum", hex: "#8E4585", family: "Purples" },
  { name: "Aubergine", hex: "#3B0A45", family: "Purples" },
  { name: "Amethyst", hex: "#9966CC", family: "Purples" },

  // Metallics
  { name: "Gold", hex: "#D4AF37", family: "Metallics" },
  { name: "Rose Gold", hex: "#B76E79", family: "Metallics" },
  { name: "Silver", hex: "#C0C0C0", family: "Metallics" },
  { name: "Bronze", hex: "#CD7F32", family: "Metallics" },
  { name: "Copper", hex: "#B87333", family: "Metallics" },
  { name: "Pewter", hex: "#8E9BA1", family: "Metallics" },
  { name: "Gunmetal", hex: "#2A3439", family: "Metallics" },

  // Multicolor / print
  { name: "Animal Print", hex: "#B08750", family: "Multicolor" },
  { name: "Floral", hex: "#E4B7C4", family: "Multicolor" },
  { name: "Striped", hex: "#DDDDDD", family: "Multicolor" },
  { name: "Checkered", hex: "#C7B8A1", family: "Multicolor" },
  { name: "Denim Wash", hex: "#6E8CA0", family: "Multicolor" },
  { name: "Tie Dye", hex: "#EEC1E6", family: "Multicolor" },
];

export const COLOR_NAMES = COLOR_PALETTE.map(c => c.name);

export function findColorByName(name: string): PaletteColor | undefined {
  const n = name.trim().toLowerCase();
  return COLOR_PALETTE.find(c => c.name.toLowerCase() === n);
}

// Nearest palette match from an arbitrary hex (used by AI suggestions).
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function nearestPaletteColor(hex: string): PaletteColor {
  const [r, g, b] = hexToRgb(hex);
  let best = COLOR_PALETTE[0], bestD = Infinity;
  for (const c of COLOR_PALETTE) {
    const [cr, cg, cb] = hexToRgb(c.hex);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
