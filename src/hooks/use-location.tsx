import { useCallback, useState } from "react";
import { useProfile } from "./use-profile";

type Status = "idle" | "loading" | "granted" | "denied" | "unsupported" | "error";

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    );
    const data = await r.json();
    return data.city || data.locality || data.principalSubdivision || "Your area";
  } catch {
    return "Your area";
  }
}

async function geocodeCity(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(city)}`
    );
    const data = await r.json();
    const hit = data?.results?.[0];
    if (!hit) return null;
    return { lat: Number(hit.latitude), lon: Number(hit.longitude), name: hit.name || city };
  } catch {
    return null;
  }
}

export function useLocation() {
  const { profile, update } = useProfile();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported"); return;
    }
    setStatus("loading"); setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const city = await reverseGeocode(latitude, longitude);
          await update({ city, latitude, longitude });
          setStatus("granted");
        } catch (e: unknown) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Lookup failed");
        }
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        setError(err.message);
      },
      { timeout: 10000, maximumAge: 600000, enableHighAccuracy: false }
    );
  }, [update]);

  const setManual = useCallback(async (city: string) => {
    const v = city.trim();
    if (!v) return;
    setStatus("loading"); setError(null);
    const geo = await geocodeCity(v);
    if (geo) {
      await update({ city: geo.name, latitude: geo.lat, longitude: geo.lon });
    } else {
      // Save city even if geocoding fails; weather will simply be unavailable.
      await update({ city: v, latitude: null, longitude: null });
    }
    setStatus("granted");
  }, [update]);

  return {
    city: profile?.city ?? null,
    latitude: profile?.latitude ?? null,
    longitude: profile?.longitude ?? null,
    status,
    error,
    detect,
    setManual,
  };
}
