import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import {
  countLabel,
  formatNumber,
  formatPercent,
  formatTenge,
  pluralRu,
} from "@/components/metrics/metricsFormat";
import type { FinancePlan } from "@/hooks/useFinancePlan";

interface Props {
  plan: FinancePlan | null;
  factRevenue: number;
  factSpend: number;
  factCrmReceived: number;
  factSales: number;
  factDiagnostics: number;
  factCpl: number;
  factCpd: number;
  factCac: number;
  crLeadDiagnostics: number;
  crDiagnosticsSale: number;
  monthProgress: number;
  filledDays: number;
  daysInMonth: number;
}

function pct(fact: number, planVal: number | undefined) {
  return planVal && planVal > 0 ? Math.round((fact / planVal) * 100) : null;
}

function HeroMetric({
  label,
  value,
  sub,
  planPct,
  accent = "default",
  children,
}: {
  label: string;
  value?: React.ReactNode;
  sub?: string;
  planPct: number | null;
  accent?: "default" | "success" | "warning";
  children?: React.ReactNode;
}) {
  const tone = {
    default: "border-border/50 bg-card/50",
    success: "border-success/25 bg-success/5",
    warning: "border-warning/25 bg-warning/5",
  }[accent];

  return (
    <div className={cn("flex min-h-[148px] flex-col rounded-2xl border p-4", tone)}>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      {value !== undefined && (
        <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">{value}</div>
      )}
      {children}
      {sub && <div className="mt-2 text-sm text-muted-foreground">{sub}</div>}
      {planPct !== null && (
        <div className="mt-auto space-y-1 pt-3">
          <Progress value={Math.min(planPct, 100)} className="h-1.5" />
          <div className="text-xs text-muted-foreground">{planPct}% от плана на месяц</div>
        </div>
      )}
    </div>
  );
}

function FunnelStatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/30 py-2 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-bold tabular-nums">{value > 0 ? formatNumber(value) : "—"}</span>
    </div>
  );
}

function EfficiencyChip({
  label,
  hint,
  value,
}: {
  label: string;
  hint?: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col rounded-xl border border-border/50 bg-background/50 px-3 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {hint && <span className="mt-0.5 text-[10px] leading-snug text-muted-foreground/80">{hint}</span>}
      <div className="mt-1.5 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function MetricsKpiPanel({
  plan,
  factRevenue,
  factSpend,
  factCrmReceived,
  factSales,
  factDiagnostics,
  factCpl,
  factCpd,
  factCac,
  crLeadDiagnostics,
  crDiagnosticsSale,
  monthProgress,
  filledDays,
  daysInMonth,
}: Props) {
  const planDiagnosticsLabel = plan
    ? `${formatNumber(plan.visits)} ${pluralRu(plan.visits, "диагностика", "диагностики", "диагностик")}`
    : null;
  const planSalesLabel = plan
    ? `${formatNumber(plan.sales)} ${pluralRu(plan.sales, "продажа", "продажи", "продаж")}`
    : null;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          Дни с фактами Meta/CDI: <strong className="text-foreground">{filledDays}</strong> из {daysInMonth}
        </span>
        <span className="font-medium text-success">{monthProgress}% месяца заполнено</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <HeroMetric
          label="Выручка"
          accent="success"
          value={factRevenue > 0 ? formatTenge(factRevenue) : <MetricsDash />}
          sub={
            factSales > 0
              ? countLabel(factSales, "оплата", "оплаты", "оплат")
              : undefined
          }
          planPct={pct(factRevenue, plan?.revenue)}
        />
        <HeroMetric
          label="Расходы на рекламу"
          value={factSpend > 0 ? formatTenge(factSpend) : <MetricsDash />}
          sub={
            factCrmReceived > 0
              ? countLabel(factCrmReceived, "лид в CRM", "лида в CRM", "лидов в CRM")
              : undefined
          }
          planPct={pct(factSpend, plan?.spend)}
        />
        <HeroMetric
          label="Воронка продаж"
          planPct={pct(factSales, plan?.sales)}
          accent="warning"
        >
          <div className="mt-3">
            <FunnelStatRow label="Диагностики" value={factDiagnostics} />
            <FunnelStatRow label="Продажи" value={factSales} />
          </div>
          {plan && planDiagnosticsLabel && planSalesLabel && (
            <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
              План на месяц: {planDiagnosticsLabel}, {planSalesLabel}
            </div>
          )}
        </HeroMetric>
      </div>

      <div className="flex flex-wrap gap-2">
        <EfficiencyChip
          label="Стоимость заявки"
          hint="расходы ÷ лиды"
          value={factCpl > 0 ? formatTenge(factCpl) : <MetricsDash />}
        />
        <EfficiencyChip
          label="Стоимость диагностики"
          hint="расходы ÷ диагностики"
          value={factCpd > 0 ? formatTenge(factCpd) : <MetricsDash />}
        />
        <EfficiencyChip
          label="Стоимость клиента"
          hint="расходы ÷ продажи"
          value={factCac > 0 ? formatTenge(factCac) : <MetricsDash />}
        />
        <EfficiencyChip
          label="Лид → диагностика"
          hint="конверсия"
          value={crLeadDiagnostics > 0 ? formatPercent(crLeadDiagnostics) : <MetricsDash />}
        />
        <EfficiencyChip
          label="Диагностика → продажа"
          hint="конверсия"
          value={crDiagnosticsSale > 0 ? formatPercent(crDiagnosticsSale) : <MetricsDash />}
        />
      </div>
    </div>
  );
}
