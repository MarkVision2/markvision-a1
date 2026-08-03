import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AspectId } from "@/data/contentTypeFlows";

const ASPECT_META: Record<
  AspectId,
  { label: string; sub: string; frame: string; frameH: string; frameW?: string }
> = {
  "1:1": { label: "1:1", sub: "Квадрат", frame: "1 / 1", frameH: "h-14" },
  "4:5": { label: "4:5", sub: "Портрет", frame: "4 / 5", frameH: "h-16" },
  "9:16": { label: "9:16", sub: "Stories / Reels", frame: "9 / 16", frameH: "h-[4.5rem]" },
  "16:9": { label: "16:9", sub: "YouTube / баннер", frame: "16 / 9", frameH: "h-10", frameW: "4.5rem" },
  "3:4": { label: "3:4", sub: "Портрет", frame: "3 / 4", frameH: "h-16" },
  "21:9": { label: "21:9", sub: "Ultrawide", frame: "21 / 9", frameH: "h-8", frameW: "5rem" },
};

interface Props {
  value: AspectId;
  onChange: (id: AspectId) => void;
  allowed: AspectId[];
}

export function AspectRatioPicker({ value, onChange, allowed }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {allowed.map((id) => {
        const a = ASPECT_META[id];
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={on}
            className={cn(
              "group relative flex min-h-[7.5rem] flex-col items-center justify-between gap-3 rounded-2xl border p-3.5 text-center transition-all duration-200",
              "active:scale-[0.98] touch-manipulation",
              on
                ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.35),0_12px_28px_-12px_hsl(var(--primary)/0.55)]"
                : "border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/70",
            )}
          >
            {on && (
              <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            )}

            <div
              className={cn(
                "flex w-full flex-1 items-center justify-center rounded-xl",
                on ? "bg-primary/5" : "bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "rounded-md border-2 transition-colors",
                  a.frameH,
                  on
                    ? "border-primary bg-gradient-to-br from-primary/30 to-primary/10 shadow-[inset_0_0_12px_hsl(var(--primary)/0.25)]"
                    : "border-muted-foreground/35 bg-muted/40 group-hover:border-primary/50",
                )}
                style={{ aspectRatio: a.frame, width: a.frameW }}
              />
            </div>

            <div className="w-full space-y-0.5">
              <p className={cn("text-base font-bold tabular-nums tracking-tight", on ? "text-primary" : "text-foreground")}>
                {a.label}
              </p>
              <p className="text-[11px] leading-tight text-muted-foreground">{a.sub}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
