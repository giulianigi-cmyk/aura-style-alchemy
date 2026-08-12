/** Cultural dress notes for trip destinations.
 *
 * The list is intentionally easy to extend: add a `{ countryKeywords, message }`
 * entry and it will automatically match any destination whose name contains
 * one of the keywords (case-insensitive).
 *
 * These notes are purely informational — they are shown to the user, but never
 * used to filter, limit, or influence the AI outfit generation logic.
 */
export type CulturalDressNote = {
  countryKeywords: string[];
  message: string;
};

export const CULTURAL_DRESS_NOTES: CulturalDressNote[] = [
  {
    countryKeywords: ["saudi arabia", "saudi"],
    message:
      "Saudi Arabia has more conservative dress conventions in public and religious settings (shoulders and knees covered). The outfits below are still based on your personal style and can be freely edited.",
  },
  {
    countryKeywords: ["united arab emirates", "uae", "dubai", "abu dhabi"],
    message:
      "The UAE is cosmopolitan, but public spaces such as malls and religious sites may appreciate modest coverage (shoulders and knees). The outfits below remain based on your style and are fully editable.",
  },
  {
    countryKeywords: ["qatar", "doha"],
    message:
      "Qatar values modest dress in public and cultural sites (shoulders and knees covered). The outfits below are generated from your wardrobe and can be adjusted however you like.",
  },
  {
    countryKeywords: ["kuwait"],
    message:
      "Kuwait tends toward conservative dress in public spaces (looser silhouettes, covered shoulders and knees). The outfits below are suggestions drawn from your style and can be edited freely.",
  },
  {
    countryKeywords: ["bahrain", "manama"],
    message:
      "Bahrain is relatively liberal, but modesty is still appreciated in souks and religious sites. The outfits below are based on your wardrobe and can be changed at any time.",
  },
  {
    countryKeywords: ["oman", "muscat"],
    message:
      "Oman is conservative in rural and religious areas (shoulders and knees covered, loose fits). The outfits below are generated from your style and remain freely editable.",
  },
  {
    countryKeywords: ["jordan", "amman", "petra"],
    message:
      "Jordan is moderate, but covering shoulders and knees is respectful at religious sites and more traditional areas. The outfits below are based on your wardrobe and can be edited freely.",
  },
  {
    countryKeywords: ["morocco", "marrakech", "casablanca", "fes"],
    message:
      "Morocco is diverse, but modest dress (covered shoulders and knees) is appreciated in medinas and rural areas. The outfits below are suggestions from your style and can be adjusted.",
  },
  {
    countryKeywords: ["egypt", "cairo", "luxor"],
    message:
      "Egypt is conservative in many public and religious settings (shoulders and knees covered). The outfits below are generated from your wardrobe and can be freely edited.",
  },
  {
    countryKeywords: ["iran", "tehran", "isfahan"],
    message:
      "Iran requires women to cover hair and wear loose, modest clothing in public. The outfits below are based on your wardrobe and should be adapted to local regulations.",
  },
];

/** Returns the cultural notes that match the given destination names.
 *  Each destination is checked against every countryKeywords list;
 *  the result is de-duplicated by the exact matched note. */
export function matchCulturalDressNotes(destinationNames: string[]): CulturalDressNote[] {
  const matched = new Set<CulturalDressNote>();
  for (const name of destinationNames) {
    const lower = name.toLowerCase();
    for (const note of CULTURAL_DRESS_NOTES) {
      if (note.countryKeywords.some((k) => lower.includes(k))) {
        matched.add(note);
      }
    }
  }
  return Array.from(matched);
}
