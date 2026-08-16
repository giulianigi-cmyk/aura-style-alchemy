// Ricerca online manuale per un capo non identificato automaticamente.
// Due percorsi distinti, scelti dall'utente:
//  - testo (Google normale): query costruita da brand/categoria/colore già
//    noti nel form — nessun upload necessario.
//  - immagine (Google Lens): richiede un URL pubblico raggiungibile da
//    Google, quindi la foto va prima caricata su storage (temporanea) e
//    firmata — vedi uploadImageForLensSearch in AddItem.tsx.
// Nessuna chiamata di rete qui: solo costruzione di stringhe, facilmente
// testabile e riusabile ovunque serva (AddItem, futura pipeline di
// identificazione prodotto).

/** Costruisce una query di ricerca testuale a partire dai campi già noti.
 *  Filtra i vuoti e mantiene l'ordine: brand prima (più specifico),
 *  poi categoria/sottocategoria, poi colore — stesso principio dei casi
 *  d'uso della spec (es. "800005 D001" "Patrizia Pepe"): più termini
 *  specifici prima, generici dopo. */
export function buildProductSearchQuery(parts: {
  brand?: string | null;
  productCode?: string | null;
  subcategory?: string | null;
  category?: string | null;
  color?: string | null;
}): string {
  const terms = [
    parts.productCode?.trim(),
    parts.brand?.trim(),
    parts.subcategory?.trim() || parts.category?.trim(),
    parts.color?.trim(),
  ].filter((t): t is string => Boolean(t && t.length > 0));

  // Il product code, se presente, va tra virgolette per una ricerca esatta
  // (stesso pattern della spec: "800005 D001" "Patrizia Pepe").
  return terms
    .map((t) => (t === parts.productCode?.trim() ? `"${t}"` : t))
    .join(" ");
}

export function buildGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/** Apre Google Lens puntato su un'immagine pubblica.
 *  L'URL passato DEVE essere raggiungibile da Google (mai un blob: locale) —
 *  per questo richiede un signed URL a breve scadenza, mai il path storage
 *  permanente, per non lasciare in giro link validi a lungo termine a una
 *  foto privata dell'utente. */
export function buildGoogleLensUrl(publicImageUrl: string): string {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(publicImageUrl)}`;
}
