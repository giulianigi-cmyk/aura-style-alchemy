import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";

type Props = {
  src: string;
  onCancel: () => void;
  onSave: (blob: Blob) => Promise<void> | void;
};

async function getCroppedBlob(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92)
  );
}

export function AvatarCropper({ src, onCancel, onSave }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleSave = async () => {
    if (!area) return;
    setSaving(true);
    try {
      const blob = await getCroppedBlob(src, area);
      await onSave(blob);
    } finally {
      setSaving(false);
    }
  };

  return (
        <div className="fixed inset-x-0 top-0 z-[80] h-[100dvh] bg-black flex flex-col">

            <div className="relative flex-1 min-h-0">

        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>
            <div className="bg-background px-6 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] space-y-5 shrink-0">

        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">Zoom</p>
          <input
            type="range" min={1} max={4} step={0.01}
            value={zoom} onChange={e => setZoom(Number(e.target.value))}
            className="w-full accent-foreground"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel} disabled={saving}
            className="flex-1 h-12 rounded-full border border-border text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleSave} disabled={saving || !area}
            className="flex-1 h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.3em] active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
