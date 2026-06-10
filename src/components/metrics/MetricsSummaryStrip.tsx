import { BarChart3, Target, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import { formatNumber } from "@/components/metrics/metricsFormat";
import type { FinancePlan } from "@/hooks/useFinancePlan";

interface SummaryValues {
  spend: number;
  leads: number;
  cpl: number;
  diagnostics: number;
  diagnosticRevenue: number;
  sales: number;
  salesRevenue: number;
  revenue: number;
}

interface Props {
  plan: FinancePlan | null;
  fact: SummaryValues;
}

function pct(fact: number, planVal: number | undefined) {
  return planVal && planVal > 0 ? `${Math.round((fact / planVal) * 100)}%` : null;
}

function SummaryCard({
  title,
  icon: Icon,
  tone,
  rows,
}: {
  title: string;
  icon: React.ElementType;
  tone: "plan" | "fact" | "progress";
  rows: { label: string; value: React.ReactNode; highlight?: boolean }[];
}) {
  const styles = {
    plan: "border-success/25 bg-success/5 text-success",
    fact: "border-primary/25 bg-primary/5",
    progress: "border-warning/25 bg-warning/5 text-warning",
  }[tone];

  return (
    <div className={cn("rounded-2xl border p-4", styles)}>
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", styles)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm font-bold uppercase tracking-wider">{title}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        {rows.map(({ label, value, highlight }) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                "mt-0.5 font-bold tabular-nums",
                highlight && tone === "fact" && "text-success",
                highlight && tone === "progress" && "text-warning",
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function MetricsSummaryStrip({ plan, fact }: Props) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <SummaryCard
        title="План"
        icon={Target}
        tone="plan"
        rows={[
          { label: "Расходы", value: plan ? formatNumber(plan.spend) : <MetricsDash /> },
          { label: "Лиды", value: plan ? formatNumber(plan.leads) : <MetricsDash /> },
          { label: "Диагностики", value: plan ? formatNumber(plan.visits) : <MetricsDash /> },
          { label: "Продажи", value: plan ? formatNumber(plan.sales) : <MetricsDash /> },
          { label: "Выручка", value: plan ? formatNumber(plan.revenue) : <MetricsDash />, highlight: true },
        ]}
      />
      <SummaryCard
        title="Факт"
        icon={BarChart3}
        tone="fact"
        rows={[
          { label: "Расходы", value: fact.spend > 0 ? formatNumber(fact.spend) : <MetricsDash /> },
          { label: "Лиды", value: fact.leads > 0 ? formatNumber(fact.leads) : <MetricsDash /> },
          { label: "Диагностики", value: fact.diagnostics > 0 ? formatNumber(fact.diagnostics) : <MetricsDash /> },
          { label: "Продажи", value: fact.sales > 0 ? formatNumber(fact.sales) : <MetricsDash /> },
          { label: "Выручка", value: fact.revenue > 0 ? formatNumber(fact.revenue) : <MetricsDash />, highlight: true },
        ]}
      />
      <SummaryCard
        title="% выполнения"
        icon={TrendingUp}
        tone="progress"
        rows={[
          { label: "Расходы", value: pct(fact.spend, plan?.spend) ?? <MetricsDash /> },
          { label: "Лиды", value: pct(fact.leads, plan?.leads) ?? <MetricsDash /> },
          { label: "Диагностики", value: pct(fact.diagnostics, plan?.visits) ?? <MetricsDash /> },
          { label: "Продажи", value: pct(fact.sales, plan?.sales) ?? <MetricsDash /> },
          { label: "Выручка", value: pct(fact.revenue, plan?.revenue) ?? <MetricsDash />, highlight: true },
        ]}
      />
    </div>
  );
}
