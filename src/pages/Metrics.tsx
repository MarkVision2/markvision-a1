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
import { PeriodPicker, monthRange } from "@/components/dashboard/PeriodPicker";
import { MetricsDataTable } from "@/components/metrics/MetricsDataTable";
import { MetricsKpiPanel } from "@/components/metrics/MetricsKpiPanel";
import { MetricsSummaryStrip } from "@/components/metrics/MetricsSummaryStrip";
import { MONTHS_GEN_RU, WEEKDAYS_RU } from "@/components/metrics/metricsFormat";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useMultiMetaInsights, type DailyInsightRow } from "@/hooks/useMetaInsights";
import { useFinancePlans, monthKey } from "@/hooks/useFinancePlan";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { crmDailyMetrics, fetchCdiFactRows, type ReportPeriodRange } from "@/hooks/useReportData";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  shouldApplyManualOverrides,
  sumResolvedMetricsPerCabinets,
  type CdiFactRow,
} from "@/lib/metricsSourceOfTruth";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AdCabinet } from "@/types/ads";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

const Metrics = () => {
  const [period, setPeriod] = useState<ReportPeriodRange>(() => monthRange(new Date()));
  const monthCursor = period.from;
  const [cabinetId, setCabinetId] = useState<string>("all");
  const { cabinets } = usePersonalCabinets();
  const { activeId: projectId } = useProjectsStore();
  const [resyncing, setResyncing] = useState(false);
  const [showAllDays, setShowAllDays] = useState(true);
  const [cdiFactRows, setCdiFactRows] = useState<CdiFactRow[]>([]);
  const [cdiTick, setCdiTick] = useState(0);

  const monthParam = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}`;

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

  const manualHint = manualCabinet
    ? canEditManual
      ? `Диагностики/продажи: авто из CRM. Ручная правка → кабинет «${manualCabinet.name}»`
      : `Выбери один кабинет в фильтре, чтобы вручную скорректировать день (сейчас ${cabinetsWithExternalId.length} кабинетов)`
    : cabinetId === "all"
      ? "Выбери один кабинет, чтобы вносить ручные диагностики, оплаты и сумму"
      : "У выбранного кабинета нет внешнего ID для единой статистики";

  const { data, loading, error, refresh } = useMultiMetaInsights(
    actIds,
    monthParam,
    actIds.length > 0,
  );

  const { getPlan } = useFinancePlans();
  const plan = getPlan(monthKey(monthCursor));

  const totals = data?.totals;

  // Days in selected month
  const daysInMonth = new Date(
    monthCursor.getFullYear(),
    monthCursor.getMonth() + 1,
    0,
  ).getDate();
  const monthDays = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const date = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day);
      const iso = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { day, iso, weekday: WEEKDAYS_RU[date.getDay()] };
    });
  }, [monthCursor, daysInMonth]);

  const filledDays = data?.daily.length ?? 0;
  const monthProgress = Math.round((filledDays / daysInMonth) * 100);

  // Orphan CRM-лиды этого месяца (без cabinet_id) — заявки с сайта/WhatsApp,
  // которые не относятся ни к одному рекламному кабинету. Чтобы факты Metrics
  // совпадали с Dashboard/Analytics, прибавляем их к CDI-суммам.
  // ЕДИНАЯ СЕМАНТИКА ДАТ (как в useReportData / Analytics):
  //   leads (для счёта) — по createdAt в периоде
  //   sales/diagnostics/revenue — по ДАТЕ СОБЫТИЯ (paid_at / lastActivityAt)
  const { leads: allLeads } = useLeadsLite();
  const monthStartTs = monthCursor.getTime();
  const monthEndTs = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1).getTime();
  const orphanThisMonth = useMemo(
    () => allLeads.filter((l) => {
      if (l.cabinetId) return false;
      // Если выбран конкретный кабинет — orphan-лиды не показываем,
      // т.к. они не относятся ни к какому кабинету.
      if (cabinetId !== "all") return false;
      const t = new Date(l.createdAt).getTime();
      return t >= monthStartTs && t < monthEndTs;
    }),
    [allLeads, cabinetId, monthStartTs, monthEndTs],
  );
  const crmPeriod: ReportPeriodRange = useMemo(
    () => ({
      from: new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1),
      to: new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0),
    }),
    [monthCursor],
  );

  const cabinetSelector = cabinetId === "all" ? "all" : cabinetId;

  const cabinetInternalIds = useMemo(() => {
    if (cabinetId === "all") return cabinets.filter((c) => c.externalId).map((c) => c.id);
    const cab = cabinets.find((c) => c.id === cabinetId);
    return cab?.externalId ? [cabinetId] : [];
  }, [cabinetId, cabinets]);

  const externalIdByCabinetId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cabinets) {
      if (c.externalId) m.set(c.id, c.externalId);
    }
    return m;
  }, [cabinets]);

  useEffect(() => {
    if (actIds.length === 0) {
      setCdiFactRows([]);
      return;
    }
    let cancelled = false;
    fetchCdiFactRows(actIds, crmPeriod, projectId)
      .then((rows) => { if (!cancelled) setCdiFactRows(rows); })
      .catch(() => { if (!cancelled) setCdiFactRows([]); });
    return () => { cancelled = true; };
  }, [actIds.join(","), crmPeriod.from.getTime(), crmPeriod.to.getTime(), projectId, cdiTick]);

  const crmByDay = useMemo(
    () => crmDailyMetrics(allLeads, crmPeriod, cabinetSelector),
    [allLeads, crmPeriod, cabinetSelector],
  );

  // Распределяем orphan-показатели по дням (по дате оплаты или создания лида),
  // чтобы Daily-строки в таблице суммировались точно в Fact-строку.
  // Без этого пользователь видит «расхождение»: сумма колонки ≠ итог.
  const dailyMap = useMemo(() => {
    const m = new Map<string, DailyInsightRow>();

    const emptyDay = (date: string): DailyInsightRow => ({
      date,
      spend: 0, impressions: 0, clicks: 0, leads: 0,
      pixelRevenue: 0, revenue: 0,
      diagnostics: 0, crmDiagnostics: 0, manualDiagnostics: 0, manualDiagnosticsRaw: null,
      diagnosticRevenue: 0, crmDiagnosticRevenue: 0, manualDiagnosticRevenue: 0, manualDiagnosticRevenueRaw: null,
      sales: 0, crmSales: 0, manualSales: 0, manualSalesRaw: null,
      salesRevenue: 0, crmSalesRevenueOnly: 0, manualSalesRevenue: 0, manualSalesRevenueRaw: null,
      crmRevenue: 0, crmRevenueOnly: 0, manualRevenue: 0,
    });

    for (const d of data?.daily ?? []) m.set(d.date, { ...d });

    for (const { iso } of monthDays) {
      const cdi = m.get(iso) ?? emptyDay(iso);
      const crm = crmByDay.get(iso);
      const crmDiag = crm?.diagnostics ?? 0;
      const crmDiagRev = crm?.diagnosticRevenue ?? 0;
      const crmSales = crm?.sales ?? 0;
      const crmSalesRev = crm?.salesRevenue ?? 0;

      const [y, mo, d] = iso.split("-").map(Number);
      const dayResolved = sumResolvedMetricsPerCabinets(
        { from: new Date(y, mo - 1, d), to: new Date(y, mo - 1, d) },
        allLeads,
        cdiFactRows,
        cabinetInternalIds,
        cabinetId === "all",
        externalIdByCabinetId,
      );

      m.set(iso, {
        ...cdi,
        crmDiagnostics: crmDiag,
        crmDiagnosticRevenue: crmDiagRev,
        crmSales,
        crmSalesRevenueOnly: crmSalesRev,
        diagnostics: dayResolved.diagnostics,
        diagnosticRevenue: dayResolved.diagnosticRevenue,
        sales: dayResolved.sales,
        salesRevenue: dayResolved.salesRevenue,
        manualDiagnostics: cdi.manualDiagnostics ?? 0,
        manualDiagnosticRevenue: cdi.manualDiagnosticRevenue ?? 0,
        manualSales: cdi.manualSales ?? 0,
        manualSalesRevenue: cdi.manualSalesRevenue ?? 0,
        crmRevenue: dayResolved.revenue,
        crmRevenueOnly: crmSalesRev + crmDiagRev,
        manualDiagnosticsRaw: canEditManual ? cdi.manualDiagnosticsRaw : null,
        manualDiagnosticRevenueRaw: canEditManual ? cdi.manualDiagnosticRevenueRaw : null,
        manualSalesRaw: canEditManual ? cdi.manualSalesRaw : null,
        manualSalesRevenueRaw: canEditManual ? cdi.manualSalesRevenueRaw : null,
      });
    }

    // Orphan-лиды без cabinet_id: только Meta-лиды (создание), CRM-метрики уже в crmByDay.
    for (const l of orphanThisMonth) {
      const created = l.createdAt.slice(0, 10);
      const cur = m.get(created) ?? emptyDay(created);
      cur.leads += 1;
      m.set(created, cur);
    }

    return m;
  }, [data, monthDays, crmByDay, canEditManual, orphanThisMonth, allLeads, cdiFactRows, cabinetInternalIds, cabinetId]);

  const factResolved = useMemo(
    () => sumResolvedMetricsPerCabinets(
      crmPeriod, allLeads, cdiFactRows, cabinetInternalIds, cabinetId === "all", externalIdByCabinetId,
    ),
    [crmPeriod, allLeads, cdiFactRows, cabinetInternalIds, cabinetId, externalIdByCabinetId],
  );
  const factDiagnostics = factResolved.diagnostics;
  const factDiagnosticRevenue = factResolved.diagnosticRevenue;
  const factSales = factResolved.sales;
  const factSalesRevenue = factResolved.salesRevenue;
  const factRevenue = factResolved.revenue;
  const factLeads = (totals?.leads ?? 0) + orphanThisMonth.length;
  const factCac = factSales > 0 ? (totals?.spend ?? 0) / factSales : 0;
  const factCpd = factDiagnostics > 0 ? (totals?.spend ?? 0) / factDiagnostics : 0;
  const crLeadDiagnostics =
    factLeads > 0 ? (factDiagnostics / factLeads) * 100 : 0;
  const crDiagnosticsSale =
    factDiagnostics > 0 ? (factSales / factDiagnostics) * 100 : 0;

  const daysWithData = useMemo(
    () =>
      monthDays.filter(({ iso }) => {
        const d = dailyMap.get(iso);
        if (!d) return false;
        return (
          d.spend > 0 ||
          d.leads > 0 ||
          d.diagnostics > 0 ||
          d.sales > 0 ||
          (d.crmRevenue ?? 0) > 0
        );
      }),
    [monthDays, dailyMap],
  );

  const visibleDays = showAllDays ? monthDays : daysWithData;

  const cabinetLabel =
    cabinetId === "all"
      ? "Все кабинеты"
      : cabinets.find((c) => c.id === cabinetId)?.name ?? "Кабинет";

  const handleExportCsv = () => {
    const header = [
      "Дата", "День",
      "Расходы", "Лиды", "CPL",
      "Диагностики", "Оплаты", "Выручка",
      "Показы", "Клики", "CTR", "CPC", "CPM",
    ];
    const rows = monthDays.map(({ day, iso, weekday }) => {
      const d = dailyMap.get(iso);
      const cpl = d && d.leads > 0 ? d.spend / d.leads : 0;
      const cpc = d && d.clicks > 0 ? d.spend / d.clicks : 0;
      const cpm = d && d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0;
      const ctr = d && d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0;
      return [
        iso,
        `${String(day).padStart(2, "0")} ${weekday}`,
        d?.spend ?? 0,
        d?.leads ?? 0,
        cpl ? Math.round(cpl) : "",
        d?.diagnostics ?? 0,
        d?.sales ?? 0,
        d?.crmRevenue ?? 0,
        d?.impressions ?? 0,
        d?.clicks ?? 0,
        ctr ? ctr.toFixed(2) : "",
        cpc ? Math.round(cpc) : "",
        cpm ? Math.round(cpm) : "",
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
    a.download = `metrics-${monthParam}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResync = async () => {
    setResyncing(true);
    try {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const since = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
      const monthEnd = lastDay < yesterday ? lastDay : yesterday;
      const until = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, "0")}-${String(monthEnd.getDate()).padStart(2, "0")}`;
      const targetCab = cabinetId !== "all"
        ? cabinets.find((c) => c.id === cabinetId)
        : null;
      const body: Record<string, string> = { since, until };
      if (targetCab) body.cabinet_id = targetCab.id;
      const { error: invErr } = await supabase.functions.invoke("meta-daily-sync", { body });
      if (invErr) throw invErr;
      refresh();
      toast.success(`Синхронизация ${since} → ${until} выполнена`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать");
    } finally {
      setResyncing(false);
    }
  };

  const upsertManualFact = async (
    isoDate: string,
    patch: {
      manual_diagnostics?: number | null;
      manual_sales?: number | null;
      manual_revenue?: number | null;
      manual_diagnostic_revenue?: number | null;
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

      refresh();
      setCdiTick((t) => t + 1);
      toast.success("Ручной факт сохранен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить факт");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={CalendarDays}
        title="Таблица показателей"
        description={`${cabinetLabel} · ${MONTHS_GEN_RU[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`}
      />

      <MetricsKpiPanel
        plan={plan}
        factRevenue={factRevenue}
        factSpend={totals?.spend ?? 0}
        factLeads={factLeads}
        factSales={factSales}
        factDiagnostics={factDiagnostics}
        factCpl={totals?.cpl ?? 0}
        factCpd={factCpd}
        factCac={factCac}
        crLeadDiagnostics={crLeadDiagnostics}
        crDiagnosticsSale={crDiagnosticsSale}
        monthProgress={monthProgress}
        filledDays={filledDays}
        daysInMonth={daysInMonth}
      />

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker range={period} onChange={setPeriod} />
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
              Все дни ({daysInMonth})
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

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Не удалось загрузить статистику</div>
            <div className="mt-0.5 text-xs opacity-90">{error}</div>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-4">
        <MetricsSummaryStrip
          plan={plan}
          fact={{
            spend: totals?.spend ?? 0,
            leads: factLeads,
            cpl: totals?.cpl ?? 0,
            diagnostics: factDiagnostics,
            diagnosticRevenue: factDiagnosticRevenue,
            sales: factSales,
            salesRevenue: factSalesRevenue,
            revenue: factRevenue,
          }}
        />

        <MetricsDataTable
          monthDays={monthDays}
          visibleDays={visibleDays}
          dailyMap={dailyMap}
          loading={loading}
          loadingLabel={`Загружаем данные за ${MONTHS_GEN_RU[monthCursor.getMonth()]} ${monthCursor.getFullYear()}...`}
          manualCabinet={manualCabinet}
          canEditManual={canEditManual}
          onSaveDiagnostics={(iso, next) => upsertManualFact(iso, { manual_diagnostics: next })}
          onSaveDiagnosticRevenue={(iso, next) =>
            upsertManualFact(iso, { manual_diagnostic_revenue: next })
          }
          onSaveSales={(iso, next) => upsertManualFact(iso, { manual_sales: next })}
          onSaveSalesRevenue={(iso, next) => upsertManualFact(iso, { manual_revenue: next })}
        />
      </div>
    </PageContainer>
  );
};

export default Metrics;
