import { cn } from "@/lib/utils";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import {
  formatNumber,
  formatPercent,
  formatTenge,
} from "@/components/metrics/metricsFormat";

interface Props {
  factRevenue: number;
  factSpend: number;
  factCrmReceived: number;
  factSales: number;
  factDiagnostics: number;
  factCpl: number;
  crLeadDiagnostics: number;
  crDiagnosticsSale: number;
  monthProgress: number;
  filledDays: number;
  daysInMonth: number;
}

function CompactStat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-bold tabular-nums tracking-tight sm:text-xl",
          highlight && "text-success",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function MetricsKpiPanel({
  factRevenue,
  factSpend,
  factCrmReceived,
  factSales,
  factDiagnostics,
  factCpl,
  crLeadDiagnostics,
  crDiagnosticsSale,
  monthProgress,
  filledDays,
  daysInMonth,
}: Props) {
  return (
    <div className="mt-4 rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Дни с данными:{" "}
          <strong className="text-foreground">{filledDays}</strong> / {daysInMonth}
        </span>
        <span>{monthProgress}% месяца заполнено</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CompactStat
          label="Расходы"
          value={factSpend > 0 ? formatTenge(factSpend) : <MetricsDash />}
        />
        <CompactStat
          label="Лиды CRM"
          value={factCrmReceived > 0 ? formatNumber(factCrmReceived) : <MetricsDash />}
        />
        <CompactStat
          label="CPL"
          value={factCpl > 0 ? formatTenge(factCpl) : <MetricsDash />}
        />
        <CompactStat
          label="Выручка"
          highlight
          value={factRevenue > 0 ? formatTenge(factRevenue) : <MetricsDash />}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Диагностики:{" "}
          <strong className="text-foreground">
            {factDiagnostics > 0 ? formatNumber(factDiagnostics) : "—"}
          </strong>
        </span>
        <span>
          Продажи:{" "}
          <strong className="text-foreground">
            {factSales > 0 ? formatNumber(factSales) : "—"}
          </strong>
        </span>
        {crLeadDiagnostics > 0 && (
          <span>Лид → визит: {formatPercent(crLeadDiagnostics)}</span>
        )}
        {crDiagnosticsSale > 0 && (
          <span>Визит → продажа: {formatPercent(crDiagnosticsSale)}</span>
        )}
      </div>
    </div>
  );
}
