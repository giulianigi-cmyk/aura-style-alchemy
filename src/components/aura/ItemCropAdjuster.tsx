import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export type FractionalBox = { x: number; y: number; width: number; height: number };

type Props = {
  src: string;
  initialBox: FractionalBox | null;
  onCancel: () => void;
  onSave: (result: { dataUrl: string; box: FractionalBox }) => Promise<void> | void;
};

const MIN_SIZE = 0.04; // smallest allowed box side, as a fraction of the photo

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Crop the ORIGINAL photo to the exact rectangle the person drew — a plain
 *  rectangular cut, not a per-pixel mask. That's the point of this tool:
 *  no model guessing, just what the person picked. */
async function cropToDataUrl(src: string, box: FractionalBox): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image load failed"));
    el.src = src;
  });
  const sx = Math.round(box.x * img.naturalWidth);
  const sy = Math.round(box.y * img.naturalHeight);
  const sw = Math.max(4, Math.round(box.width * img.naturalWidth));
  const sh = Math.max(4, Math.round(box.height * img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

type Handle = "move" | "nw" | "ne" | "sw" | "se";

/** Full-screen crop-box editor over the ORIGINAL photo. Touch/pointer driven
 *  (works the same for mouse and finger — same approach as the Color Lab's
 *  tap-to-sample canvas). No aspect-ratio lock: garments aren't square. */
export function ItemCropAdjuster({ src, initialBox, onCancel, onSave }: Props) {
  const [box, setBox] = useState<FractionalBox>(
    initialBox ?? { x: 0.2, y: 0.15, width: 0.6, height: 0.6 },
  );
  const [saving, setSaving] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; startBox: FractionalBox } | null>(null);

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, startBox: box };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const b = drag.startBox;

    if (drag.handle === "move") {
      const x = Math.min(1 - b.width, Math.max(0, b.x + dx));
      const y = Math.min(1 - b.height, Math.max(0, b.y + dy));
      setBox({ ...b, x, y });
      return;
    }

    let { x, y, width, height } = b;
    if (drag.handle === "nw") {
      x = clamp01(b.x + dx); y = clamp01(b.y + dy);
      width = b.x + b.width - x; height = b.y + b.height - y;
    } else if (drag.handle === "ne") {
      y = clamp01(b.y + dy);
      width = clamp01(b.x + b.width + dx) - b.x; height = b.y + b.height - y;
    } else if (drag.handle === "sw") {
      x = clamp01(b.x + dx);
      width = b.x + b.width - x; height = clamp01(b.y + b.height + dy) - b.y;
    } else {
      width = clamp01(b.x + b.width + dx) - b.x;
      height = clamp01(b.y + b.height + dy) - b.y;
    }
    if (width < MIN_SIZE || height < MIN_SIZE) return;
    setBox({ x, y, width, height });
  };

  const onPointerUp = () => { dragRef.current = null; };

  const handleSave = async () => {
    setSaving(true);
    try {
      const dataUrl = await cropToDataUrl(src, box);
      await onSave({ dataUrl, box });
    } catch (e) {
      console.error("[AURA crop-adjust] failed", e);
      toast.error("Couldn't apply that crop — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black flex flex-col">
      <div className="px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-3 text-center shrink-0">
        <p className="text-white text-[10px] uppercase tracking-[0.3em]">Drag the corners to fix the crop</p>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <div
          ref={frameRef}
          className="relative max-h-full max-w-full"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <img src={src} alt="" className="max-h-[70vh] max-w-full object-contain select-none pointer-events-none" draggable={false} />
          <div
            className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] touch-none"
            style={{
              left: `${box.x * 100}%`, top: `${box.y * 100}%`,
              width: `${box.width * 100}%`, height: `${box.height * 100}%`,
            }}
            onPointerDown={onPointerDown("move")}
          >
            {(["nw", "ne", "sw", "se"] as const).map((h) => (
              <div
                key={h}
                onPointerDown={onPointerDown(h)}
                className={`absolute h-7 w-7 rounded-full bg-white border border-black/10 touch-none ${
                  h === "nw" ? "-left-3.5 -top-3.5" : h === "ne" ? "-right-3.5 -top-3.5" : h === "sw" ? "-left-3.5 -bottom-3.5" : "-right-3.5 -bottom-3.5"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="bg-background px-6 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-3 shrink-0">
        <div className="flex gap-3">
          <button
            onClick={onCancel} disabled={saving}
            className="flex-1 h-12 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-60"
          >Cancel</button>
          <button
            onClick={handleSave} disabled={saving}
            className="flex-1 h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Use this crop
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
