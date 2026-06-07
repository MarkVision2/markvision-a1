import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  label: string;
  /** Подсказка: как считается метрика (например «расход ÷ диагностики»). */
  hint?: string;
  value: string;
  delta?: number | null;
  emphasized?: boolean;
  comparing?: boolean;
  /** When true, a positive delta is bad (e.g. CPL grew). */
  invertDelta?: boolean;
}

export function KpiCard({ icon: Icon, label, hint, value, delta, emphasized, comparing, invertDelta }: Props) {
  const isPositive = delta !== null && delta !== undefined ? delta >= 0 : true;
  const good = invertDelta ? !isPositive : isPositive;
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/50 p-4 transition-colors",
        emphasized && "border-success/40 bg-success/5",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            {label}
          </span>
        </div>
        {emphasized && (
          <span className="rounded-md bg-success/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-success">
            KEY
          </span>
        )}
      </div>
      {hint && (
        <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>
      )}
      <div className="mt-2 text-2xl font-bold tabular-nums text-foreground">
        {value}
      </div>
      {comparing && (
        <div className="mt-2 flex items-center gap-1 text-[11px]">
          {delta === null || delta === undefined ? (
            <span className="text-muted-foreground">vs пред.</span>
          ) : (
            <>
              {good ? (
                <TrendingUp className="h-3 w-3 text-success" />
              ) : (
                <TrendingDown className="h-3 w-3 text-destructive" />
              )}
              <span className={cn("font-bold", good ? "text-success" : "text-destructive")}>
                {delta >= 0 ? "+" : ""}
                {Math.round(delta)}%
              </span>
              <span className="text-muted-foreground">vs пред.</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}