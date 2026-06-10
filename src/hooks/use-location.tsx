import { useCallback, useEffect, useState } from "react";
import { useProfile } from "./use-profile";

type Status = "idle" | "loading" | "granted" | "denied" | "unsupported" | "error";

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
          const r = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
          );
          const data = await r.json();
          const city = data.city || data.locality || data.principalSubdivision || "Your area";
          await update({ city });
          setStatus("granted");
        } catch (e: unknown) {
          setStatus("error"); setError(e instanceof Error ? e.message : "Lookup failed");
        }
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        setError(err.message);
      },
      { timeout: 10000, maximumAge: 600000 }
    );
  }, [update]);

  const setManual = useCallback(async (city: string) => {
    const v = city.trim();
    if (!v) return;
    await update({ city: v });
    setStatus("granted");
  }, [update]);

  useEffect(() => { /* nothing on mount; let UI trigger */ }, []);

  return { city: profile?.city ?? null, status, error, detect, setManual };
}
