import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Download,
  Loader2,
  Pencil,
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
import { fetchInsightsByDateRange, type DailyInsightRow } from "@/hooks/useMetaInsights";
import { useFinancePlans, monthKey } from "@/hooks/useFinancePlan";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { type ReportPeriodRange } from "@/hooks/useReportData";
import { metricsRnpDaily } from "@/lib/metricsRnpDaily";
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
import { resolveCdiMetric } from "@/lib/cdiManualOverride";
import { formatMetaSyncMessages, syncMetaDaily, ymdAlmaty } from "@/lib/metaSync";
import { shouldApplyManualOverrides } from "@/lib/metricsSourceOfTruth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AdCabinet } from "@/types/ads";
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

  const cabinetsWithExternalId = useMemo(
    () => cabinets.filter((c) => Boolean(c.externalId)),
    [cabinets],
  );

  const actIds = useMemo(() => {
    if (cabinetId === "all") return allActIds;
    const cab = cabinets.find((c) => c.id === cabinetId);
    return cab?.externalId ? [cab.externalId] : [];
  }, [cabinetId, allActIds, cabinets]);

  const manualCabinet = useMemo(() => {
    if (cabinetId !== "all") return cabinets.find((c) => c.id === cabinetId) ?? null;
    return cabinetsWithExternalId.length === 1 ? cabinetsWithExternalId[0] : null;
  }, [cabinetId, cabinets, cabinetsWithExternalId]);

  const canEditManual = shouldApplyManualOverrides(cabinetId, cabinetsWithExternalId.length);
  const editDisabled = !canEditManual || !manualCabinet?.externalId;

  const manualHint = manualCabinet
    ? canEditManual
      ? `Клик по ячейке «Оплачено» / «Продажи» / «Выручка» → ручная правка дня (кабинет «${manualCabinet.name}»)`
      : `Выбери один кабинет в фильтре для ручного ввода (сейчас ${cabinetsWithExternalId.length} кабинетов)`
    : cabinetId === "all"
      ? "Выбери один кабинет, чтобы вносить ручные суммы"
      : "У выбранного кабинета нет внешнего ID";

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

  const insightByDate = useMemo(() => {
    const m = new Map<string, DailyInsightRow>();
    for (const d of insights?.daily ?? []) m.set(d.date, d);
    return m;
  }, [insights]);

  const periodDays = useMemo((): MetricsTableDay[] => {
    const isos = daysInRange(period);
    return isos.map((iso) => {
      const [y, mo, day] = iso.split("-").map(Number);
      const date = new Date(y, mo - 1, day);
      const ins = insightByDate.get(iso);
      const rnp = rnpByDay.get(iso);
      const autoDiagPaid = rnp?.diagnosticsPaid ?? 0;
      const autoDiagRev = rnp?.diagnosticRevenuePaid ?? 0;
      const autoSales = rnp?.sales ?? 0;
      const autoSalesRev = rnp?.salesRevenue ?? 0;
      const manualDiagRaw = canEditManual ? ins?.manualDiagnosticsRaw ?? null : null;
      const manualDiagRevRaw = canEditManual ? ins?.manualDiagnosticRevenueRaw ?? null : null;
      const manualSalesRaw = canEditManual ? ins?.manualSalesRaw ?? null : null;
      const manualSalesRevRaw = canEditManual ? ins?.manualSalesRevenueRaw ?? null : null;
      return {
        iso,
        day,
        weekday: WEEKDAYS_RU[date.getDay()],
        hasCdi: ins != null,
        spend: ins?.spend ?? 0,
        metaLeads: ins?.leads ?? 0,
        crmReceived: rnp?.crmReceived ?? 0,
        scheduled: rnp?.scheduled ?? 0,
        conducted: rnp?.conducted ?? 0,
        diagnosticsPaid: resolveCdiMetric(manualDiagRaw, autoDiagPaid),
        diagnosticsPaidAuto: autoDiagPaid,
        manualDiagnosticsRaw: manualDiagRaw,
        manualDiagnostics: ins?.manualDiagnostics ?? 0,
        diagnosticRevenuePaid: resolveCdiMetric(manualDiagRevRaw, autoDiagRev),
        diagnosticRevenueAuto: autoDiagRev,
        manualDiagnosticRevenueRaw: manualDiagRevRaw,
        manualDiagnosticRevenue: ins?.manualDiagnosticRevenue ?? 0,
        sales: resolveCdiMetric(manualSalesRaw, autoSales),
        salesAuto: autoSales,
        manualSalesRaw,
        manualSales: ins?.manualSales ?? 0,
        salesRevenue: resolveCdiMetric(manualSalesRevRaw, autoSalesRev),
        salesRevenueAuto: autoSalesRev,
        manualSalesRevenueRaw: manualSalesRevRaw,
        manualSalesRevenue: ins?.manualSalesRevenue ?? 0,
        cashRevenue: rnp?.cashRevenue ?? 0,
        prepaySum: rnpManualByDate.get(iso)?.prepaySum ?? 0,
      };
    });
  }, [period, insightByDate, rnpByDay, rnpManualByDate, canEditManual]);

  const sortedDays = useMemo(
    () => [...periodDays].sort((a, b) => a.iso.localeCompare(b.iso)),
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

  const tableTotals = useMemo((): MetricsTableTotals => {
    const t: MetricsTableTotals = {
      spend: 0,
      metaLeads: 0,
      crmReceived: 0,
      scheduled: 0,
      conducted: 0,
      diagnosticsPaid: 0,
      diagnosticRevenuePaid: 0,
      sales: 0,
      salesRevenue: 0,
      cashRevenue: 0,
      prepaySum: 0,
      hasAnyCdi: false,
    };
    for (const d of periodDays) {
      if (d.hasCdi) t.hasAnyCdi = true;
      t.spend += d.spend;
      t.metaLeads += d.metaLeads;
      t.crmReceived += d.crmReceived;
      t.scheduled += d.scheduled;
      t.conducted += d.conducted;
      t.diagnosticsPaid += d.diagnosticsPaid;
      t.diagnosticRevenuePaid += d.diagnosticRevenuePaid;
      t.sales += d.sales;
      t.salesRevenue += d.salesRevenue;
      t.cashRevenue += d.cashRevenue;
      t.prepaySum += d.prepaySum;
    }
    return t;
  }, [periodDays]);

  const { getPlan } = useFinancePlans();
  const plan = getPlan(monthKey(period.from));

  const factRevenue = tableTotals.salesRevenue + tableTotals.diagnosticRevenuePaid;
  const factSpend = tableTotals.spend;
  const factCpl = tableTotals.metaLeads > 0 ? factSpend / tableTotals.metaLeads : 0;
  const factCpd = tableTotals.diagnosticsPaid > 0 ? factSpend / tableTotals.diagnosticsPaid : 0;
  const factCac = tableTotals.sales > 0 ? factSpend / tableTotals.sales : 0;
  const crLeadDiagnostics =
    tableTotals.crmReceived > 0 ? (tableTotals.diagnosticsPaid / tableTotals.crmReceived) * 100 : 0;
  const crDiagnosticsSale =
    tableTotals.diagnosticsPaid > 0 ? (tableTotals.sales / tableTotals.diagnosticsPaid) * 100 : 0;

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

  const upsertManualFact = async (
    isoDate: string,
    patch: {
      manual_diagnostics?: number | null;
      manual_diagnostic_revenue?: number | null;
      manual_sales?: number | null;
      manual_revenue?: number | null;
    },
  ) => {
    if (!manualCabinet?.externalId) {
      toast.error("Выбери конкретный кабинет для ручного ввода");
      return;
    }

    const cleanPatch = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [
        key,
        value === null ? null : Math.max(0, Number(value) || 0),
      ]),
    );

    try {
      const { data: existing, error: findError } = await supabase
        .from("cabinet_daily_insights")
        .select("id")
        .eq("cabinet_id", manualCabinet.id)
        .eq("date", isoDate)
        .maybeSingle();
      if (findError) throw findError;

      if (existing?.id) {
        const { error: updateError } = await (supabase as any)
          .from("cabinet_daily_insights")
          .update(cleanPatch)
          .eq("id", existing.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("cabinet_daily_insights")
          .insert({
            cabinet_id: manualCabinet.id,
            external_id: manualCabinet.externalId,
            project_id: (manualCabinet as AdCabinet & { projectId?: string }).projectId ?? null,
            date: isoDate,
            currency: manualCabinet.currency ?? "KZT",
            ...cleanPatch,
          });
        if (insertError) throw insertError;
      }

      refreshInsights();
      toast.success("Ручной факт сохранён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить факт");
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
        factLeads={tableTotals.crmReceived}
        factSales={tableTotals.sales}
        factDiagnostics={tableTotals.diagnosticsPaid}
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

      <div
        className={cn(
          "mt-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
          canEditManual && manualCabinet
            ? "border-success/25 bg-success/5 text-success"
            : "border-warning/25 bg-warning/5 text-warning",
        )}
      >
        <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{manualHint}</span>
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
            leads: tableTotals.crmReceived,
            cpl: factCpl,
            diagnostics: tableTotals.diagnosticsPaid,
            diagnosticRevenue: tableTotals.diagnosticRevenuePaid,
            sales: tableTotals.sales,
            salesRevenue: tableTotals.salesRevenue,
            revenue: factRevenue,
          }}
        />

        <MetricsDataTable
          visibleDays={visibleDays}
          totals={tableTotals}
          loading={insightsLoading}
          loadingLabel={`Загружаем данные за ${formatPeriodLabel(period)}...`}
          editDisabled={editDisabled}
          rnpEditDisabled={rnpTableMissing}
          onSaveDiagnosticsPaid={(iso, next) =>
            upsertManualFact(iso, { manual_diagnostics: next })
          }
          onSaveDiagnosticRevenue={(iso, next) =>
            upsertManualFact(iso, { manual_diagnostic_revenue: next })
          }
          onSaveSales={(iso, next) => upsertManualFact(iso, { manual_sales: next })}
          onSaveSalesRevenue={(iso, next) => upsertManualFact(iso, { manual_revenue: next })}
          onSavePrepaySum={(iso, next) => saveRnpManual(iso, { prepayments_sum: next ?? 0 })}
        />
      </div>
    </PageContainer>
  );
};

export default Metrics;
