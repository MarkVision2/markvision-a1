import { Users, Repeat, BarChart3, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportTotals } from "@/hooks/useReportData";

const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;

interface Props {
  totals: ReportTotals;
}

export function UnitEconomicsCard({ totals }: Props) {
  // LTV пока = AOV (нет данных о повторных покупках)
  const ltv = totals.aov;
  const ltvCac = totals.cac > 0 ? ltv / totals.cac : 0;

  const items = [
    { icon: Users, label: "CAC", value: totals.cac > 0 ? fmtTenge(totals.cac) : "—" },
    { icon: Repeat, label: "LTV", value: ltv > 0 ? fmtTenge(ltv) : "—", hint: "пока = средний чек" },
    {
      icon: BarChart3,
      label: "LTV / CAC",
      value: ltvCac > 0 ? `${ltvCac.toFixed(1)}x` : "—",
      good: ltvCac >= 3,
      bad: ltvCac > 0 && ltvCac < 1,
    },
    {
      icon: TrendingUp,
      label: "ROMI",
      value: totals.spend > 0 ? `${totals.romi >= 0 ? "+" : ""}${Math.round(totals.romi)}%` : "—",
      good: totals.romi > 0,
      bad: totals.romi < 0,
    },
  ];

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-primary" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Юнит-экономика
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="rounded-xl border border-border/40 bg-secondary/20 p-4">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">{it.label}</span>
              </div>
              <div
                className={cn(
                  "mt-2 text-2xl font-bold tabular-nums",
                  it.good && "text-success",
                  it.bad && "text-destructive",
                )}
              >
                {it.value}
              </div>
              {it.hint && <div className="mt-1 text-[10px] text-muted-foreground">{it.hint}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}