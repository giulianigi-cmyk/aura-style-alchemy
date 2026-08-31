import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Camera, Images, Plus, Sparkles } from "lucide-react";

export type AddSourceChoice = "add" | "outfit-scan" | "batch-scan";

/**
 * Unified entry point for adding pieces to the closet.
 * Level 1: single piece vs. multi-photo scan.
 * Level 2 (scan): the two existing scan flows.
 */
export function AddSourceSheet({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (choice: AddSourceChoice) => void;
}) {
  const { t } = useTranslation();
  const [level, setLevel] = useState<1 | 2>(1);

  useEffect(() => {
    if (open) setLevel(1);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-background/80 backdrop-blur flex items-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("addSourceSheet.addPiecesAria")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-2"
      >
        <div className="flex items-center gap-2 mb-1">
          {level === 2 && (
            <button
              onClick={() => setLevel(1)}
              aria-label={t("addSourceSheet.backAria")}
              className="h-8 w-8 rounded-full border border-border flex items-center justify-center active:scale-90"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <p className="font-serif italic text-lg">
            {level === 1 ? t("addSourceSheet.addToYourCloset") : t("addSourceSheet.scanSeveralPieces")}
          </p>
        </div>

        {level === 1 ? (
          <>
            <button
              onClick={() => onChoose("add")}
              className="w-full flex items-center gap-3 rounded-2xl border border-border p-4 text-left active:scale-[0.98] transition"
            >
              <Plus size={18} />
              <div>
                <p className="text-sm font-medium">{t("addSourceSheet.addOnePiece")}</p>
                <p className="text-xs text-muted-foreground">{t("addSourceSheet.addOnePieceHint")}</p>
              </div>
            </button>
            <button
              onClick={() => setLevel(2)}
              className="w-full flex items-center gap-3 rounded-2xl border border-border p-4 text-left active:scale-[0.98] transition"
            >
              <Sparkles size={18} />
              <div>
                <p className="text-sm font-medium">{t("addSourceSheet.scanSeveralPieces")}</p>
                <p className="text-xs text-muted-foreground">{t("addSourceSheet.scanSeveralPiecesHint")}</p>
              </div>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onChoose("outfit-scan")}
              className="w-full flex items-center gap-3 rounded-2xl border border-border p-4 text-left active:scale-[0.98] transition"
            >
              <Camera size={18} />
              <div>
                <p className="text-sm font-medium">{t("addSourceSheet.scanOneOutfit")}</p>
                <p className="text-xs text-muted-foreground">{t("addSourceSheet.scanOneOutfitHint")}</p>
              </div>
            </button>
            <button
              onClick={() => onChoose("batch-scan")}
              className="w-full flex items-center gap-3 rounded-2xl border border-border p-4 text-left active:scale-[0.98] transition"
            >
              <Images size={18} />
              <div>
                <p className="text-sm font-medium">{t("addSourceSheet.batchScanPhotos")}</p>
                <p className="text-xs text-muted-foreground">{t("addSourceSheet.batchScanPhotosHint")}</p>
              </div>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
