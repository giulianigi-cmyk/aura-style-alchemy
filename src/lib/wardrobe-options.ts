// Tassonomia AURA — v2.
// Category = macro-categoria. Type = solo il tipo di capo, nessuna
// caratteristica (lunghezza, tacco, fit) codificata al suo interno:
// quelle sono attributi separati, applicabili in modo trasversale.
// Backward-compat: mapLegacySubcategory() traduce i vecchi valori
// "Mini Dress"/"High Heel Pumps" ecc. verso {type, length, heelHeight}.

export const ITEM_CATEGORIES = [
  "Tops", "Bottoms", "Dresses", "Jumpsuits", "Outerwear",
  "Shoes", "Bags", "Accessories", "Underwear", "Swimwear", "Activewear",
];

export const SEASON_OPTIONS = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"];
// STYLE_OPTIONS invariato: alimenta ancora il campo `style` esistente,
// usato da Wardrobe/AI/weather — nessuna modifica alla logica esistente.
export const STYLE_OPTIONS = ["Minimal", "Editorial", "Quiet luxury", "Street", "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage"];
export const OCCASION_OPTIONS = [
  "Everyday", "Work", "Business Casual", "Business Formal", "Smart Casual",
  "Evening", "Cocktail", "Black Tie", "Wedding Guest", "Garden Party",
  "Weekend", "Travel", "Resort", "Formal", "Sport",
];
export const MATERIAL_OPTIONS = [
  "Cotton", "Linen", "Silk", "Wool", "Merino", "Cashmere", "Mohair", "Alpaca",
  "Viscose", "Modal", "Lyocell", "Cupro",
  "Polyester", "Polyamide", "Elastane", "Acrylic",
  "Denim", "Leather", "Suede", "Shearling", "Down",
  "Metal", "Gold", "Silver", "Steel", "Brass", "Pearl", "Rubber", "Canvas",
  "Synthetic", "Knit",
];
export const CURRENCY_OPTIONS = ["EUR", "USD", "GBP"];

// Type per categoria — solo il tipo di capo, mai lunghezza/tacco/fit.
export const SUBCATEGORY_OPTIONS: Record<string, string[]> = {
  Tops: ["T-Shirt", "Shirt", "Blouse", "Tank Top", "Camisole", "Crop Top", "Bodysuit", "Polo", "Sweater", "Cardigan", "Hoodie", "Sweatshirt", "Vest Top", "Knit Top", "Tunic"],
  Bottoms: ["Jeans", "Trousers", "Cargo Pants", "Joggers", "Leggings", "Shorts", "Bermuda Shorts", "Skirt"],
  Dresses: ["Slip Dress", "Shirt Dress", "Wrap Dress", "Bodycon Dress", "A-line Dress", "Shift Dress", "Sweater Dress", "Evening Dress"],
  Jumpsuits: ["Jumpsuit", "Playsuit", "Romper"],
  Outerwear: ["Blazer", "Coat", "Trench Coat", "Puffer Jacket", "Parka", "Rain Jacket", "Windbreaker", "Denim Jacket", "Leather Jacket", "Bomber Jacket", "Shacket", "Cape", "Vest"],
  Shoes: ["Sneakers", "Running Shoes", "Sandals", "Flats", "Loafers", "Pumps", "Boots", "Chelsea Boots", "Combat Boots", "Ankle Boots", "Knee Boots", "Over-the-Knee Boots", "Espadrilles", "Slides", "Mules", "Wedges", "Clogs", "Slippers", "Flip Flops"],
  Bags: ["Tote", "Crossbody", "Shoulder Bag", "Clutch", "Backpack", "Bucket Bag", "Belt Bag", "Satchel", "Hobo Bag", "Top Handle Bag"],
  Accessories: ["Belt", "Scarf", "Hat", "Cap", "Gloves", "Watch", "Sunglasses", "Hair Accessory", "Tie", "Jewelry"],
  Underwear: ["Bra", "Sports Bra", "Briefs", "Panties", "Boxers", "Shapewear", "Sleepwear", "Socks", "Tights"],
  Swimwear: ["One-piece Swimsuit", "Bikini Top", "Bikini Bottom", "Cover-up", "Swim Shorts"],
  Activewear: ["Training Top", "Sports Bra", "Performance Jacket", "Running Shorts", "Bike Shorts", "Training Leggings", "Tennis Skirt", "Tracksuit"],
};

// Attributi separati — trasversali, non annidati nel Type.
// Length NON è più un'unica lista piatta: i valori sensati cambiano per
// categoria (un vestito non ha "Longline", un cappotto non ha "Mini").
// Regola: default per categoria, con eccezioni per Type specifico quando
// la categoria è eterogenea (Bottoms contiene sia gonne sia pantaloni —
// solo le gonne hanno senso con Mini/Midi/Maxi).
export const LENGTH_OPTIONS_BY_CATEGORY: Record<string, string[]> = {
  Dresses: ["Mini", "Midi", "Maxi"],
  Outerwear: ["Short", "Mid", "Long"],
  Tops: ["Cropped", "Regular", "Longline"],
};
const LENGTH_OPTIONS_BY_TYPE: Record<string, string[]> = {
  Skirt: ["Mini", "Midi", "Maxi"],
};
// Lista piatta per retrocompatibilità (usata solo da mapLegacySubcategory).
export const LENGTH_OPTIONS = ["Mini", "Midi", "Maxi", "Cropped", "Regular", "Short", "Mid", "Long", "Longline"];
export const SLEEVE_LENGTH_OPTIONS = ["Sleeveless", "Short Sleeve", "Three-Quarter Sleeve", "Long Sleeve"];
export const FIT_OPTIONS = ["Slim", "Regular", "Relaxed", "Oversized", "Tailored"];
export const HEEL_HEIGHT_OPTIONS = ["Flat", "Low", "Mid", "High"];
export const TOE_SHAPE_OPTIONS = ["Round", "Square", "Pointed", "Open Toe"];
export const CLOSURE_OPTIONS = ["Buttons", "Zip", "Lace", "Slip-On", "Buckle"];
export const GENDER_OPTIONS = ["Woman", "Man", "Unisex"];
// Etichette libere di stile — array nativo, separato dal campo `style`
// esistente (che resta invariato per non rompere nulla). Vocabolario
// più ampio, pensato per la futura memoria di stile e i suggerimenti
// di acquisto.
export const STYLE_TAG_OPTIONS = [
  "Minimal", "Boho", "Preppy", "Elegant", "Streetwear", "Office",
  "Y2K", "Editorial", "Quiet Luxury", "Romantic", "Tailored",
  "Sporty", "Vintage", "Grunge", "Coastal", "Old Money",
];

// Categorie dove ogni attributo ha senso chiedere/mostrare — evita di
// proporre "Heel Height" per una t-shirt o "Sleeve Length" per una borsa.
// NOTA: 'length' non è qui — dipende anche dal Type (es. Skirt dentro
// Bottoms), gestito da lengthAppliesTo()/lengthOptionsFor() sotto.
export const ATTRIBUTE_APPLICABILITY: Record<string, string[]> = {
  sleeveLength: ["Tops", "Dresses", "Outerwear", "Jumpsuits"],
  fit: ["Tops", "Bottoms", "Dresses", "Outerwear", "Jumpsuits", "Activewear"],
  heelHeight: ["Shoes"],
  toeShape: ["Shoes"],
  closure: ["Shoes", "Outerwear", "Bags"],
};

export function subcategoriesFor(category: string | null | undefined): string[] {
  return category ? (SUBCATEGORY_OPTIONS[category] ?? []) : [];
}

export function attributeAppliesTo(attribute: keyof typeof ATTRIBUTE_APPLICABILITY, category: string | null | undefined): boolean {
  if (!category) return false;
  return ATTRIBUTE_APPLICABILITY[attribute]?.includes(category) ?? false;
}

/**
 * Length: un solo attributo nel database, ma i valori proposti dipendono
 * dalla categoria (e, quando serve, dal Type — es. "Skirt" dentro
 * Bottoms ha Mini/Midi/Maxi, mentre Jeans/Trousers nella stessa
 * categoria non hanno length). Un Type specifico vince sempre sul
 * default di categoria.
 */
export function lengthOptionsFor(category: string | null | undefined, type: string | null | undefined): string[] {
  if (type && LENGTH_OPTIONS_BY_TYPE[type]) return LENGTH_OPTIONS_BY_TYPE[type];
  if (category && LENGTH_OPTIONS_BY_CATEGORY[category]) return LENGTH_OPTIONS_BY_CATEGORY[category];
  return [];
}

export function lengthAppliesTo(category: string | null | undefined, type: string | null | undefined): boolean {
  return lengthOptionsFor(category, type).length > 0;
}

/**
 * Retrocompatibilità: i capi salvati prima di questa revisione hanno
 * subcategory con lunghezza/tacco incorporati (es. "Mini Dress",
 * "High Heel Pumps"). Questa funzione li traduce nei nuovi valori
 * puliti, così i filtri e l'AI possono continuare a usarli senza che
 * l'utente debba ricaricare ogni capo.
 */
export function mapLegacySubcategory(
  oldValue: string | null | undefined,
  category: string | null | undefined,
): { type: string | null; length: string | null; heelHeight: string | null } {
  if (!oldValue) return { type: null, length: null, heelHeight: null };
  const v = oldValue.trim();

  let length: string | null = null;
  if (/^mini\b/i.test(v)) length = "Mini";
  else if (/^midi\b/i.test(v)) length = "Midi";
  else if (/^maxi\b/i.test(v)) length = "Maxi";

  let heelHeight: string | null = null;
  if (/high heel/i.test(v)) heelHeight = "High";
  else if (/mid heel/i.test(v)) heelHeight = "Mid";
  else if (/low heel/i.test(v)) heelHeight = "Low";
  else if (/flat/i.test(v)) heelHeight = "Flat";

  // Se il valore ripulito coincide già con un Type valido nella nuova
  // lista, lo teniamo; altrimenti torna null (va riclassificato).
  const stripped = v
    .replace(/^(mini|midi|maxi)\s*/i, "")
    .replace(/\s*(high|mid|low)\s*heel\s*/i, "")
    .trim();
  const validTypes = category ? (SUBCATEGORY_OPTIONS[category] ?? []) : [];
  const type = validTypes.includes(stripped) ? stripped
    : validTypes.includes(v) ? v
    : null;

  return { type, length, heelHeight };
}
