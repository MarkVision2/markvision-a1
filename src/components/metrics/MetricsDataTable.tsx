import { DollarSign, HandCoins, Loader2, Target, Users, Wallet } from "lucide-react";
import { ManualFactCell } from "@/components/metrics/ManualFactCell";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import { formatNumber, formatPercent, formatTenge } from "@/components/metrics/metricsFormat";
import { cn } from "@/lib/utils";
import type { DailyInsightRow } from "@/hooks/useMetaInsights";
import type { FinancePlan } from "@/hooks/useFinancePlan";

const Cell = ({ children, mono = true }: { children: React.ReactNode; mono?: boolean }) => (
  <td className={cn("px-2 py-2.5 text-right text-xs", mono && "tabular-nums")}>{children}</td>
);

interface DayRow {
  day: number;
  iso: string;
  weekday: string;
}

interface Props {
  mode: "business" | "detailed";
  monthDays: DayRow[];
  visibleDays: DayRow[];
  dailyMap: Map<string, DailyInsightRow>;
  plan: FinancePlan | null;
  monthFact: {
    spend: number;
    leads: number;
    diagnosticsBooked: number;
    visits: number;
    diagnosticsRevenue: number;
    sales: number;
    salesRevenue: number;
    totalRevenue: number;
  };
  loading: boolean;
  loadingLabel: string;
  canEdit: boolean;
  rnpEditDisabled: boolean;
  onSaveSpend: (iso: string, next: number | null) => Promise<void>;
  onSaveLeads: (iso: string, next: number | null) => Promise<void>;
  onSaveCrmReceived: (iso: string, next: number | null) => Promise<void>;
  onSaveQualified: (iso: string, next: number | null) => Promise<void>;
  onSavePlannedVisits: (iso: string, next: number | null) => Promise<void>;
  onSaveConductedVisits: (iso: string, next: number | null) => Promise<void>;
  onSaveDiagnosticsPaid: (iso: string, next: number | null) => Promise<void>;
  onSaveDiagnosticRevenue: (iso: string, next: number | null) => Promise<void>;
  onSaveSales: (iso: string, next: number | null) => Promise<void>;
  onSaveSalesRevenue: (iso: string, next: number | null) => Promise<void>;
  onSaveCash: (iso: string, next: number | null) => Promise<void>;
  onSavePrepayCount: (iso: string, next: number | null) => Promise<void>;
  onSavePrepaySum: (iso: string, next: number | null) => Promise<void>;
}

const COL_COUNT_DETAILED = 16;
const businessColCount = (days: number) => 6 + days;

export function MetricsDataTable({
  mode,
  visibleDays,
  dailyMap,
  plan,
  monthFact,
  loading,
  loadingLabel,
  canEdit,
  rnpEditDisabled,
  onSaveSpend,
  onSaveLeads,
  onSaveCrmReceived,
  onSaveQualified,
  onSavePlannedVisits,
  onSaveConductedVisits,
  onSaveDiagnosticsPaid,
  onSaveDiagnosticRevenue,
  onSaveSales,
  onSaveSalesRevenue,
  onSaveCash,
  onSavePrepayCount,
  onSavePrepaySum,
}: Props) {
  const editDisabled = !canEdit;

  const num = (v: number | undefined) =>
    v && v > 0 ? formatNumber(v) : <MetricsDash />;

  const planPct = (fact: number, planVal?: number) =>
    planVal && planVal > 0 ? Math.round((fact / planVal) * 100) : null;

  const sectionCellClass =
    "sticky left-0 z-[1] bg-background px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-primary";
  const metricCellClass =
    "sticky left-[110px] z-[1] bg-background px-3 py-2 text-left text-xs font-medium text-foreground";
  const unitCellClass =
    "sticky left-[360px] z-[1] bg-background px-2 py-2 text-center text-[11px] text-muted-foreground";
  const summaryCellClass = "px-2 py-2 text-right text-xs font-semibold tabular-nums bg-muted/20";

  const businessRows = [
    {
      section: "Маркетинг",
      metric: "Бюджет на маркетинг",
      unit: "₸",
      plan: plan?.spend ?? 0,
      fact: monthFact.spend,
      value: (d: DailyInsightRow) => d.spend,
      formatter: formatTenge,
    },
    {
      section: "Маркетинг",
      metric: "Кол-во лидов (получено CRM)",
      unit: "шт",
      plan: plan?.leads ?? 0,
      fact: monthFact.leads,
      value: (d: DailyInsightRow) => d.crmReceived,
      formatter: formatNumber,
    },
    {
      section: "Маркетинг",
      metric: "Стоимость лида (CPL)",
      unit: "₸",
      plan: plan && plan.leads > 0 ? plan.spend / plan.leads : 0,
      fact: monthFact.leads > 0 ? monthFact.spend / monthFact.leads : 0,
      value: (d: DailyInsightRow) => (d.crmReceived > 0 ? d.spend / d.crmReceived : 0),
      formatter: formatTenge,
    },
    {
      section: "Диагностика",
      metric: "Запись на диагностику",
      unit: "шт",
      plan: plan?.visits ?? 0,
      fact: monthFact.diagnosticsBooked,
      value: (d: DailyInsightRow) => d.plannedVisits,
      formatter: formatNumber,
    },
    {
      section: "Диагностика",
      metric: "Конверсия в запись из заявки",
      unit: "%",
      plan: plan && plan.leads > 0 ? (plan.visits / plan.leads) * 100 : 0,
      fact: monthFact.leads > 0 ? (monthFact.diagnosticsBooked / monthFact.leads) * 100 : 0,
      value: (d: DailyInsightRow) => (d.crmReceived > 0 ? (d.plannedVisits / d.crmReceived) * 100 : 0),
      formatter: formatPercent,
    },
    {
      section: "Диагностика",
      metric: "Визит",
      unit: "шт",
      plan: plan?.visits ?? 0,
      fact: monthFact.visits,
      value: (d: DailyInsightRow) => d.conductedVisits,
      formatter: formatNumber,
    },
    {
      section: "Диагностика",
      metric: "Конверсия в визит из записи",
      unit: "%",
      plan: 100,
      fact: monthFact.diagnosticsBooked > 0 ? (monthFact.visits / monthFact.diagnosticsBooked) * 100 : 0,
      value: (d: DailyInsightRow) => (d.plannedVisits > 0 ? (d.conductedVisits / d.plannedVisits) * 100 : 0),
      formatter: formatPercent,
    },
    {
      section: "Диагностика",
      metric: "Выручка с диагностик",
      unit: "₸",
      plan: plan?.diagnosticRevenue ?? 0,
      fact: monthFact.diagnosticsRevenue,
      value: (d: DailyInsightRow) => d.diagnosticRevenue,
      formatter: formatTenge,
    },
    {
      section: "Операции",
      metric: "Кол-во продаж",
      unit: "шт",
      plan: plan?.sales ?? 0,
      fact: monthFact.sales,
      value: (d: DailyInsightRow) => d.sales,
      formatter: formatNumber,
    },
    {
      section: "Операции",
      metric: "Конверсия в продажу из визита",
      unit: "%",
      plan: plan && plan.visits > 0 ? (plan.sales / plan.visits) * 100 : 0,
      fact: monthFact.visits > 0 ? (monthFact.sales / monthFact.visits) * 100 : 0,
      value: (d: DailyInsightRow) => (d.conductedVisits > 0 ? (d.sales / d.conductedVisits) * 100 : 0),
      formatter: formatPercent,
    },
    {
      section: "Операции",
      metric: "Выручка от продаж",
      unit: "₸",
      plan: plan?.revenue ?? 0,
      fact: monthFact.salesRevenue,
      value: (d: DailyInsightRow) => d.salesRevenue,
      formatter: formatTenge,
    },
    {
      section: "Операции",
      metric: "Средний чек продажи",
      unit: "₸",
      plan: plan && plan.sales > 0 ? plan.revenue / plan.sales : 0,
      fact: monthFact.sales > 0 ? monthFact.salesRevenue / monthFact.sales : 0,
      value: (d: DailyInsightRow) => (d.sales > 0 ? d.salesRevenue / d.sales : 0),
      formatter: formatTenge,
    },
    {
      section: "Итого",
      metric: "Общая выручка",
      unit: "₸",
      plan: (plan?.revenue ?? 0) + (plan?.diagnosticRevenue ?? 0),
      fact: monthFact.totalRevenue,
      value: (d: DailyInsightRow) => d.crmRevenue,
      formatter: formatTenge,
    },
    {
      section: "Итого",
      metric: "CAC (стоимость клиента)",
      unit: "₸",
      plan: plan && plan.sales > 0 ? plan.spend / plan.sales : 0,
      fact: monthFact.sales > 0 ? monthFact.spend / monthFact.sales : 0,
      value: (d: DailyInsightRow) => (d.sales > 0 ? d.spend / d.sales : 0),
      formatter: formatTenge,
    },
    {
      section: "Итого",
      metric: "ДРР",
      unit: "%",
      plan:
        plan && (plan.revenue + plan.diagnosticRevenue) > 0
          ? (plan.spend / (plan.revenue + plan.diagnosticRevenue)) * 100
          : 0,
      fact: monthFact.totalRevenue > 0 ? (monthFact.spend / monthFact.totalRevenue) * 100 : 0,
      value: (d: DailyInsightRow) => (d.crmRevenue > 0 ? (d.spend / d.crmRevenue) * 100 : 0),
      formatter: formatPercent,
    },
  ] as const;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/30">
      <table className={cn("w-full border-collapse text-xs", mode === "business" ? "min-w-[980px]" : "min-w-[1400px]")}>
        <thead className="sticky top-0 z-[2]">
          {mode === "business" ? (
            <tr className="border-b border-border/60 bg-card/60">
              <th className="sticky left-0 z-10 bg-card/60 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Раздел</th>
              <th className="sticky left-[110px] z-10 bg-card/60 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Показатель</th>
              <th className="sticky left-[360px] z-10 bg-card/60 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ед.</th>
              <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">План</th>
              <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Факт</th>
              <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">%</th>
              {visibleDays.map(({ day, weekday }) => (
                <th key={`d-${day}-${weekday}`} className="min-w-[88px] px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {String(day).padStart(2, "0")}.{weekday}
                </th>
              ))}
            </tr>
          ) : (
            <>
          <tr className="border-b border-border/40 bg-muted/30">
            <th rowSpan={2} className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Дата
            </th>
            <th colSpan={3} className="border-b border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Реклама
            </th>
            <th colSpan={2} className="border-b border-l border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              CRM
            </th>
            <th colSpan={4} className="border-b border-l border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Диагностики
            </th>
            <th colSpan={6} className="border-b border-l border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Деньги ₸
            </th>
          </tr>
          <tr className="border-b border-border/60 bg-card/50">
            {[
              { h: "Затраты", border: false },
              { h: "Передано", border: false },
              { h: "CPL", border: false },
              { h: "Получено", border: true },
              { h: "Квал", border: false },
              { h: "Записано", border: true },
              { h: "Проведено", border: false },
              { h: "Оплачено", border: false },
              { h: "Сумма", border: false },
              { h: "Предоплат", border: true },
              { h: "Сумма предопл.", border: false },
              { h: "Продажи", border: false },
              { h: "Выручка", border: false },
              { h: "Касса", border: false },
              { h: "Итого", border: false },
            ].map(({ h, border }) => (
              <th
                key={h}
                className={cn(
                  "px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                  border && "border-l border-border/30",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
          <tr className="border-b border-border/40 bg-background/70">
            <th className="sticky left-0 z-10 bg-background/70 px-3 py-1 text-left text-[10px] font-medium text-muted-foreground">
              Источник
            </th>
            {[
              "Meta/CDI",
              "Meta/CDI",
              "расчёт",
              "CRM/rnp",
              "CRM/rnp",
              "CRM/rnp",
              "CRM/rnp",
              "CRM/rnp",
              "CRM/CDI",
              "rnp_daily",
              "rnp_daily",
              "CRM/CDI",
              "CRM/CDI",
              "CRM/rnp",
              "сумма",
            ].map((src, idx) => (
              <th
                key={`${src}-${idx}`}
                className="px-2 py-1 text-right text-[10px] font-medium text-muted-foreground"
              >
                {src}
              </th>
            ))}
          </tr>
            </>
          )}
        </thead>
        <tbody>
          {visibleDays.length === 0 ? (
            <tr>
              <td colSpan={mode === "business" ? businessColCount(visibleDays.length) : COL_COUNT_DETAILED} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Нет дней с данными за выбранный период
              </td>
            </tr>
          ) : mode === "business" ? (
            businessRows.map((row, idx) => {
              const pct = planPct(row.fact, row.plan);
              const sectionRepeat = idx > 0 && businessRows[idx - 1].section === row.section;
              return (
                <tr key={`${row.section}-${row.metric}`} className="border-b border-border/20 hover:bg-card/40">
                  <td className={sectionCellClass}>{sectionRepeat ? "" : row.section}</td>
                  <td className={metricCellClass}>{row.metric}</td>
                  <td className={unitCellClass}>{row.unit}</td>
                  <td className={summaryCellClass}>{row.plan > 0 ? row.formatter(row.plan) : <MetricsDash />}</td>
                  <td className={summaryCellClass}>{row.fact > 0 ? row.formatter(row.fact) : <MetricsDash />}</td>
                  <td className={summaryCellClass}>{pct !== null ? `${pct}%` : <MetricsDash />}</td>
                  {visibleDays.map(({ iso }) => {
                    const d = dailyMap.get(iso);
                    const v = d ? row.value(d) : 0;
                    return (
                      <td key={`${row.metric}-${iso}`} className="px-2 py-2 text-right text-xs tabular-nums">
                        {v > 0 ? row.formatter(v) : <MetricsDash />}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          ) : (
            visibleDays.map(({ day, iso, weekday }) => {
              const d = dailyMap.get(iso);
              const cpl = d && d.leads > 0 ? d.spend / d.leads : 0;
              const dayRevenue = d?.crmRevenue ?? 0;
              const hasData = !!d && (
                d.spend > 0 ||
                d.leads > 0 ||
                d.crmReceived > 0 ||
                d.plannedVisits > 0 ||
                d.conductedVisits > 0 ||
                d.diagnosticsPaid > 0 ||
                d.sales > 0 ||
                dayRevenue > 0 ||
                d.cashRevenue > 0
              );

              return (
                <tr
                  key={iso}
                  className={cn(
                    "group border-b border-border/20 transition-colors hover:bg-card/50",
                    hasData && "bg-card/20",
                    !hasData && "opacity-70",
                  )}
                >
                  <td className="sticky left-0 z-[1] bg-inherit px-3 py-2">
                    <span className="font-semibold tabular-nums">{String(day).padStart(2, "0")}</span>
                    <span className="ml-1.5 text-muted-foreground">{weekday}</span>
                  </td>
                  {mode === "business" ? (
                    <>
                      <Cell>{num(d?.spend)}</Cell>
                      <Cell>{num(d?.leads)}</Cell>
                      <Cell>{cpl > 0 ? formatNumber(cpl) : <MetricsDash />}</Cell>
                      <Cell>{num(d?.crmReceived)}</Cell>
                      <Cell>{num(d?.qualified)}</Cell>
                      <Cell>{num(d?.conductedVisits)}</Cell>
                      <Cell>{num(d?.sales)}</Cell>
                      <Cell>{num(d?.salesRevenue)}</Cell>
                      <Cell>
                        <span className={cn("font-semibold", dayRevenue > 0 && "text-success")}>
                          {dayRevenue > 0 ? formatNumber(dayRevenue) : <MetricsDash />}
                        </span>
                      </Cell>
                    </>
                  ) : (
                    <>
                  <Cell>
                    <ManualFactCell
                      title="Затраты на рекламу"
                      icon={Wallet}
                      isoDate={iso}
                      value={d?.spend ?? 0}
                      crm={d?.autoSpend ?? d?.spend ?? 0}
                      manual={d?.manualSpend ?? 0}
                      manualRaw={d?.manualSpendRaw ?? null}
                      autoLabel="Meta"
                      disabled={editDisabled}
                      format={formatNumber}
                      allowDecimal
                      onSave={(next) => onSaveSpend(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Лиды Meta"
                      icon={Target}
                      isoDate={iso}
                      value={d?.leads ?? 0}
                      crm={d?.autoLeads ?? d?.leads ?? 0}
                      manual={d?.manualLeads ?? 0}
                      manualRaw={d?.manualLeadsRaw ?? null}
                      autoLabel="Meta"
                      disabled={editDisabled}
                      onSave={(next) => onSaveLeads(iso, next)}
                    />
                  </Cell>
                  <Cell>{cpl > 0 ? formatNumber(cpl) : <MetricsDash />}</Cell>
                  <Cell>
                    <ManualFactCell
                      title="Получено в CRM"
                      icon={Users}
                      isoDate={iso}
                      value={d?.crmReceived ?? 0}
                      crm={d?.autoCrmReceived ?? d?.crmReceived ?? 0}
                      manual={d?.crmReceived ?? 0}
                      manualRaw={d?.manualCrmReceivedRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled || rnpEditDisabled}
                      onSave={(next) => onSaveCrmReceived(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Квалифицированные лиды"
                      icon={Users}
                      isoDate={iso}
                      value={d?.qualified ?? 0}
                      crm={d?.autoQualified ?? d?.qualified ?? 0}
                      manual={d?.qualified ?? 0}
                      manualRaw={d?.manualQualifiedRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled || rnpEditDisabled}
                      onSave={(next) => onSaveQualified(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Записано на визит"
                      icon={Users}
                      isoDate={iso}
                      value={d?.plannedVisits ?? 0}
                      crm={d?.autoPlannedVisits ?? d?.plannedVisits ?? 0}
                      manual={d?.plannedVisits ?? 0}
                      manualRaw={d?.manualPlannedVisitsRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled || rnpEditDisabled}
                      onSave={(next) => onSavePlannedVisits(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Проведено визитов"
                      icon={Users}
                      isoDate={iso}
                      value={d?.conductedVisits ?? 0}
                      crm={d?.autoConductedVisits ?? d?.conductedVisits ?? 0}
                      manual={d?.conductedVisits ?? 0}
                      manualRaw={d?.manualConductedVisitsRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled || rnpEditDisabled}
                      onSave={(next) => onSaveConductedVisits(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Оплачено диагностик"
                      icon={Users}
                      isoDate={iso}
                      value={d?.diagnosticsPaid ?? 0}
                      crm={d?.autoDiagnosticsPaid ?? d?.diagnosticsPaid ?? 0}
                      manual={d?.diagnosticsPaid ?? 0}
                      manualRaw={d?.manualDiagnosticsPaidRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled || rnpEditDisabled}
                      onSave={(next) => onSaveDiagnosticsPaid(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Сумма диагностик"
                      icon={DollarSign}
                      isoDate={iso}
                      value={d?.diagnosticRevenue ?? 0}
                      crm={d?.diagnosticRevenuePaid ?? d?.crmDiagnosticRevenue ?? 0}
                      manual={d?.manualDiagnosticRevenue ?? 0}
                      manualRaw={d?.manualDiagnosticRevenueRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled}
                      format={formatNumber}
                      allowDecimal
                      onSave={(next) => onSaveDiagnosticRevenue(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Предоплат получено"
                      icon={HandCoins}
                      isoDate={iso}
                      value={d?.prepayCount ?? 0}
                      crm={0}
                      manual={d?.prepayCount ?? 0}
                      manualRaw={(d?.prepayCount ?? 0) > 0 ? d!.prepayCount : null}
                      autoLabel="—"
                      disabled={editDisabled || rnpEditDisabled}
                      onSave={(next) => onSavePrepayCount(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Сумма предоплат"
                      icon={HandCoins}
                      isoDate={iso}
                      value={d?.prepaySum ?? 0}
                      crm={0}
                      manual={d?.prepaySum ?? 0}
                      manualRaw={(d?.prepaySum ?? 0) > 0 ? d!.prepaySum : null}
                      autoLabel="—"
                      disabled={editDisabled || rnpEditDisabled}
                      format={formatNumber}
                      allowDecimal
                      onSave={(next) => onSavePrepaySum(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Продажи"
                      icon={Wallet}
                      isoDate={iso}
                      value={d?.sales ?? 0}
                      crm={d?.crmSales ?? 0}
                      manual={d?.manualSales ?? 0}
                      manualRaw={d?.manualSalesRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled}
                      onSave={(next) => onSaveSales(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Выручка от продаж"
                      icon={DollarSign}
                      isoDate={iso}
                      value={d?.salesRevenue ?? 0}
                      crm={d?.crmSalesRevenueOnly ?? 0}
                      manual={d?.manualSalesRevenue ?? 0}
                      manualRaw={d?.manualSalesRevenueRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled}
                      format={formatNumber}
                      allowDecimal
                      onSave={(next) => onSaveSalesRevenue(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Касса (наличные)"
                      icon={DollarSign}
                      isoDate={iso}
                      value={d?.cashRevenue ?? 0}
                      crm={d?.autoCashRevenue ?? d?.cashRevenue ?? 0}
                      manual={d?.cashRevenue ?? 0}
                      manualRaw={d?.manualCashRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled || rnpEditDisabled}
                      format={formatNumber}
                      allowDecimal
                      onSave={(next) => onSaveCash(iso, next)}
                    />
                  </Cell>
                  <Cell>
                    <span className={cn("font-semibold", dayRevenue > 0 && "text-success")}>
                      {dayRevenue > 0 ? formatNumber(dayRevenue) : <MetricsDash />}
                    </span>
                  </Cell>
                    </>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {loading && (
        <div className="flex items-center justify-center gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {loadingLabel}
        </div>
      )}
    </div>
  );
}
