export const ITEM_CATEGORIES = ["Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories", "Underwear"];
export const SEASON_OPTIONS = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"];
export const STYLE_OPTIONS = ["Minimal", "Editorial", "Quiet luxury", "Street", "Romantic", "Tailored", "Bohemian", "Sporty", "Vintage"];
export const OCCASION_OPTIONS = ["Everyday", "Work", "Evening", "Weekend", "Travel", "Formal", "Sport"];
export const MATERIAL_OPTIONS = [
  "Cotton", "Linen", "Silk", "Wool", "Merino", "Cashmere", "Mohair", "Alpaca",
  "Viscose", "Modal", "Lyocell", "Cupro",
  "Polyester", "Polyamide", "Elastane", "Acrylic",
  "Denim", "Leather", "Suede", "Shearling", "Down",
  "Metal", "Gold", "Silver", "Steel", "Brass", "Pearl", "Rubber", "Canvas",
  "Synthetic", "Knit",
];
export const CURRENCY_OPTIONS = ["EUR", "USD", "GBP"];

export const SUBCATEGORY_OPTIONS: Record<string, string[]> = {
  Tops: ["T-Shirt", "Shirt", "Blouse", "Sweater", "Tank Top", "Polo", "Crop Top", "Bodysuit"],
  Outerwear: ["Coat", "Trench Coat", "Jacket", "Blazer", "Cardigan", "Vest", "Puffer", "Parka"],
  Bottoms: ["Jeans", "Trousers", "Shorts", "Skirt", "Leggings", "Cargo Pants"],
  Dresses: ["Mini Dress", "Midi Dress", "Maxi Dress", "Jumpsuit", "Wrap Dress"],
  Shoes: ["Sandals", "Flats", "Sneakers", "Loafers", "Pumps / Heels", "Boots", "Espadrilles", "Slides", "Slippers"],
  Bags: ["Tote", "Crossbody", "Clutch", "Backpack", "Shoulder Bag", "Bucket Bag", "Belt Bag"],
  Accessories: ["Belt", "Scarf", "Hat", "Sunglasses", "Jewelry", "Gloves", "Watch", "Hair Accessory"],
  Underwear: ["Bra", "Briefs", "Sleepwear", "Shapewear", "Socks"],
};

export function subcategoriesFor(category: string | null | undefined): string[] {
  return category ? (SUBCATEGORY_OPTIONS[category] ?? []) : [];
}
