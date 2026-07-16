// Open-Meteo weather client (no API key required) + outfit recommendation logic.
// Structured to allow future premium features (advanced outfit gen, color analysis,
// shopping recommendations, weekly planning) to consume the same shapes.

export type CurrentWeather = {
  temperature: number;
  apparentTemperature: number;
  weatherCode: number;
  windSpeed: number;
  precipitationProbability: number;
  isDay: boolean;
};

export type DailyForecast = {
  date: string; // YYYY-MM-DD
  tempMin: number;
  tempMax: number;
  precipitationProbability: number;
  weatherCode: number;
};

export type WeatherBundle = {
  current: CurrentWeather;
  daily: DailyForecast[];
  units: { temp: string; wind: string };
  fetchedAt: number;
};

export async function fetchWeather(lat: number, lon: number): Promise<WeatherBundle> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability,is_day"
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code"
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");

  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Weather request failed (${r.status})`);
  const j = await r.json();

  const c = j.current ?? {};
  const d = j.daily ?? {};
  return {
    current: {
      temperature: Number(c.temperature_2m ?? 0),
      apparentTemperature: Number(c.apparent_temperature ?? c.temperature_2m ?? 0),
      weatherCode: Number(c.weather_code ?? 0),
      windSpeed: Number(c.wind_speed_10m ?? 0),
      precipitationProbability: Number(c.precipitation_probability ?? 0),
      isDay: Number(c.is_day ?? 1) === 1,
    },
    daily: (d.time ?? []).map((date: string, i: number): DailyForecast => ({
      date,
      tempMin: Number(d.temperature_2m_min?.[i] ?? 0),
      tempMax: Number(d.temperature_2m_max?.[i] ?? 0),
      precipitationProbability: Number(d.precipitation_probability_max?.[i] ?? 0),
      weatherCode: Number(d.weather_code?.[i] ?? 0),
    })),
    units: {
      temp: j.current_units?.temperature_2m ?? "°C",
      wind: j.current_units?.wind_speed_10m ?? "km/h",
    },
    fetchedAt: Date.now(),
  };
}

// WMO weather code -> human label + emoji icon
export function describeWeather(code: number, isDay = true): { label: string; icon: string } {
  if (code === 0) return { label: "Clear", icon: isDay ? "☀️" : "🌙" };
  if (code === 1) return { label: "Mostly clear", icon: isDay ? "🌤️" : "🌙" };
  if (code === 2) return { label: "Partly cloudy", icon: "⛅" };
  if (code === 3) return { label: "Overcast", icon: "☁️" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "🌫️" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "🌦️" };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "🌧️" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "❄️" };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: "🌦️" };
  if (code === 85 || code === 86) return { label: "Snow showers", icon: "🌨️" };
  if (code >= 95) return { label: "Thunderstorm", icon: "⛈️" };
  return { label: "—", icon: "🌡️" };
}

export type WeatherBand = "cold" | "cool" | "mild" | "warm" | "hot";

export function classifyTemp(tempC: number): WeatherBand {
  if (tempC < 5) return "cold";
  if (tempC < 12) return "cool";
  if (tempC < 20) return "mild";
  if (tempC < 27) return "warm";
  return "hot";
}

export type OutfitSuggestion = {
  band: WeatherBand;
  rainy: boolean;
  headline: string;
  tips: string[];
  /** wardrobe category keywords to match against the user's pieces */
  categories: string[];
  /** preferred fabrics for this weather band, used to boost/filter matches */
  materials: string[];
};

/**
 * Per-band outfit guidance. Each band lists a broader set of pieces (not just
 * one silhouette) plus the fabrics that suit that temperature range, so
 * "hot" isn't limited to slip dresses/shorts and "warm"/"mild"/"cool"/"cold"
 * each get their own material logic instead of only categories.
 */
const baseByBand: Record<WeatherBand, Omit<OutfitSuggestion, "band" | "rainy">> = {
  cold: {
    headline: "Wrap up — layered tailoring weather",
    tips: ["Wool coat", "Cashmere knit", "Boots", "Scarf", "Wool trousers", "Leather gloves"],
    categories: ["coat", "knit", "sweater", "boots", "scarf", "trousers", "gloves", "puffer"],
    materials: ["Wool", "Cashmere", "Leather", "Knit", "Suede"],
  },
  cool: {
    headline: "Crisp air — soft layering",
    tips: ["Trench or blazer", "Fine knit", "Trousers", "Ankle boots", "Denim jacket"],
    categories: ["jacket", "blazer", "knit", "trousers", "boots", "denim", "sweater"],
    materials: ["Wool", "Knit", "Denim", "Cotton", "Leather"],
  },
  mild: {
    headline: "Mild day — easy elegance",
    tips: ["Light jacket", "Jeans or trousers", "Sneakers or loafers", "Cotton shirt", "Light knit"],
    categories: ["jacket", "shirt", "jeans", "trousers", "sneakers", "loafers", "knit"],
    materials: ["Cotton", "Denim", "Knit", "Suede"],
  },
  warm: {
    headline: "Warm — breathable pieces",
    tips: ["Linen shirt", "Midi skirt or chinos", "Loafers", "Cotton dress", "Light trousers"],
    categories: ["shirt", "skirt", "dress", "trousers", "loafers", "top"],
    materials: ["Linen", "Cotton", "Silk"],
  },
  hot: {
    headline: "Hot — keep it airy",
    tips: [
      "Slip dress", "Shorts", "Sandals", "Sun hat", "Tank top", "Camisole",
      "Midi skirt", "Mini skirt", "Silk shirt", "Linen shirt", "Wide-leg trousers",
    ],
