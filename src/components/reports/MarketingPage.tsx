import {
  DollarSign, Eye, Flame, MapPin, MousePointerClick,
  ShoppingCart, Target, Users,
} from "lucide-react";
import type { ReportData } from "@/hooks/useReportData";
import { deltaPct } from "@/hooks/useReportData";
import { KpiCard } from "./KpiCard";
import { SectionTitle } from "./SectionTitle";
import { ReportPageWrapper } from "./ReportPageWrapper";
import { cn } from "@/lib/utils";

const fmtTenge = (n: number) => {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K $`;
  return `${Math.round(n).toLocaleString("ru-RU")} $`;
};
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

interface Props {
  data: ReportData;
  rangeLabel: string;
  comparing: boolean;
}

export function MarketingPage({ data, rangeLabel, comparing }: Props) {
  const { totals, prev } = data;
  const funnel = [
    { label: "Показы", value: totals.impressions, prev: undefined as number | undefined },
    { label: "Клики", value: totals.clicks, prev: totals.impressions },
    { label: "Лиды", value: totals.totalLeads, prev: totals.clicks },
    { label: "Диагностики", value: totals.visits, prev: totals.totalLeads },
    { label: "Продажи", value: totals.sales, prev: totals.visits },
  ];
  const max = Math.max(...funnel.map((f) => f.value), 1);

  return (
    <ReportPageWrapper
      title="Маркетинговый отчёт"
      rangeLabel={rangeLabel}
      pageNumber={1}
      pageTotal={3}
      rightLabel="Маркетинг · Воронка"
    >
      <SectionTitle>Ключевые показатели</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={DollarSign} label="Расходы" value={fmtTenge(totals.spend)} delta={deltaPct(totals.spend, prev?.spend)} comparing={comparing} invertDelta />
        <KpiCard icon={Users} label="Лиды" value={fmtNum(totals.totalLeads)} delta={deltaPct(totals.totalLeads, prev?.totalLeads)} comparing={comparing} />
        <KpiCard icon={Target} label="CPL" value={fmtTenge(totals.cpl)} delta={deltaPct(totals.cpl, prev?.cpl)} comparing={comparing} invertDelta />
        <KpiCard icon={Eye} label="Диагностики" value={fmtNum(totals.visits)} delta={deltaPct(totals.visits, prev?.visits)} comparing={comparing} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard icon={MapPin} label="CPD" value={fmtTenge(totals.cpv)} delta={deltaPct(totals.cpv, prev?.cpv)} comparing={comparing} invertDelta />
        <KpiCard icon={ShoppingCart} label="Продажи" value={fmtNum(totals.sales)} delta={deltaPct(totals.sales, prev?.sales)} comparing={comparing} />
        <KpiCard icon={Flame} label="CAC" value={fmtTenge(totals.cac)} delta={deltaPct(totals.cac, prev?.cac)} comparing={comparing} emphasized invertDelta />
      </div>

      <div className="mt-8">
        <SectionTitle>Воронка конверсии</SectionTitle>
        <div className="space-y-4">
          {funnel.map((step, i) => {
            const conv = step.prev !== undefined && step.prev > 0
              ? (step.value / step.prev) * 100 : null;
            const loss = conv !== null ? -(100 - conv) : null;
            const widthPct = (step.value / max) * 100;
            return (
              <div key={step.label}>
                <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                  <span className="text-xs text-muted-foreground">{step.label}</span>
                  <div className="relative h-12 overflow-hidden rounded-xl border border-border/40 bg-secondary/20">
                    <div
                      className={cn(
                        "h-full bg-gradient-to-r",
                        i === 0 && "from-success/40 to-success/20",
                        i === 1 && "from-success/35 to-success/15",
                        i === 2 && "from-success/30 to-success/10",
                        i === 3 && "from-primary/35 to-primary/15",
                        i === 4 && "from-warning/35 to-warning/15",
                      )}
                      style={{ width: `${Math.max(widthPct, step.value > 0 ? 4 : 0)}%` }}
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold tabular-nums">
                      {fmtNum(step.value)}
                    </span>
                  </div>
                </div>
                {conv !== null && (
                  <div className="ml-[116px] mt-2 flex items-center gap-3 text-[11px]">
                    <span className="text-success">↓ {fmtPct(conv)} конверсия</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-destructive">{loss?.toFixed(1)}% потери</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </ReportPageWrapper>
  );
}

export const reportFmt = { fmtTenge, fmtNum, fmtPct };