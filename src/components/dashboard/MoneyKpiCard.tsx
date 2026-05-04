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
  /** When true, positive delta is bad (CPL/CAC/Spend). */
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
        "rounded-2xl border bg-card/60 p-5 transition-colors",
        emphasize ? "border-primary/40 shadow-glow" : "border-border/60",
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-secondary/60">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="mt-4 text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-2 flex items-center gap-2 text-[11px]">
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