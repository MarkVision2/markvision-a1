import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: string;
  delta?: number | null;
  comparing?: boolean;
  /** When true, positive delta is bad for costs/spend. */
  invertDelta?: boolean;
  emphasize?: boolean;
}

export function MoneyKpiCard({
  icon: Icon, label, value, hint, delta, comparing, invertDelta, emphasize,
}: Props) {
  const hasDelta = delta !== null && delta !== undefined;
  const isUp = hasDelta && (delta as number) >= 0;
  const good = invertDelta ? !isUp : isUp;
  const noChange = hasDelta && Math.abs(delta as number) < 0.5;

  return (
    <div
      className={cn(
        "flex min-h-[118px] flex-col rounded-xl border bg-card/60 p-4 transition-colors",
        emphasize ? "border-primary/40 shadow-glow" : "border-border/60",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5 text-muted-foreground">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary/60">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span
          className="min-w-0 flex-1 overflow-hidden text-[10px] font-bold uppercase leading-3 tracking-[0.08em] text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
          title={label}
        >
          {label}
        </span>
      </div>
      <div className="mt-4 min-w-0 break-words text-[23px] font-bold tabular-nums leading-none tracking-normal">
        {value}
      </div>
      <div className="mt-auto flex min-h-4 items-center gap-2 pt-3 text-[10px]">
        {comparing && hasDelta ? (
          noChange ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Minus className="h-3 w-3" /> без изменений
            </span>
          ) : (
            <span
              className={cn(
                "flex items-center gap-1 font-bold",
                good ? "text-success" : "text-destructive",
              )}
            >
              {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {(delta as number) >= 0 ? "+" : ""}
              {Math.round(delta as number)}%
            </span>
          )
        ) : null}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
