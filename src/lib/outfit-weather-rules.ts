// AURA — Universal weather/season hard-check for outfit generation.
//
// Prima di questo file, la stessa identica regola viveva in due posti
// diversi: dentro suggestOutfitCore (ai-suggest-outfit.functions.ts) e come
// copia indipendente in suggest-daily-looks.functions.ts. Le due copie
// erano divergenti — quella di Home non controllava il campo `material`,
// usava `season === "winter"` invece di `.includes()` (season è una
// stringa multi-valore tipo "Autumn, Winter", quindi l'uguaglianza stretta
// non matcha quasi mai un capo invernale vero), e aveva una regex più
// corta (mancavano wool/lana/cashmere/tweed/ecc.). Risultato pratico: un
// maglione di lana poteva superare il controllo di Home mentre veniva
// correttamente escluso ovunque altro. Questo file è ora l'unica fonte di
// verità — nessun motore deve più avere una propria copia.
//
// weekly-outfits.functions.ts e trip-capsule.server.ts ereditano già
// questa regola indirettamente, perché entrambi chiamano suggestOutfitCore
// per la generazione finale.

export const HOT_THRESHOLD_C = 26;
export const COLD_THRESHOLD_C = 10;

export const HEAVY_SIGNAL =
  /coat|cappotto|piumino|parka|overcoat|puffer|shearling|montone|wool|lana|maglione|sweater|felted|fleece|boots?\b|stivali|tweed|corduroy|velluto a coste|flannel|flanella|cashmere|cachemire/i;
export const LIGHT_SIGNAL = /tank|canotta|sandal|sandalo|shorts?\b|infradito|flip.?flop|sleeveless|senza maniche/i;

export interface WeatherCheckableItem {
  category?: string | null;
  subcategory?: string | null;
  styleTags?: string[] | null;
  material?: string[] | null;
  season?: string | null;
  toeShape?: string | null;
}

/** True if a single item is wrong for the given temperature. `temperature
 *  == null` always returns false — no weather data means no opinion,
 *  never a guess. */
export function violatesWeatherRule(item: WeatherCheckableItem, temperature: number | null): boolean {
  if (temperature == null) return false;
  const hot = temperature >= HOT_THRESHOLD_C;
  const cold = temperature <= COLD_THRESHOLD_C;
  if (!hot && !cold) return false;

  const text = `${item.category ?? ""} ${item.subcategory ?? ""} ${(item.styleTags ?? []).join(" ")} ${(item.material ?? []).join(" ")}`;
  // season is stored as a comma-joined multi-value string (e.g.
  // "Autumn, Winter"), never a single exact value — .includes() is
  // deliberate, an === check silently never matches most cold-weather
  // garments (this was exactly the Home engine's bug).
  const season = (item.season ?? "").toLowerCase();

  if (hot) {
    if (season.includes("winter")) return true;
    if (HEAVY_SIGNAL.test(text)) return true;
  }
  if (cold) {
    if (season.includes("summer") && LIGHT_SIGNAL.test(text)) return true;
    // Structured signal, not just text pattern-matching: an item
    // explicitly tagged Open Toe is a bare-foot shoe in cold weather
    // regardless of what its subcategory text happens to say.
    if (item.toeShape === "Open Toe") return true;
  }
  return false;
}

/** True if ANY item among the given ids (looked up in `catalog`) violates
 *  the weather rule — the shape every generator actually needs. */
export function anyItemViolatesWeather<T extends WeatherCheckableItem & { id: string }>(
  ids: string[],
  catalog: T[],
  temperature: number | null
): boolean {
  if (temperature == null) return false;
  return ids.some((id) => {
    const item = catalog.find((c) => c.id === id);
    if (!item) return false;
    return violatesWeatherRule(item, temperature);
  });
}
