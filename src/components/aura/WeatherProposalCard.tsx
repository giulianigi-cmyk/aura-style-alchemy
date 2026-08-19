import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CloudRain, Loader2, Umbrella } from "lucide-react";
import { toast } from "sonner";
import type { WardrobeItem } from "@/lib/aura-types";
import { thumbSrc } from "@/lib/wardrobe-image";
import { acceptWeatherProposal, resolveWeatherProposal } from "@/lib/plan-weather.functions";
import { UMBRELLA_PRECIPITATION_THRESHOLD } from "@/lib/weather-constants";

export type WeatherProposal = {
  id: string;
  title: string;
  body: string | null;
  data: {
    plan_id?: string;
    date?: string;
    old_temp?: number | null;
    old_condition?: string | null;
    new_temp?: number | null;
    new_condition?: string | null;
    new_precipitation_probability?: number | null;
    old_item_ids?: string[];
    new_item_ids?: string[];
    trip_id?: string | null;
    trip_activity_id?: string | null;
  };
};

function Row({ label, ids, items, signed }: { label: string; ids: string[]; items: WardrobeItem[]; signed: Record<string, string> }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-1.5">{label}</p>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {ids.map((id) => {
          const it = items.find((w) => w.id === id);
          const src = it ? thumbSrc(it, signed) : "";
          return (
            <div key={id} className="h-14 w-14 shrink-0 rounded-lg overflow-hidden border border-border/60" style={{ background: "#FFFFFF" }}>
              {src ? <img src={src} className="h-full w-full object-contain p-1" alt="" loading="lazy" decoding="async" /> : null}
            </div>
          );
        })}
        {!ids.length && <p className="text-[11px] text-muted-foreground">—</p>}
      </div>
    </div>
  );
}

/**
 * "Keep original" is an explicit resolution, not a dismissal of the UI:
 * without marking the notification, the hourly worker would treat the
 * proposal as still open and keep re-proposing it.
 */
export function WeatherProposalCard({
  proposal, items, signed, onResolved, onCustomize,
}: {
  proposal: WeatherProposal;
  items: WardrobeItem[];
  signed: Record<string, string>;
  onResolved: (outcome: "accepted" | "dismissed") => void;
  onCustomize?: () => void;
}) {
  const accept = useServerFn(acceptWeatherProposal);
  const resolve = useServerFn(resolveWeatherProposal);
  const [busy, setBusy] = useState<null | "accept" | "keep">(null);
  const d = proposal.data ?? {};
  const rainPct = d.new_precipitation_probability ?? null;

  const onAccept = async () => {
    setBusy("accept");
    try {
      await accept({ data: { notificationId: proposal.id } });
      toast.success("Outfit updated for the new forecast");
      onResolved("accepted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the outfit");
    } finally { setBusy(null); }
  };

  const onKeep = async () => {
    setBusy("keep");
    try {
      await resolve({ data: { notificationId: proposal.id, status: "dismissed" } });
      onResolved("dismissed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't dismiss the suggestion");
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 rounded-full bg-secondary/60 flex items-center justify-center shrink-0">
          <CloudRain size={14} />
        </div>
        <div className="min-w-0">
          <p className="text-sm">{proposal.title}</p>
          {(d.old_temp != null || d.new_temp != null) && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {d.old_temp != null ? `${Math.round(d.old_temp)}°${d.old_condition ? ` · ${d.old_condition}` : ""}` : "—"}
              {" → "}
              {d.new_temp != null ? `${Math.round(d.new_temp)}°${d.new_condition ? ` · ${d.new_condition}` : ""}` : "—"}
            </p>
          )}
        </div>
      </div>

      {proposal.body && <p className="text-xs text-muted-foreground whitespace-pre-line">{proposal.body}</p>}

      {rainPct != null && rainPct > UMBRELLA_PRECIPITATION_THRESHOLD && (
        <p className="text-xs flex items-center gap-1.5">
          <Umbrella size={12} /> {Math.round(rainPct)}% chance of rain — don't forget your umbrella
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Row label="Planned" ids={d.old_item_ids ?? []} items={items} signed={signed} />
        <Row label="Suggested" ids={d.new_item_ids ?? []} items={items} signed={signed} />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={() => void onAccept()}
          disabled={busy !== null}
          className="flex-1 min-w-[100px] h-10 rounded-full bg-foreground text-background text-xs tracking-wide active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {busy === "accept" ? <Loader2 size={13} className="animate-spin" /> : null} Accept
        </button>
        <button
          onClick={() => void onKeep()}
          disabled={busy !== null}
          className="flex-1 min-w-[100px] h-10 rounded-full border border-border text-xs tracking-wide active:scale-95 disabled:opacity-50"
        >
          Keep original
        </button>
        {onCustomize && (
          <button
            onClick={onCustomize}
            disabled={busy !== null}
            className="flex-1 min-w-[100px] h-10 rounded-full border border-border text-xs tracking-wide active:scale-95 disabled:opacity-50"
          >
            Customize
          </button>
        )}
      </div>
    </div>
  );
}
