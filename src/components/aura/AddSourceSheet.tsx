import { useEffect, useState } from "react";
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
      aria-label="Add pieces"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-2"
      >
        <div className="flex items-center gap-2 mb-1">
          {level === 2 && (
            <button
              onClick={() => setLevel(1)}
              aria-label="Back"
              className="h-8 w-8 rounded-full border border-border flex items-center justify-center active:scale-90"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <p className="font-serif italic text-lg">
            {level === 1 ? "Add to your closet" : "Scan several pieces"}
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
                <p className="text-sm font-medium">Add one piece</p>
                <p className="text-xs text-muted-foreground">One item at a time, with full details</p>
              </div>
            </button>
            <button
              onClick={() => setLevel(2)}
              className="w-full flex items-center gap-3 rounded-2xl border border-border p-4 text-left active:scale-[0.98] transition"
            >
              <Sparkles size={18} />
              <div>
                <p className="text-sm font-medium">Scan several pieces</p>
                <p className="text-xs text-muted-foreground">Up to 150 photos together, fast</p>
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
                <p className="text-sm font-medium">Scan one outfit</p>
                <p className="text-xs text-muted-foreground">One photo, multiple items detected at once</p>
              </div>
            </button>
            <button
              onClick={() => onChoose("batch-scan")}
              className="w-full flex items-center gap-3 rounded-2xl border border-border p-4 text-left active:scale-[0.98] transition"
            >
              <Images size={18} />
              <div>
                <p className="text-sm font-medium">Batch scan photos</p>
                <p className="text-xs text-muted-foreground">Up to 150 photos at once, processed in the background</p>
              </div>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
