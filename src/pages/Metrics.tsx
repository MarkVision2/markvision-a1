import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MetricsDataTable,
  type MetricsTableDay,
  type MetricsTableTotals,
} from "@/components/metrics/MetricsDataTable";
import { MetricsKpiPanel } from "@/components/metrics/MetricsKpiPanel";
import { MetricsPeriodPicker } from "@/components/metrics/MetricsPeriodPicker";
import { MetricsSummaryStrip } from "@/components/metrics/MetricsSummaryStrip";
import { WEEKDAYS_RU } from "@/components/metrics/metricsFormat";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { fetchInsightsByDateRange } from "@/hooks/useMetaInsights";
import { useFinancePlans, monthKey } from "@/hooks/useFinancePlan";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { type ReportPeriodRange } from "@/hooks/useReportData";
import { metricsRnpDaily, sumRnpDaily } from "@/lib/metricsRnpDaily";
import { useRnpManual, type RnpManualPatch } from "@/hooks/useRnpManual";
import { useStageChangeEvents } from "@/hooks/useStageChangeEvents";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  daysInRange,
  formatPeriodLabel,
  monthRange,
  type MetricsPeriodPreset,
  ymdLocal,
} from "@/lib/metricsPeriod";
import { cn } from "@/lib/utils";
import { formatMetaSyncMessages, syncMetaDaily, ymdAlmaty } from "@/lib/metaSync";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

const Metrics = () => {
  const [preset, setPreset] = useState<MetricsPeriodPreset>("month");
  const [period, setPeriod] = useState<ReportPeriodRange>(() => monthRange());
  const [cabinetId, setCabinetId] = useState<string>("all");
  const { cabinets } = usePersonalCabinets();
  const { activeId: projectId } = useProjectsStore();
  const [resyncing, setResyncing] = useState(false);
  const [showAllDays, setShowAllDays] = useState(true);
  const [insights, setInsights] = useState<Awaited<ReturnType<typeof fetchInsightsByDateRange>> | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsTick, setInsightsTick] = useState(0);

  const periodSince = ymdLocal(period.from);
  const periodUntil = ymdLocal(period.to);

  const allActIds = useMemo(
    () => cabinets.map((c) => c.externalId).filter(Boolean),
    [cabinets],
  );

  const actIds = useMemo(() => {
    if (cabinetId === "all") return allActIds;
    const cab = cabinets.find((c) => c.id === cabinetId);
    return cab?.externalId ? [cab.externalId] : [];
  }, [cabinetId, allActIds, cabinets]);

  const cabinetSelector = cabinetId === "all" ? "all" : cabinetId;

  const { leads: allLeads } = useLeadsLite();
  const { events: stageEvents } = useStageChangeEvents(period, true);

  const {
    byDate: rnpManualByDate,
    tableMissing: rnpTableMissing,
    upsert: upsertRnpManual,
  } = useRnpManual(periodSince, periodUntil);

  useEffect(() => {
    if (actIds.length === 0) {
      setInsights(null);
      return;
    }
    let cancelled = false;
    setInsightsLoading(true);
    setInsightsError(null);
    fetchInsightsByDateRange(actIds, periodSince, periodUntil, projectId)
      .then((d) => { if (!cancelled) setInsights(d); })
      .catch((e) => {
        if (cancelled) return;
        setInsightsError(e instanceof Error ? e.message : "Неизвестная ошибка");
        setInsights(null);
      })
      .finally(() => { if (!cancelled) setInsightsLoading(false); });
    return () => { cancelled = true; };
  }, [actIds.join(","), periodSince, periodUntil, projectId, insightsTick]);

  const refreshInsights = () => setInsightsTick((t) => t + 1);

  const rnpByDay = useMemo(
    () => metricsRnpDaily(allLeads, stageEvents, period, cabinetSelector),
    [allLeads, stageEvents, period, cabinetSelector],
  );

  const cdiByDate = useMemo(() => {
    const m = new Map<string, { spend: number; leads: number }>();
    for (const d of insights?.daily ?? []) {
      m.set(d.date, { spend: d.spend, leads: d.leads });
    }
    return m;
  }, [insights]);

  const periodDays = useMemo((): MetricsTableDay[] => {
    const isos = daysInRange(period);
    return isos.map((iso) => {
      const [y, mo, day] = iso.split("-").map(Number);
      const date = new Date(y, mo - 1, day);
      const cdi = cdiByDate.get(iso);
      const rnp = rnpByDay.get(iso);
      return {
        iso,
        day,
        weekday: WEEKDAYS_RU[date.getDay()],
        hasCdi: cdi != null,
        spend: cdi?.spend ?? 0,
        metaLeads: cdi?.leads ?? 0,
        crmReceived: rnp?.crmReceived ?? 0,
        scheduled: rnp?.scheduled ?? 0,
        conducted: rnp?.conducted ?? 0,
        diagnosticsPaid: rnp?.diagnosticsPaid ?? 0,
        diagnosticRevenuePaid: rnp?.diagnosticRevenuePaid ?? 0,
        sales: rnp?.sales ?? 0,
        salesRevenue: rnp?.salesRevenue ?? 0,
        cashRevenue: rnp?.cashRevenue ?? 0,
        prepaySum: rnpManualByDate.get(iso)?.prepaySum ?? 0,
      };
    });
  }, [period, cdiByDate, rnpByDay, rnpManualByDate]);

  const sortedDays = useMemo(
    () => [...periodDays].sort((a, b) => b.iso.localeCompare(a.iso)),
    [periodDays],
  );

  const daysWithData = useMemo(
    () =>
      sortedDays.filter(
        (d) =>
          d.hasCdi ||
          d.crmReceived > 0 ||
          d.scheduled > 0 ||
          d.conducted > 0 ||
          d.diagnosticsPaid > 0 ||
          d.sales > 0 ||
          d.salesRevenue > 0 ||
          d.cashRevenue > 0 ||
          d.prepaySum > 0,
      ),
    [sortedDays],
  );

  const visibleDays = showAllDays ? sortedDays : daysWithData;

  const rnpTotals = useMemo(() => sumRnpDaily(rnpByDay), [rnpByDay]);

  const tableTotals = useMemo((): MetricsTableTotals => {
    let prepaySum = 0;
    for (const v of rnpManualByDate.values()) prepaySum += v.prepaySum;
    const cdiDays = insights?.daily ?? [];
    const hasAnyCdi = cdiDays.length > 0;
    return {
      spend: insights?.totals.spend ?? 0,
      metaLeads: insights?.totals.leads ?? 0,
      crmReceived: rnpTotals.crmReceived,
      scheduled: rnpTotals.scheduled,
      conducted: rnpTotals.conducted,
      diagnosticsPaid: rnpTotals.diagnosticsPaid,
      diagnosticRevenuePaid: rnpTotals.diagnosticRevenuePaid,
      sales: rnpTotals.sales,
      salesRevenue: rnpTotals.salesRevenue,
      cashRevenue: rnpTotals.cashRevenue,
      prepaySum,
      hasAnyCdi,
    };
  }, [insights, rnpTotals, rnpManualByDate]);

  const { getPlan } = useFinancePlans();
  const plan = getPlan(monthKey(period.from));

  const factRevenue = rnpTotals.salesRevenue + rnpTotals.diagnosticRevenuePaid;
  const factSpend = insights?.totals.spend ?? 0;
  const factCpl = tableTotals.metaLeads > 0 ? factSpend / tableTotals.metaLeads : 0;
  const factCpd = rnpTotals.diagnosticsPaid > 0 ? factSpend / rnpTotals.diagnosticsPaid : 0;
  const factCac = rnpTotals.sales > 0 ? factSpend / rnpTotals.sales : 0;
  const crLeadDiagnostics =
    rnpTotals.crmReceived > 0 ? (rnpTotals.diagnosticsPaid / rnpTotals.crmReceived) * 100 : 0;
  const crDiagnosticsSale =
    rnpTotals.diagnosticsPaid > 0 ? (rnpTotals.sales / rnpTotals.diagnosticsPaid) * 100 : 0;

  const filledDays = daysWithData.length;
  const daysInPeriod = periodDays.length;
  const monthProgress = daysInPeriod > 0 ? Math.round((filledDays / daysInPeriod) * 100) : 0;

  const cabinetLabel =
    cabinetId === "all"
      ? "Все кабинеты"
      : cabinets.find((c) => c.id === cabinetId)?.name ?? "Кабинет";

  const handlePeriodChange = (nextPreset: MetricsPeriodPreset, range: ReportPeriodRange) => {
    setPreset(nextPreset);
    setPeriod(range);
  };

  const handleExportCsv = () => {
    const header = [
      "Дата", "День",
      "Затраты", "Передано Meta", "CPL", "Получено CRM", "Квал",
      "Записано", "Проведено", "Оплачено диаг", "Сумма диаг",
      "Продажи", "Выручка", "Касса", "Предоплаты",
    ];
    const rows = sortedDays.map((d) => {
      const cpl = d.hasCdi && d.metaLeads > 0 ? d.spend / d.metaLeads : "";
      return [
        d.iso,
        `${String(d.day).padStart(2, "0")} ${d.weekday}`,
        d.hasCdi ? d.spend : "",
        d.hasCdi ? d.metaLeads : "",
        cpl ? Math.round(Number(cpl)) : "",
        d.crmReceived,
        "",
        d.scheduled,
        d.conducted,
        d.diagnosticsPaid,
        d.diagnosticRevenuePaid,
        d.sales,
        d.salesRevenue,
        d.cashRevenue,
        d.prepaySum,
      ];
    });
    const csv = [header, ...rows]
      .map((r) =>
        r.map((v) => {
          const s = String(v ?? "");
          return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(";"),
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `metrics-${periodSince}_${periodUntil}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResync = async () => {
    setResyncing(true);
    try {
      const targetCab = cabinetId !== "all"
        ? cabinets.find((c) => c.id === cabinetId)
        : null;
      const daily = await syncMetaDaily({
        since: periodSince,
        until: ymdAlmaty(),
        ...(targetCab ? { cabinet_id: targetCab.id } : {}),
      });
      const messages = formatMetaSyncMessages({
        daily,
        structure: { kind: "structure", ok: true, results: [] },
      });
      if (messages.success) toast.success(messages.success);
      for (const warning of messages.warnings) toast.warning(warning);
      if (messages.error) toast.error(messages.error);
      refreshInsights();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать");
    } finally {
      setResyncing(false);
    }
  };

  const saveRnpManual = async (isoDate: string, patch: RnpManualPatch) => {
    try {
      await upsertRnpManual(isoDate, patch);
      toast.success("Предоплата сохранена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={CalendarDays}
        title="Таблица показателей"
        description={`${cabinetLabel} · ${formatPeriodLabel(period)}`}
      />

      <MetricsKpiPanel
        plan={plan}
        factRevenue={factRevenue}
        factSpend={factSpend}
        factLeads={rnpTotals.crmReceived}
        factSales={rnpTotals.sales}
        factDiagnostics={rnpTotals.diagnosticsPaid}
        factCpl={factCpl}
        factCpd={factCpd}
        factCac={factCac}
        crLeadDiagnostics={crLeadDiagnostics}
        crDiagnosticsSale={crDiagnosticsSale}
        monthProgress={monthProgress}
        filledDays={filledDays}
        daysInMonth={daysInPeriod}
      />

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <MetricsPeriodPicker preset={preset} range={period} onPresetChange={handlePeriodChange} />
          <Select value={cabinetId} onValueChange={setCabinetId}>
            <SelectTrigger className="h-11 min-w-[200px] rounded-xl border-border/60 bg-card/60">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Все кабинеты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все кабинеты</SelectItem>
              {cabinets.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-border/60 bg-card/40 p-0.5">
            <button
              type="button"
              onClick={() => setShowAllDays(false)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                !showAllDays ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              С данными ({daysWithData.length})
            </button>
            <button
              type="button"
              onClick={() => setShowAllDays(true)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                showAllDays ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Все дни ({daysInPeriod})
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 rounded-xl"
            onClick={handleResync}
            disabled={resyncing || actIds.length === 0}
          >
            {resyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Синхронизация
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-2 rounded-xl" onClick={handleExportCsv}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>
      </div>

      {insightsError && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Не удалось загрузить статистику</div>
            <div className="mt-0.5 text-xs opacity-90">{insightsError}</div>
          </div>
        </div>
      )}

      {rnpTableMissing && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Предоплаты пока некуда сохранять</div>
            <div className="mt-0.5 text-xs opacity-90">
              В базе нет таблицы rnp_daily — применить миграцию
              supabase/migrations/20260611090000_rnp_daily.sql.
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-4">
        <MetricsSummaryStrip
          plan={plan}
          fact={{
            spend: factSpend,
            leads: rnpTotals.crmReceived,
            cpl: factCpl,
            diagnostics: rnpTotals.diagnosticsPaid,
            diagnosticRevenue: rnpTotals.diagnosticRevenuePaid,
            sales: rnpTotals.sales,
            salesRevenue: rnpTotals.salesRevenue,
            revenue: factRevenue,
          }}
        />

        <MetricsDataTable
          visibleDays={visibleDays}
          totals={tableTotals}
          loading={insightsLoading}
          loadingLabel={`Загружаем данные за ${formatPeriodLabel(period)}...`}
          rnpEditDisabled={rnpTableMissing}
          onSavePrepaySum={(iso, next) => saveRnpManual(iso, { prepayments_sum: next ?? 0 })}
        />
      </div>
    </PageContainer>
  );
};

export default Metrics;
