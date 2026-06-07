import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  label: string;
  /** Короткая подпись (CAC, ROMI) — не обрезается в узкой колонке. */
  badge?: string;
  value: React.ReactNode;
  hint?: string;
  delta?: number | null;
  comparing?: boolean;
  /** When true, positive delta is bad for costs/spend. */
  invertDelta?: boolean;
  emphasize?: boolean;
}

export function MoneyKpiCard({
  icon: Icon, label, badge, value, hint, delta, comparing, invertDelta, emphasize,
}: Props) {
  const hasDelta = delta !== null && delta !== undefined;
  const isUp = hasDelta && (delta as number) >= 0;
  const good = invertDelta ? !isUp : isUp;
  const noChange = hasDelta && Math.abs(delta as number) < 0.5;

  return (
    <div
      className={cn(
        "flex min-h-[108px] flex-col rounded-2xl border bg-card/60 p-3.5 transition-colors",
        emphasize ? "border-primary/40 shadow-glow" : "border-border/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary/60">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        {badge ? (
          <span className="shrink-0 rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] font-semibold leading-snug text-foreground/90">{label}</p>
      <div className="mt-1.5 text-lg font-bold tabular-nums leading-tight sm:text-xl">{value}</div>
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
