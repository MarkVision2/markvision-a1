import { HandCoins, Loader2 } from "lucide-react";
import { ManualFactCell } from "@/components/metrics/ManualFactCell";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import { formatNumber, formatTenge } from "@/components/metrics/metricsFormat";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface MetricsTableDay {
  iso: string;
  day: number;
  weekday: string;
  hasCdi: boolean;
  spend: number;
  metaLeads: number;
  crmReceived: number;
  scheduled: number;
  conducted: number;
  diagnosticsPaid: number;
  diagnosticRevenuePaid: number;
  sales: number;
  salesRevenue: number;
  cashRevenue: number;
  prepaySum: number;
}

export interface MetricsTableTotals {
  spend: number;
  metaLeads: number;
  crmReceived: number;
  scheduled: number;
  conducted: number;
  diagnosticsPaid: number;
  diagnosticRevenuePaid: number;
  sales: number;
  salesRevenue: number;
  cashRevenue: number;
  prepaySum: number;
  hasAnyCdi: boolean;
}

interface Props {
  visibleDays: MetricsTableDay[];
  totals: MetricsTableTotals;
  loading: boolean;
  loadingLabel: string;
  rnpEditDisabled: boolean;
  onSavePrepaySum: (iso: string, next: number | null) => Promise<void>;
}

const COL_COUNT = 13;

const GROUP_STYLES = {
  ads: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  crm: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  diag: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  money: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
} as const;

const Cell = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <td className={cn("px-2 py-2 text-right text-xs tabular-nums", className)}>{children}</td>
);

function CountValue({ value }: { value: number }) {
  return <span className="text-foreground">{formatNumber(value)}</span>;
}

function CdiCount({ hasCdi, value }: { hasCdi: boolean; value: number }) {
  if (!hasCdi) return <MetricsDash />;
  return <CountValue value={value} />;
}

function CdiMoney({ hasCdi, value }: { hasCdi: boolean; value: number }) {
  if (!hasCdi) return <MetricsDash />;
  return <span>{formatTenge(value)}</span>;
}

function DisabledSoon() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground/60">—</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        Квал-лиды появятся после подключения скоринга бота
      </TooltipContent>
    </Tooltip>
  );
}

function PaidDiagnosticsCell({ count, sum }: { count: number; sum: number }) {
  if (count === 0 && sum === 0) return <CountValue value={0} />;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <CountValue value={count} />
      {sum > 0 && <span className="text-[10px] text-muted-foreground">{formatTenge(sum)}</span>}
    </span>
  );
}

export function MetricsDataTable({
  visibleDays,
  totals,
  loading,
  loadingLabel,
  rnpEditDisabled,
  onSavePrepaySum,
}: Props) {
  const totalCpl = totals.hasAnyCdi && totals.metaLeads > 0 ? totals.spend / totals.metaLeads : null;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/30">
      <table className="w-full min-w-[1100px] border-collapse text-xs">
        <thead>
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 z-20 border-b border-border/40 bg-muted/50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Дата
            </th>
            <th
              colSpan={3}
              className={cn("border-b border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider", GROUP_STYLES.ads)}
            >
              Реклама
            </th>
            <th
              colSpan={2}
              className={cn("border-b border-l border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider", GROUP_STYLES.crm)}
            >
              CRM
            </th>
            <th
              colSpan={3}
              className={cn("border-b border-l border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider", GROUP_STYLES.diag)}
            >
              Диагностика
            </th>
            <th
              colSpan={4}
              className={cn("border-b border-l border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider", GROUP_STYLES.money)}
            >
              Деньги
            </th>
          </tr>
          <tr className="border-b border-border/60 bg-card/50">
            {[
              { h: "Затраты", border: false },
              { h: "Передано", border: false },
              { h: "CPL", border: false },
              { h: "Получено", border: true },
              { h: "Квал", border: false, disabled: true },
              { h: "Записано", border: true },
              { h: "Проведено", border: false },
              { h: "Оплачено", border: false },
              { h: "Продажи", border: true },
              { h: "Выручка", border: false },
              { h: "Касса", border: false },
              { h: "Предоплаты", border: false },
            ].map(({ h, border, disabled }) => (
              <th
                key={h}
                className={cn(
                  "px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                  border && "border-l border-border/30",
                  disabled && "bg-muted/40",
                )}
              >
                {disabled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-muted-foreground/70">{h}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      Скоро — после подключения скоринга бота
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  h
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleDays.length === 0 ? (
            <tr>
              <td colSpan={COL_COUNT} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Нет дней с данными за выбранный период
              </td>
            </tr>
          ) : (
            visibleDays.map((d) => {
              const cpl = d.hasCdi && d.metaLeads > 0 ? d.spend / d.metaLeads : null;
              const hasRowData =
                d.hasCdi ||
                d.crmReceived > 0 ||
                d.scheduled > 0 ||
                d.conducted > 0 ||
                d.diagnosticsPaid > 0 ||
                d.sales > 0 ||
                d.salesRevenue > 0 ||
                d.cashRevenue > 0 ||
                d.prepaySum > 0;

              return (
                <tr
                  key={d.iso}
                  className={cn(
                    "group border-b border-border/20 transition-colors hover:bg-card/60",
                    hasRowData && "bg-card/15",
                  )}
                >
                  <td className="sticky left-0 z-[1] bg-inherit px-3 py-2 shadow-[2px_0_6px_-4px_rgba(0,0,0,0.15)]">
                    <span className="font-semibold tabular-nums">{String(d.day).padStart(2, "0")}</span>
                    <span className="ml-1.5 text-muted-foreground">{d.weekday}</span>
                  </td>
                  <Cell><CdiMoney hasCdi={d.hasCdi} value={d.spend} /></Cell>
                  <Cell><CdiCount hasCdi={d.hasCdi} value={d.metaLeads} /></Cell>
                  <Cell>
                    {cpl != null ? <span>{formatTenge(cpl)}</span> : <MetricsDash />}
                  </Cell>
                  <Cell><CountValue value={d.crmReceived} /></Cell>
                  <Cell className="bg-muted/25"><DisabledSoon /></Cell>
                  <Cell><CountValue value={d.scheduled} /></Cell>
                  <Cell><CountValue value={d.conducted} /></Cell>
                  <Cell>
                    <PaidDiagnosticsCell count={d.diagnosticsPaid} sum={d.diagnosticRevenuePaid} />
                  </Cell>
                  <Cell><CountValue value={d.sales} /></Cell>
                  <Cell>
                    {d.salesRevenue > 0 ? formatTenge(d.salesRevenue) : <CountValue value={0} />}
                  </Cell>
                  <Cell>
                    {d.cashRevenue > 0 ? formatTenge(d.cashRevenue) : <CountValue value={0} />}
                  </Cell>
                  <Cell>
                    <ManualFactCell
                      title="Предоплаты"
                      icon={HandCoins}
                      isoDate={d.iso}
                      value={d.prepaySum}
                      crm={0}
                      manual={d.prepaySum}
                      manualRaw={d.prepaySum > 0 ? d.prepaySum : null}
                      autoLabel="—"
                      disabled={rnpEditDisabled}
                      format={formatTenge}
                      allowDecimal
                      onSave={(next) => onSavePrepaySum(d.iso, next)}
                    />
                  </Cell>
                </tr>
              );
            })
          )}

          {visibleDays.length > 0 && (
            <tr className="border-t-2 border-border/50 bg-muted/30 font-semibold">
              <td className="sticky left-0 z-[1] bg-muted/30 px-3 py-2.5 text-left text-xs uppercase tracking-wide text-muted-foreground shadow-[2px_0_6px_-4px_rgba(0,0,0,0.15)]">
                Итого
              </td>
              <Cell>
                {totals.hasAnyCdi ? formatTenge(totals.spend) : <MetricsDash />}
              </Cell>
              <Cell>
                {totals.hasAnyCdi ? <CountValue value={totals.metaLeads} /> : <MetricsDash />}
              </Cell>
              <Cell>
                {totalCpl != null ? formatTenge(totalCpl) : <MetricsDash />}
              </Cell>
              <Cell><CountValue value={totals.crmReceived} /></Cell>
              <Cell className="bg-muted/25"><DisabledSoon /></Cell>
              <Cell><CountValue value={totals.scheduled} /></Cell>
              <Cell><CountValue value={totals.conducted} /></Cell>
              <Cell>
                <PaidDiagnosticsCell count={totals.diagnosticsPaid} sum={totals.diagnosticRevenuePaid} />
              </Cell>
              <Cell><CountValue value={totals.sales} /></Cell>
              <Cell>{formatTenge(totals.salesRevenue)}</Cell>
              <Cell>{formatTenge(totals.cashRevenue)}</Cell>
              <Cell>{totals.prepaySum > 0 ? formatTenge(totals.prepaySum) : <CountValue value={0} />}</Cell>
            </tr>
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
