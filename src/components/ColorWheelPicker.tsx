import { useEffect, useRef, useState } from "react";
import { X, Pipette } from "lucide-react";
import { rgbToHsl, hslToHex, nearestWheelName, getHarmonies, type Harmony } from "@/lib/itten-wheel";
import { nearestPaletteColor } from "@/lib/color-palette";

/**
 * Standalone color-analysis tool: samples a pixel from a garment image
 * (tap-to-pick, works on iOS Safari — the native EyeDropper API does not)
 * and shows Itten-style harmony suggestions on a color wheel.
 *
 * Deliberately does NOT touch wardrobe matching or purchase suggestions —
 * those are separate, later steps.
 */
export function ColorWheelPicker({
  imageUrl,
  onClose,
}: {
  imageUrl: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loadError, setLoadError] = useState(false);
  const [pickedHex, setPickedHex] = useState<string | null>(null);
  const [pickedHue, setPickedHue] = useState<number | null>(null);
  const [harmonies, setHarmonies] = useState<Harmony[]>([]);

  useEffect(() => {
    let cancelled = false;
    let objUrl: string | null = null;
    (async () => {
      try {
        // Fetch ourselves (same reliable approach as the outfit export fix)
        // instead of leaning on <img crossOrigin> + browser cache quirks.
        const resp = await fetch(imageUrl, { mode: "cors", cache: "no-store" });
        if (!resp.ok) throw new Error(`fetch failed ${resp.status}`);
        const blob = await resp.blob();
        objUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (cancelled || !canvasRef.current) return;
          const canvas = canvasRef.current;
          const size = 320;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.clearRect(0, 0, size, size);
          const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        };
        img.onerror = () => { if (!cancelled) setLoadError(true); };
        img.src = objUrl;
      } catch (e) {
        console.error("[AURA color wheel] image load failed", e);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [imageUrl]);

  const handlePick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(x, y, 1, 1).data;
    } catch (err) {
      console.error("[AURA color wheel] getImageData blocked", err);
      setLoadError(true);
      return;
    }
    const [r, g, b, a] = data;
    if (a < 10) return; // tapped transparent background — ignore, don't sample "nothing"
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    const { h } = rgbToHsl(r, g, b);
    setPickedHex(hex);
    setPickedHue(h);
    setHarmonies(getHarmonies(hex));
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-card rounded-t-3xl sm:rounded-3xl border border-border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] relative"
      >
        <div className="flex items-center justify-between">
          <p className="font-serif italic text-lg">Color Harmony</p>
          <button onClick={onClose} aria-label="Chiudi" className="h-9 w-9 rounded-full bg-secondary/60 flex items-center justify-center active:scale-90">
            <X size={16} />
          </button>
        </div>

        {loadError ? (
          <p className="text-sm text-muted-foreground mt-6 text-center">
            Impossibile caricare l'immagine per l'analisi colore.
          </p>
        ) : (
          <>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <Pipette size={13} /> Tap the garment to sample a color
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-1">
              Based on the Johannes Itten color wheel — this shows which colors pair well
              with each other, not your personal color season.
            </p>
            <canvas
              ref={canvasRef}
              onPointerDown={handlePick}
              className="mt-3 w-full aspect-square rounded-2xl border border-border touch-none"
              style={{ background: "#FFFFFF" }}
            />

            {pickedHex && pickedHue !== null && (
              <div className="mt-5">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-full border border-border shrink-0" style={{ background: pickedHex }} />
                  <div>
                    <p className="text-sm font-medium">{nearestPaletteColor(pickedHex).name}</p>
                    <p className="text-[11px] text-muted-foreground">{pickedHex} · {nearestWheelName(pickedHue)}</p>
                  </div>
                </div>

                <div className="mt-4 relative mx-auto" style={{ width: 180, height: 180 }}>
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background:
                        "conic-gradient(from 0deg, red, orange, yellow, yellowgreen, green, mediumspringgreen, cyan, deepskyblue, blue, violet, magenta, crimson, red)",
                    }}
                  />
                  <div className="absolute inset-[18%] rounded-full bg-card" />
                  {[{ hue: pickedHue, size: 16, ring: true }, ...harmonies.map((h) => ({ hue: h.hue, size: 10, ring: false }))].map((m, i) => {
                    const rad = ((m.hue - 90) * Math.PI) / 180;
                    const r = 82;
                    const cx = 90 + r * Math.cos(rad);
                    const cy = 90 + r * Math.sin(rad);
                    return (
                      <span
                        key={i}
                        className={`absolute rounded-full ${m.ring ? "border-2 border-foreground" : "border border-white/70"}`}
                        style={{
                          width: m.size, height: m.size,
                          left: cx - m.size / 2, top: cy - m.size / 2,
                          background: m.ring ? pickedHex : hslToHex(m.hue, 0.75, 0.5),
                        }}
                      />
                    );
                  })}
                </div>

<div className="mt-5 space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Suggested pairings</p>
                  {harmonies.map((h, i) => {
                    const named = nearestPaletteColor(h.hex);
                    return (
                      <div key={i} className="flex items-center gap-3 rounded-xl bg-secondary/30 px-3 py-2">
                        <span className="h-8 w-8 rounded-full border border-border shrink-0" style={{ background: h.hex }} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{named.name}</p>
                          <p className="text-[10px] text-muted-foreground">{h.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
