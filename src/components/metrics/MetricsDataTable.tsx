import { DollarSign, HandCoins, Loader2, Target, Users, Wallet } from "lucide-react";
import { ManualFactCell } from "@/components/metrics/ManualFactCell";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import { formatNumber } from "@/components/metrics/metricsFormat";
import { cn } from "@/lib/utils";
import type { DailyInsightRow } from "@/hooks/useMetaInsights";

const Cell = ({ children, mono = true }: { children: React.ReactNode; mono?: boolean }) => (
  <td className={cn("px-3 py-3 text-right text-sm", mono && "tabular-nums")}>{children}</td>
);

const todayIso = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
})();

const isWeekend = (weekday: string) => weekday === "Сб" || weekday === "Вс";

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

/** Бизнес: Дата + 7 метрик. Детально: реклама/CRM/деньги без клиник-диагностик. */
const COL_COUNT_DETAILED = 12;
const COL_COUNT_BUSINESS = 8;

export function MetricsDataTable({
  mode,
  visibleDays,
  dailyMap,
  loading,
  loadingLabel,
  canEdit,
  rnpEditDisabled,
  onSaveSpend,
  onSaveLeads,
  onSaveCrmReceived,
  onSaveSales,
  onSaveSalesRevenue,
  onSaveCash,
  onSavePrepayCount,
  onSavePrepaySum,
}: Props) {
  const editDisabled = !canEdit;

  const num = (v: number | undefined) =>
    v && v > 0 ? formatNumber(v) : <MetricsDash />;

  const headerTh =
    "px-3 py-3 text-[11px] font-bold uppercase tracking-wide text-foreground";
  const stickyDateHeader = cn(headerTh, "sticky left-0 z-10 bg-muted/70 px-4 text-left");

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/30 shadow-sm">
      <table className={cn("w-full border-collapse text-sm", mode === "business" ? "min-w-[980px]" : "min-w-[1280px]")}>
        <thead className="sticky top-0 z-[2]">
          {mode === "business" ? (
            <tr className="border-b-2 border-border/80 bg-muted/70 shadow-sm">
              <th className={stickyDateHeader}>Дата</th>
              {["Затраты", "Лиды Meta", "Лиды CRM", "CPL CRM", "Вступлений", "Продажи", "Сумма"].map((h) => (
                <th key={h} className={cn(headerTh, "text-right")}>{h}</th>
              ))}
            </tr>
          ) : (
            <>
          <tr className="border-b border-border/50 bg-muted/60">
            <th rowSpan={2} className={stickyDateHeader}>
              Дата
            </th>
            <th colSpan={2} className="border-b border-border/40 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-foreground">
              Реклама
            </th>
            <th colSpan={3} className="border-b border-l border-border/40 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-foreground">
              CRM
            </th>
            <th colSpan={6} className="border-b border-l border-border/40 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-foreground">
              Деньги ₸
            </th>
          </tr>
          <tr className="border-b-2 border-border/80 bg-muted/70">
            {[
              { h: "Затраты", border: false },
              { h: "Лиды Meta", border: false },
              { h: "Лиды CRM", border: true },
              { h: "CPL CRM", border: false },
              { h: "Вступлений", border: false },
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
                  headerTh,
                  "text-right",
                  border && "border-l border-border/40",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
            </>
          )}
        </thead>
        <tbody>
          {visibleDays.length === 0 ? (
            <tr>
              <td colSpan={mode === "business" ? COL_COUNT_BUSINESS : COL_COUNT_DETAILED} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Нет дней с данными за выбранный период
              </td>
            </tr>
          ) : (
            visibleDays.map(({ day, iso, weekday }, rowIdx) => {
              const d = dailyMap.get(iso);
              const crmLeads = d?.crmReceived ?? 0;
              const cplCrm = d && crmLeads > 0 ? d.spend / crmLeads : 0;
              const joins = d?.joins ?? 0;
              const dayRevenue = d?.crmRevenue ?? 0;
              const weekend = isWeekend(weekday);
              const today = iso === todayIso;
              const hasData = !!d && (
                d.spend > 0 ||
                d.leads > 0 ||
                crmLeads > 0 ||
                joins > 0 ||
                d.sales > 0 ||
                dayRevenue > 0 ||
                d.cashRevenue > 0 ||
                (d.prepayCount ?? 0) > 0
              );

              return (
                <tr
                  key={iso}
                  className={cn(
                    "group border-b border-border/25 transition-colors hover:bg-accent/25",
                    rowIdx % 2 === 1 && !weekend && !today && "bg-muted/10",
                    weekend && "bg-muted/25",
                    today && "bg-primary/5 ring-1 ring-inset ring-primary/25",
                    hasData && !weekend && !today && "bg-card/20",
                    !hasData && "opacity-60",
                  )}
                >
                  <td className="sticky left-0 z-[1] bg-inherit px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-bold tabular-nums", today && "text-primary")}>
                        {String(day).padStart(2, "0")}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          weekend ? "text-warning" : "text-muted-foreground",
                          today && "text-primary",
                        )}
                      >
                        {weekday}
                      </span>
                      {today && (
                        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          сегодня
                        </span>
                      )}
                    </div>
                  </td>
                  {mode === "business" ? (
                    <>
                      <Cell>{num(d?.spend)}</Cell>
                      <Cell>{num(d?.leads)}</Cell>
                      <Cell>{num(crmLeads)}</Cell>
                      <Cell>{cplCrm > 0 ? formatNumber(cplCrm) : <MetricsDash />}</Cell>
                      <Cell>
                        <span className={cn(joins > 0 && "text-cyan-400")}>
                          {num(joins)}
                        </span>
                      </Cell>
                      <Cell>{num(d?.sales)}</Cell>
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
                  <Cell>
                    <ManualFactCell
                      title="Лиды CRM"
                      icon={Users}
                      isoDate={iso}
                      value={crmLeads}
                      crm={d?.autoCrmReceived ?? crmLeads}
                      manual={crmLeads}
                      manualRaw={d?.manualCrmReceivedRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled || rnpEditDisabled}
                      onSave={(next) => onSaveCrmReceived(iso, next)}
                    />
                  </Cell>
                  <Cell>{cplCrm > 0 ? formatNumber(cplCrm) : <MetricsDash />}</Cell>
                  <Cell>
                    <span className={cn(joins > 0 && "font-medium text-cyan-400")}>
                      {num(joins)}
                    </span>
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
