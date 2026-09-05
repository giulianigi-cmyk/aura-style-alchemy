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

// Milder than HOT/COLD_THRESHOLD_C on purpose — those exclude outright (a
// wool coat at 32°C), these only inform a PREFERENCE between two
// otherwise-equal choices (a long-sleeve top isn't wrong at 21°C, just a
// less ideal pick than a short-sleeve one when both are equally
// appropriate otherwise). Shared here — not duplicated in
// trip-capsule.server.ts and ai-suggest-outfit.functions.ts separately —
// so both capsule building and the final per-slot pick agree on the same
// boundary.
export const MILD_WARM_THRESHOLD_C = 20;
export const MILD_COOL_THRESHOLD_C = 16;

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

/** True if the chosen ids include a top/dress whose sleeve length fights
 *  the real temperature AND a better-suited alternative sat unused in the
 *  same catalog. That second condition is what keeps this a genuine
 *  preference rather than a new hard rule: if a short-sleeve top is truly
 *  the only one available, choosing it for a cool evening is not a
 *  violation — there was nothing else to pick.
 *
 *  This is what actually decides which of two capsule members wins a
 *  specific day/evening slot. Building the capsule (trip-capsule.server.ts)
 *  only decides which items make it IN at all — once both a t-shirt and a
 *  long-sleeve shirt are capsule members, only this check (run on the
 *  model's actual per-slot choice, with a retry on failure, same
 *  mechanism as anyItemViolatesWeather) makes the day/evening contrast
 *  something enforced rather than hoped for from a prompt sentence. */
export function violatesSleeveClimate<T extends WeatherCheckableItem & { id: string; sleeveLength?: string | null }>(
  ids: string[],
  catalog: T[],
  temperature: number | null
): boolean {
  if (temperature == null) return false;
  const warm = temperature >= MILD_WARM_THRESHOLD_C;
  const cool = temperature < MILD_COOL_THRESHOLD_C;
  if (!warm && !cool) return false;

  const isTopLike = (c: T) => c.category === "Tops" || c.category === "Dresses";
  const sleeveOf = (c: T) => (c.sleeveLength ?? "").toLowerCase();
  const isLong = (c: T) => sleeveOf(c) === "long sleeve";
  const isShort = (c: T) => sleeveOf(c) === "sleeveless" || sleeveOf(c) === "short sleeve";

  return ids.some((id) => {
    const chosen = catalog.find((c) => c.id === id);
    if (!chosen || !isTopLike(chosen)) return false;
    const mismatched = (warm && isLong(chosen)) || (cool && isShort(chosen));
    if (!mismatched) return false;
    return catalog.some((c) => isTopLike(c) && !ids.includes(c.id) && (warm ? isShort(c) : isLong(c)));
  });
}
