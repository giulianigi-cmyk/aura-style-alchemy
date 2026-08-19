import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** One gallery tile image: skeleton while the signed URL resolves and while the
 *  bytes are still downloading, one automatic re-sign retry on error, and an
 *  explicit error state instead of a silent white card.
 *  Shared between ChatOutfitPicker and SavedOutfits (and any other outfit
 *  grid) so the loading/retry/error behaviour stays consistent everywhere. */
export function OutfitThumb({
  path,
  url,
  alt,
  signing,
  className = "aspect-[4/5]",
}: {
  path: string;
  url?: string;
  alt: string;
  signing: boolean;
  className?: string;
}) {
  const [src, setSrc] = useState<string | undefined>(url);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    setSrc(url);
    setLoaded(false);
    setFailed(false);
    setRetried(false);
  }, [url]);

  // signPaths finished but this path got no signed URL → treat as an error.
  const missing = !signing && !url;

  const onError = async () => {
    if (retried) { setFailed(true); return; }
    setRetried(true);
    const { data } = await supabase.storage.from("outfits").createSignedUrl(path, 60 * 60);
    if (data?.signedUrl) setSrc(`${data.signedUrl}${data.signedUrl.includes("?") ? "&" : "?"}r=1`);
    else setFailed(true);
  };

  if (missing || failed) {
    return (
      <div className={`${className} bg-secondary/40 flex items-center justify-center px-3 text-center`}>
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Impossibile caricare</span>
      </div>
    );
  }

  return (
    <div className={`relative ${className} bg-white`}>
      {!loaded && <div className="absolute inset-0 bg-secondary/40 animate-pulse" />}
      {src && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => void onError()}
          className={`h-full w-full object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}
