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
  Tops: ["T-Shirt", "Oversized T-Shirt", "Fitted T-Shirt", "Tank Top", "Crop Top", "Bodysuit", "Blouse", "Shirt", "Polo", "Sweater", "Cardigan", "Hoodie", "Sweatshirt", "Off-Shoulder Top", "Halter Top"],
  Outerwear: ["Coat", "Wool Coat", "Trench Coat", "Puffer Jacket", "Parka", "Denim Jacket", "Leather Jacket", "Bomber Jacket", "Blazer", "Oversized Blazer", "Cropped Blazer", "Vest"],
  Bottoms: ["Skinny Jeans", "Straight Jeans", "Wide Leg Jeans", "Bootcut Jeans", "Flared Jeans", "Mom Jeans", "Tailored Trousers", "Wide Leg Trousers", "Cargo Trousers", "Linen Trousers", "Leggings", "Denim Shorts", "Tailored Shorts", "Cargo Shorts", "Mini Skirt", "Midi Skirt", "Maxi Skirt", "Denim Skirt", "Pleated Skirt", "Pencil Skirt", "Wrap Skirt"],
  Dresses: ["Mini Dress", "Midi Dress", "Maxi Dress", "Slip Dress", "Shirt Dress", "Wrap Dress", "Bodycon Dress", "A-line Dress", "Evening Dress", "Jumpsuit"],
  Shoes: ["Flat Sandals", "Heeled Sandals", "Ankle Boots", "Knee-high Boots", "Over-the-knee Boots", "Running Sneakers", "Lifestyle Sneakers", "High-top Sneakers", "Loafers", "High Heel Pumps", "Mid Heel Pumps", "Low Heel Pumps", "Ballet Flats", "Mules", "Espadrilles", "Wedges", "Platform Heels", "Slides", "Slippers"],
  Bags: ["Tote", "Crossbody", "Clutch", "Backpack", "Shoulder Bag", "Bucket Bag", "Belt Bag"],
  Accessories: ["Belt", "Scarf", "Hat", "Sunglasses", "Jewelry", "Gloves", "Watch", "Hair Accessory"],
  Underwear: ["Bra", "Briefs", "Sleepwear", "Shapewear", "Socks"],
};

export function subcategoriesFor(category: string | null | undefined): string[] {
  return category ? (SUBCATEGORY_OPTIONS[category] ?? []) : [];
}
