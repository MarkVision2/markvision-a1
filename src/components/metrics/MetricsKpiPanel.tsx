import { useState } from "react";
import { ChevronDown, Eye } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import { formatNumber, formatPercent, formatTenge } from "@/components/metrics/metricsFormat";
import type { FinancePlan } from "@/hooks/useFinancePlan";

interface Props {
  plan: FinancePlan | null;
  factRevenue: number;
  factSpend: number;
  factLeads: number;
  factSales: number;
  factDiagnostics: number;
  factCpl: number;
  factCpd: number;
  factCac: number;
  crLeadDiagnostics: number;
  crDiagnosticsSale: number;
  cdiRevenue: number;
  cdiSales: number;
  orphanRevenue: number;
  orphanSalesCount: number;
  cabinetId: string;
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
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  planPct: number | null;
  accent?: "default" | "success" | "warning";
}) {
  const tone = {
    default: "border-border/50 bg-card/50",
    success: "border-success/25 bg-success/5",
    warning: "border-warning/25 bg-warning/5",
  }[accent];

  return (
    <div className={cn("rounded-2xl border p-4", tone)}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      {planPct !== null && (
        <div className="mt-3 space-y-1">
          <Progress value={Math.min(planPct, 100)} className="h-1.5" />
          <div className="text-[11px] font-medium text-muted-foreground">{planPct}% от плана</div>
        </div>
      )}
    </div>
  );
}

function EfficiencyChip({
  label,
  badge,
  value,
}: {
  label: string;
  badge: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col rounded-xl border border-border/50 bg-background/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          {badge}
        </span>
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function MetricsKpiPanel({
  plan,
  factRevenue,
  factSpend,
  factLeads,
  factSales,
  factDiagnostics,
  factCpl,
  factCpd,
  factCac,
  crLeadDiagnostics,
  crDiagnosticsSale,
  cdiRevenue,
  cdiSales,
  orphanRevenue,
  orphanSalesCount,
  cabinetId,
  monthProgress,
  filledDays,
  daysInMonth,
}: Props) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Данные Meta за <strong className="text-foreground">{filledDays}</strong> из {daysInMonth} дней
        </span>
        <span className="font-medium text-success">{monthProgress}% месяца заполнено</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <HeroMetric
          label="Выручка"
          accent="success"
          value={factRevenue > 0 ? formatTenge(factRevenue) : <MetricsDash />}
          sub={factSales > 0 ? `${formatNumber(factSales)} оплат` : undefined}
          planPct={pct(factRevenue, plan?.revenue)}
        />
        <HeroMetric
          label="Расходы на рекламу"
          value={factSpend > 0 ? formatTenge(factSpend) : <MetricsDash />}
          sub={factLeads > 0 ? `${formatNumber(factLeads)} лидов` : undefined}
          planPct={pct(factSpend, plan?.spend)}
        />
        <HeroMetric
          label="Воронка"
          value={
            factDiagnostics > 0 || factSales > 0 ? (
              <span>
                {formatNumber(factDiagnostics)} диагн. · {formatNumber(factSales)} продаж
              </span>
            ) : (
              <MetricsDash />
            )
          }
          sub={plan ? `План: ${formatNumber(plan.visits)} / ${formatNumber(plan.sales)}` : undefined}
          planPct={pct(factSales, plan?.sales)}
          accent="warning"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <EfficiencyChip
          label="Стоимость заявки"
          badge="CPL"
          value={factCpl > 0 ? formatTenge(factCpl) : <MetricsDash />}
        />
        <EfficiencyChip
          label="Стоимость диагностики"
          badge="CPD"
          value={factCpd > 0 ? formatTenge(factCpd) : <MetricsDash />}
        />
        <EfficiencyChip
          label="Стоимость клиента"
          badge="CAC"
          value={factCac > 0 ? formatTenge(factCac) : <MetricsDash />}
        />
        <EfficiencyChip
          label="Лид → диагностика"
          badge="CR"
          value={crLeadDiagnostics > 0 ? formatPercent(crLeadDiagnostics) : <MetricsDash />}
        />
        <EfficiencyChip
          label="Диагностика → продажа"
          badge="CR"
          value={crDiagnosticsSale > 0 ? formatPercent(crDiagnosticsSale) : <MetricsDash />}
        />
      </div>

      <Collapsible open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-border/50 bg-card/40 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-card/70">
          <span>Откуда складывается выручка</span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", sourcesOpen && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-border/40 bg-background/40 p-3 text-sm">
            <div className="text-xs text-muted-foreground">Рекламные кабинеты</div>
            <div className="mt-1 font-bold tabular-nums">{formatTenge(cdiRevenue)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{cdiSales} оплат · Meta + CRM</div>
          </div>
          <div
            className={cn(
              "rounded-xl border p-3 text-sm",
              orphanRevenue > 0 ? "border-warning/30 bg-warning/5" : "border-border/40 bg-background/40",
            )}
          >
            <div className="text-xs text-muted-foreground">CRM без кабинета</div>
            <div className="mt-1 font-bold tabular-nums">{formatTenge(orphanRevenue)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {orphanSalesCount} оплат
              {orphanRevenue > 0 && cabinetId === "all" && (
                <span className="mt-1 block text-warning">Привяжи лида к кабинету в CRM</span>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-success/25 bg-success/5 p-3 text-sm">
            <div className="text-xs text-success">Итого (как в Dashboard)</div>
            <div className="mt-1 font-bold tabular-nums text-success">{formatTenge(factRevenue)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">CDI + CRM без кабинета</div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Eye className="h-3.5 w-3.5 shrink-0" />
        <span>
          <strong className="text-foreground">Реклама</strong> — Meta ·{" "}
          <strong className="text-foreground">Воронка</strong> — CRM ·{" "}
          <strong className="text-foreground">Выручка</strong> — оплаты из CRM (можно править по дням)
        </span>
      </div>
    </div>
  );
}
