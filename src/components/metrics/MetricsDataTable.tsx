import { DollarSign, Eye, Loader2, Wallet } from "lucide-react";
import { ManualFactCell } from "@/components/metrics/ManualFactCell";
import { MetricsDash } from "@/components/metrics/MetricsDash";
import { formatNumber } from "@/components/metrics/metricsFormat";
import { cn } from "@/lib/utils";
import type { DailyInsightRow } from "@/hooks/useMetaInsights";

const Cell = ({ children, mono = true }: { children: React.ReactNode; mono?: boolean }) => (
  <td className={cn("px-2 py-2 text-right text-xs", mono && "tabular-nums")}>{children}</td>
);

interface DayRow {
  day: number;
  iso: string;
  weekday: string;
}

interface Props {
  monthDays: DayRow[];
  visibleDays: DayRow[];
  dailyMap: Map<string, DailyInsightRow>;
  loading: boolean;
  loadingLabel: string;
  manualCabinet: { name: string } | null;
  canEditManual: boolean;
  onSaveDiagnostics: (iso: string, next: number | null) => Promise<void>;
  onSaveDiagnosticRevenue: (iso: string, next: number | null) => Promise<void>;
  onSaveSales: (iso: string, next: number | null) => Promise<void>;
  onSaveSalesRevenue: (iso: string, next: number | null) => Promise<void>;
}

export function MetricsDataTable({
  visibleDays,
  dailyMap,
  loading,
  loadingLabel,
  manualCabinet,
  canEditManual,
  onSaveDiagnostics,
  onSaveDiagnosticRevenue,
  onSaveSales,
  onSaveSalesRevenue,
}: Props) {
  const editDisabled = !manualCabinet || !canEditManual;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/30">
      <table className="w-full min-w-[880px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border/40 bg-muted/30">
            <th rowSpan={2} className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Дата
            </th>
            <th colSpan={3} className="border-b border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Реклама
            </th>
            <th colSpan={2} className="border-b border-l border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Воронка
            </th>
            <th colSpan={3} className="border-b border-l border-border/30 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Выручка ₸
            </th>
          </tr>
          <tr className="border-b border-border/60 bg-card/50">
            {["Расходы", "Лиды", "CPL", "Диагн.", "Продажи", "Диагн.", "Продажи", "Итого"].map((h, i) => (
              <th
                key={h + i}
                className={cn(
                  "px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                  i === 3 && "border-l border-border/30",
                  i === 5 && "border-l border-border/30",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleDays.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                Нет дней с данными за выбранный период
              </td>
            </tr>
          ) : (
            visibleDays.map(({ day, iso, weekday }) => {
              const d = dailyMap.get(iso);
              const cpl = d && d.leads > 0 ? d.spend / d.leads : 0;
              const dayRevenue = d?.crmRevenue ?? 0;
              const hasData = !!d && (
                d.spend > 0 ||
                d.leads > 0 ||
                d.diagnostics > 0 ||
                d.sales > 0 ||
                dayRevenue > 0
              );

              return (
                <tr
                  key={iso}
                  className={cn(
                    "group border-b border-border/20 transition-colors hover:bg-card/50",
                    hasData && "bg-card/20",
                  )}
                >
                  <td className="sticky left-0 z-[1] bg-inherit px-3 py-2">
                    <span className="font-semibold tabular-nums">{String(day).padStart(2, "0")}</span>
                    <span className="ml-1.5 text-muted-foreground">{weekday}</span>
                  </td>
                  <Cell>{hasData && d!.spend > 0 ? formatNumber(d!.spend) : <MetricsDash />}</Cell>
                  <Cell>{hasData && d!.leads > 0 ? formatNumber(d!.leads) : <MetricsDash />}</Cell>
                  <Cell>{cpl > 0 ? formatNumber(cpl) : <MetricsDash />}</Cell>
                  <Cell>
                    <ManualFactCell
                      title="Диагностики"
                      icon={Eye}
                      isoDate={iso}
                      value={d?.diagnostics ?? 0}
                      crm={d?.crmDiagnostics ?? 0}
                      manual={d?.manualDiagnostics ?? 0}
                      manualRaw={d?.manualDiagnosticsRaw ?? null}
                      autoLabel="CRM"
                      disabled={editDisabled}
                      onSave={(next) => onSaveDiagnostics(iso, next)}
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
                      title="Опл. диагностик"
                      icon={DollarSign}
                      isoDate={iso}
                      value={d?.diagnosticRevenue ?? 0}
                      crm={d?.crmDiagnosticRevenue ?? 0}
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
                      title="Выр. продаж"
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
                    <span className={cn("font-semibold", dayRevenue > 0 && "text-success")}>
                      {dayRevenue > 0 ? formatNumber(dayRevenue) : <MetricsDash />}
                    </span>
                  </Cell>
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
