import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportTotals } from "@/hooks/useReportData";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;

interface Props {
  totals: ReportTotals;
}

export function EnhancedFunnel({ totals }: Props) {
  const steps = [
    { id: "imp", label: "Показы", value: totals.impressions, cost: null as number | null, costLabel: "" },
    { id: "clk", label: "Клики", value: totals.clicks, cost: totals.clicks > 0 ? totals.spend / totals.clicks : 0, costLabel: "Цена клика" },
    { id: "led", label: "Заявки", value: totals.totalLeads, cost: totals.cpl, costLabel: "Цена заявки" },
    { id: "vis", label: "Диагностики", value: totals.visits, cost: totals.cpv, costLabel: "Цена диагностики" },
    { id: "sal", label: "Оплаты", value: totals.sales, cost: totals.cac, costLabel: "Цена клиента" },
  ];

  const max = Math.max(...steps.map((s) => s.value), 1);
  const convs = steps.map((s, i) =>
    i === 0 || steps[i - 1].value === 0 ? null : (s.value / steps[i - 1].value) * 100,
  );

  let worstIdx = -1;
  let worstVal = Infinity;
  convs.forEach((c, i) => {
    if (c !== null && c < worstVal && steps[i - 1].value > 10) {
      worstVal = c;
      worstIdx = i;
    }
  });

  const accents = [
    "from-primary/80 to-primary/40",
    "from-primary/70 to-primary/30",
    "from-warning/70 to-warning/30",
    "from-success/60 to-success/25",
    "from-success/80 to-success/40",
  ];

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Путь клиента
          </span>
        </div>
        {worstIdx > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[10px] font-bold text-destructive">
            <AlertTriangle className="h-3 w-3" />
            Теряем больше всего: {steps[worstIdx - 1].label} → {steps[worstIdx].label}
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {steps.map((s, i) => {
          const conv = convs[i];
          const isWorst = i === worstIdx;
          const widthPct = (s.value / max) * 100;
          return (
            <div
              key={s.id}
              className={cn(
                "group relative grid grid-cols-[110px_1fr_140px] items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                isWorst
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-border/50 bg-secondary/20 hover:border-border/80",
              )}
            >
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </span>
                {conv !== null && (
                  <span
                    className={cn(
                      "mt-0.5 text-[11px] font-bold tabular-nums",
                      isWorst ? "text-destructive" : "text-success",
                    )}
                  >
                    {conv.toFixed(1)}%
                  </span>
                )}
              </div>

              <div className="relative h-9 overflow-hidden rounded-lg border border-border/40 bg-background/40">
                <div
                  className={cn(
                    "h-full bg-gradient-to-r transition-all duration-500",
                    accents[i],
                  )}
                  style={{ width: `${Math.max(widthPct, s.value > 0 ? 2 : 0)}%` }}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-bold tabular-nums">
                  {fmtNum(s.value)}
                </span>
              </div>

              <div className="text-right">
                {s.cost !== null && s.cost > 0 ? (
                  <div className="inline-flex flex-col items-end">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {s.costLabel}
                    </span>
                    <span className="text-sm font-bold tabular-nums">{fmtTenge(s.cost)}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/60">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
