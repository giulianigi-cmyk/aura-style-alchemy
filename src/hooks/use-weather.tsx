import { useCallback, useEffect, useState } from "react";
import { fetchWeather, type WeatherBundle } from "@/lib/weather";

type State = {
  data: WeatherBundle | null;
  loading: boolean;
  error: string | null;
};

export function useWeather(lat: number | null | undefined, lon: number | null | undefined) {
  const [state, setState] = useState<State>({ data: null, loading: false, error: null });

  const load = useCallback(async () => {
    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWeather(lat, lon);
      setState({ data, loading: false, error: null });
    } catch (e: unknown) {
      setState({
        data: null,
        loading: false,
        error: e instanceof Error ? e.message : "Couldn't load weather",
      });
    }
  }, [lat, lon]);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}
