import { cn } from "@/lib/utils";
import { useMetricLabels } from "@/hooks/useMetricLabels";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import {
  formatNumber,
  formatPercent,
  formatTenge,
} from "@/components/metrics/metricsFormat";

interface Props {
  factRevenue: number;
  factSpend: number;
  factMetaLeads: number;
  factCrmReceived: number;
  factJoins: number;
  factPlannedVisits: number;
  factConductedVisits: number;
  factDiagnosticsPaid: number;
  factSales: number;
  factCpl: number;
  crLeadJoin: number;
  crJoinSale: number;
  crLeadDiagnostic: number;
  crDiagnosticSale: number;
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
  factMetaLeads,
  factCrmReceived,
  factJoins,
  factPlannedVisits,
  factConductedVisits,
  factDiagnosticsPaid,
  factSales,
  factCpl,
  crLeadJoin,
  crJoinSale,
  crLeadDiagnostic,
  crDiagnosticSale,
  monthProgress,
  filledDays,
  daysInMonth,
}: Props) {
  const { labelFor } = useMetricLabels();
  const joinedLabel = labelFor("joined");
  const plannedLabel = labelFor("planned_visits");
  const conductedLabel = labelFor("conducted_visits");
  const diagnosticsPaidLabel = labelFor("diagnostics_paid");
  return (
    <div className="mt-4 rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Дни с данными:{" "}
          <strong className="text-foreground">{filledDays}</strong> / {daysInMonth}
        </span>
        <span>{monthProgress}% месяца заполнено</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <CompactStat
          label="Расходы"
          value={factSpend > 0 ? formatTenge(factSpend) : <MetricsDash />}
        />
        <CompactStat
          label="Лиды Meta"
          value={factMetaLeads > 0 ? formatNumber(factMetaLeads) : <MetricsDash />}
        />
        <CompactStat
          label="Лиды CRM"
          value={factCrmReceived > 0 ? formatNumber(factCrmReceived) : <MetricsDash />}
        />
        <CompactStat
          label="CPL CRM"
          value={factCpl > 0 ? formatTenge(factCpl) : <MetricsDash />}
        />
        <CompactStat
          label={joinedLabel}
          value={factJoins > 0 ? formatNumber(factJoins) : <MetricsDash />}
        />
        <CompactStat
          label={plannedLabel}
          value={factPlannedVisits > 0 ? formatNumber(factPlannedVisits) : <MetricsDash />}
        />
        <CompactStat
          label={conductedLabel}
          value={factConductedVisits > 0 ? formatNumber(factConductedVisits) : <MetricsDash />}
        />
        <CompactStat
          label="Выручка"
          highlight
          value={factRevenue > 0 ? formatTenge(factRevenue) : <MetricsDash />}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Продажи:{" "}
          <strong className="text-foreground">
            {factSales > 0 ? formatNumber(factSales) : "—"}
          </strong>
        </span>
        {crLeadJoin > 0 && (
          <span>CRM → {joinedLabel.toLowerCase()}: {formatPercent(crLeadJoin)}</span>
        )}
        {crJoinSale > 0 && (
          <span>{joinedLabel} → продажа: {formatPercent(crJoinSale)}</span>
        )}
        {crLeadDiagnostic > 0 && (
          <span>CRM → {conductedLabel.toLowerCase()}: {formatPercent(crLeadDiagnostic)}</span>
        )}
        {crDiagnosticSale > 0 && (
          <span>{conductedLabel} → продажа: {formatPercent(crDiagnosticSale)}</span>
        )}
        {factDiagnosticsPaid > 0 && (
          <span>{diagnosticsPaidLabel}: {formatNumber(factDiagnosticsPaid)}</span>
        )}
      </div>
    </div>
  );
}
