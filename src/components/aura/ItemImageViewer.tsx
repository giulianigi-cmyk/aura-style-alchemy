import { X } from "lucide-react";

/** Full-screen popup to inspect a single garment photo at real size —
 *  opened by tapping a small item thumbnail inside a planned outfit
 *  (Stylist, Planner). Not used inside the OutfitBuilder canvas, which
 *  already shows pieces at full size. Fixed (not absolute) so it always
 *  pins to the actual viewport regardless of which scrollable screen it
 *  was opened from — same fix as the "Crea outfit da lavoro" sheet. */
export function ItemImageViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-background/95 backdrop-blur flex items-center justify-center p-6"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Chiudi"
        className="absolute top-6 right-6 h-10 w-10 rounded-full bg-secondary/80 border border-border flex items-center justify-center active:scale-90"
      >
        <X size={18} />
      </button>
      <div
        className="max-w-full max-h-[80vh] rounded-2xl overflow-hidden bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt={alt ?? ""} className="max-w-full max-h-[80vh] object-contain" />
      </div>
    </div>
  );
}
