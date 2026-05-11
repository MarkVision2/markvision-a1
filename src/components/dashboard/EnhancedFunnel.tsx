import { ArrowRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportTotals } from "@/hooks/useReportData";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

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

  // conversions step→step
  const convs = steps.map((s, i) =>
    i === 0 || steps[i - 1].value === 0 ? null : (s.value / steps[i - 1].value) * 100,
  );

  // bottleneck = step with lowest non-null conv (must be > 0 prev)
  let worstIdx = -1;
  let worstVal = Infinity;
  convs.forEach((c, i) => {
    if (c !== null && c < worstVal && steps[i - 1].value > 10) {
      worstVal = c;
      worstIdx = i;
    }
  });

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-6">
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Путь клиента
          </span>
        </div>
        {worstIdx > 0 && (
          <span className="flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[10px] font-bold text-destructive">
            <AlertTriangle className="h-3 w-3" />
            Теряем больше всего: {steps[worstIdx - 1].label} → {steps[worstIdx].label}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-stretch gap-3">
        {steps.map((s, i) => {
          const conv = convs[i];
          const isWorst = i === worstIdx;
          return (
            <div key={s.id} className="flex items-stretch gap-3">
              {i > 0 && (
                <div className="flex flex-col items-center justify-center px-1 text-muted-foreground">
                  <ArrowRight className="h-4 w-4" />
                  {conv !== null && (
                    <span
                      className={cn(
                        "mt-1 text-[10px] font-bold",
                        isWorst ? "text-destructive" : "text-success",
                      )}
                    >
                      {conv.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
              <div
                className={cn(
                  "flex min-w-[110px] flex-col items-center justify-center rounded-xl border px-4 py-3 text-center",
                  isWorst
                    ? "border-destructive/50 bg-destructive/5"
                    : "border-border/60 bg-secondary/30",
                )}
              >
                <div className="text-2xl font-bold tabular-nums">{fmtNum(s.value)}</div>
                <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </div>
                {s.cost !== null && s.cost > 0 && (
                  <div className="mt-1.5 rounded-md bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {s.costLabel}: <span className="font-semibold text-foreground">{fmtTenge(s.cost)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
