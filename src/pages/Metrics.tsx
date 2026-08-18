import { useEffect, useMemo, useRef, useState } from "react";
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
import { MONTHS_GEN_RU, WEEKDAYS_RU } from "@/components/metrics/metricsFormat";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useMultiMetaInsights, type DailyInsightRow } from "@/hooks/useMetaInsights";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { useStageChangeEvents } from "@/hooks/useStageChangeEvents";
import { crmDailyMetrics, fetchCdiFactRows, type ReportPeriodRange } from "@/hooks/useReportData";
import { metricsRnpDaily } from "@/lib/metricsRnpDaily";
import { useRnpManual, type RnpManualPatch } from "@/hooks/useRnpManual";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  shouldApplyManualOverrides,
  sumResolvedMetricsPerCabinets,
  type CdiFactRow,
} from "@/lib/metricsSourceOfTruth";
import { metricsEditHint, resolveMetricsEditScope } from "@/lib/metricsManualEdit";
import {
  applyProjectDailyOverride,
  fetchProjectDailyOverrides,
  type ProjectDailyOverride,
} from "@/lib/projectDailyOverrides";
import { cn } from "@/lib/utils";
import { formatMetaSyncMessages, syncMetaDaily, ymdAlmaty } from "@/lib/metaSync";
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
  // По умолчанию показываем только дни с данными — меньше пустых строк «—».
  const [showAllDays, setShowAllDays] = useState(false);
  const [tableMode, setTableMode] = useState<"business" | "detailed">("business");
  const [cdiFactRows, setCdiFactRows] = useState<CdiFactRow[]>([]);
  const [cdiTick, setCdiTick] = useState(0);
  const [projectOverrides, setProjectOverrides] = useState<Map<string, ProjectDailyOverride>>(new Map());
  const [projectTick, setProjectTick] = useState(0);
  const [lastSyncStatus, setLastSyncStatus] = useState<{
    kind: "success" | "warning" | "error";
    text: string;
    at: string;
  } | null>(null);

  const editScope = useMemo(
    () => resolveMetricsEditScope(cabinetId, cabinets),
    [cabinetId, cabinets],
  );
  const useProjectOverrides = editScope?.kind === "project";

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

  const canEditManual = shouldApplyManualOverrides(cabinetId, cabinetsWithExternalId.length);
  const hasMetaConnectedCabinets = cabinetsWithExternalId.length > 0;

  const manualHint = metricsEditHint(editScope, cabinetsWithExternalId.length);

  const cabinetInternalIds = useMemo(() => {
    if (cabinetId === "all") return cabinets.map((c) => c.id);
    return cabinets.some((c) => c.id === cabinetId) ? [cabinetId] : [];
  }, [cabinetId, cabinets]);

  const cdiCabinetIds = cabinetInternalIds;

  const { data, loading, error, refresh } = useMultiMetaInsights(
    actIds,
    monthParam,
    actIds.length > 0 || cdiCabinetIds.length > 0,
    cdiCabinetIds,
  );

  // Автоподтягивание Meta → cabinet_daily_insights при открытии месяца / смене кабинета.
  const autoSyncKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (actIds.length === 0) return;
    const syncKey = `${monthParam}:${cabinetId}`;
    if (autoSyncKeyRef.current === syncKey) return;
    autoSyncKeyRef.current = syncKey;

    const since = `${monthParam}-01`;
    const until = ymdAlmaty();
    const targetCab = cabinetId !== "all"
      ? cabinets.find((c) => c.id === cabinetId)
      : undefined;

    void (async () => {
      try {
        await syncMetaDaily({
          since,
          until,
          ...(targetCab ? { cabinet_id: targetCab.id } : {}),
        });
        refresh();
        setCdiTick((t) => t + 1);
      } catch {
        /* синхронизация опциональна — есть кнопка «Синхронизация» */
      }
    })();
  }, [monthParam, cabinetId, actIds.join(","), cabinets, refresh]);

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
  const crmPeriod: ReportPeriodRange = useMemo(
    () => ({
      from: new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1),
      to: new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0),
    }),
    [monthCursor],
  );
  const { events: stageEvents } = useStageChangeEvents(crmPeriod, true);

  const cabinetSelector = cabinetId === "all" ? "all" : cabinetId;

  const externalIdByCabinetId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cabinets) {
      if (c.externalId) m.set(c.id, c.externalId);
    }
    return m;
  }, [cabinets]);

  useEffect(() => {
    if (cabinetInternalIds.length === 0) {
      setCdiFactRows([]);
      return;
    }
    let cancelled = false;
    fetchCdiFactRows(actIds, crmPeriod, projectId, cabinetInternalIds)
      .then((rows) => { if (!cancelled) setCdiFactRows(rows); })
      .catch(() => { if (!cancelled) setCdiFactRows([]); });
    return () => { cancelled = true; };
  }, [actIds.join(","), cabinetInternalIds.join(","), crmPeriod.from.getTime(), crmPeriod.to.getTime(), projectId, cdiTick]);

  useEffect(() => {
    let cancelled = false;
    fetchProjectDailyOverrides(crmPeriod, projectId)
      .then((m) => { if (!cancelled) setProjectOverrides(m); })
      .catch(() => { if (!cancelled) setProjectOverrides(new Map()); });
    return () => { cancelled = true; };
  }, [crmPeriod.from.getTime(), crmPeriod.to.getTime(), projectId, projectTick]);

  const manualCabinet = editScope?.kind === "cabinet" ? editScope.cabinet : null;

  const crmByDay = useMemo(
    () => crmDailyMetrics(allLeads, crmPeriod, cabinetSelector),
    [allLeads, crmPeriod, cabinetSelector],
  );

  const rnpByDay = useMemo(
    () => metricsRnpDaily(allLeads, stageEvents, crmPeriod, cabinetSelector),
    [allLeads, stageEvents, crmPeriod, cabinetSelector],
  );

  // Ручные РНП-факты (предоплаты) — project-level, не зависят от кабинета.
  const {
    byDate: rnpManualByDate,
    tableMissing: rnpTableMissing,
    upsert: upsertRnpManual,
  } = useRnpManual(monthParam);

  // Распределяем orphan-показатели по дням (по дате оплаты или создания лида),
  // чтобы Daily-строки в таблице суммировались точно в Fact-строку.
  // Без этого пользователь видит «расхождение»: сумма колонки ≠ итог.
  const dailyMap = useMemo(() => {
    const m = new Map<string, DailyInsightRow>();

    const emptyDay = (date: string): DailyInsightRow => ({
      date,
      spend: 0, autoSpend: 0, manualSpend: 0, manualSpendRaw: null,
      impressions: 0, clicks: 0, leads: 0, autoLeads: 0, manualLeads: 0, manualLeadsRaw: null,
      pixelRevenue: 0, revenue: 0,
      diagnostics: 0, crmDiagnostics: 0, manualDiagnostics: 0, manualDiagnosticsRaw: null,
      diagnosticRevenue: 0, crmDiagnosticRevenue: 0, manualDiagnosticRevenue: 0, manualDiagnosticRevenueRaw: null,
      sales: 0, crmSales: 0, manualSales: 0, manualSalesRaw: null,
      salesRevenue: 0, crmSalesRevenueOnly: 0, manualSalesRevenue: 0, manualSalesRevenueRaw: null,
      crmRevenue: 0, crmRevenueOnly: 0, manualRevenue: 0,
      crmReceived: 0, autoCrmReceived: 0, manualCrmReceivedRaw: null,
      joins: 0,
      qualified: 0, autoQualified: 0, manualQualifiedRaw: null,
      plannedVisits: 0, autoPlannedVisits: 0, manualPlannedVisitsRaw: null,
      conductedVisits: 0, autoConductedVisits: 0, manualConductedVisitsRaw: null,
      diagnosticsPaid: 0, autoDiagnosticsPaid: 0, manualDiagnosticsPaidRaw: null,
      diagnosticRevenuePaid: 0,
      cashRevenue: 0, autoCashRevenue: 0, manualCashRaw: null,
      prepayCount: 0, prepaySum: 0,
    });

    for (const d of data?.daily ?? []) m.set(d.date, { ...d });

    for (const { iso } of monthDays) {
      const cdi = m.get(iso) ?? emptyDay(iso);
      const crm = crmByDay.get(iso);
      const crmDiag = crm?.diagnostics ?? 0;
      const crmDiagRev = crm?.diagnosticRevenue ?? 0;
      const crmSales = crm?.sales ?? 0;
      const crmSalesRev = crm?.salesRevenue ?? 0;
      const rnp = rnpByDay.get(iso);
      const proj = projectOverrides.get(iso);
      const stageScheduled = rnp?.scheduled ?? 0;
      const stageConducted = rnp?.conducted ?? 0;
      const plannedVisits = stageScheduled || rnp?.plannedVisits || 0;
      const conductedVisits = stageConducted || rnp?.conductedVisits || 0;

      const [y, mo, d] = iso.split("-").map(Number);
      const dayResolved = sumResolvedMetricsPerCabinets(
        { from: new Date(y, mo - 1, d), to: new Date(y, mo - 1, d) },
        allLeads,
        cdiFactRows,
        cabinetInternalIds,
        cabinetId === "all",
        externalIdByCabinetId,
      );

      const autoBlock = {
        spend: cdi.autoSpend ?? cdi.spend ?? 0,
        leads: cdi.autoLeads ?? cdi.leads ?? 0,
        crmReceived: rnp?.crmReceived ?? 0,
        qualified: rnp?.qualified ?? 0,
        plannedVisits,
        conductedVisits,
        diagnosticsPaid: rnp?.diagnosticsPaid ?? 0,
        diagnostics: conductedVisits || dayResolved.diagnostics,
        diagnosticRevenue: dayResolved.diagnosticRevenue,
        sales: dayResolved.sales,
        salesRevenue: dayResolved.salesRevenue,
        cashRevenue: rnp?.cashRevenue ?? 0,
        prepayCount: rnpManualByDate.get(iso)?.prepayCount ?? 0,
        prepaySum: rnpManualByDate.get(iso)?.prepaySum ?? 0,
      };

      const merged = useProjectOverrides
        ? applyProjectDailyOverride(autoBlock, proj)
        : autoBlock;

      const salesRevenue = useProjectOverrides ? merged.salesRevenue : dayResolved.salesRevenue;
      const diagnosticRevenue = useProjectOverrides ? merged.diagnosticRevenue : dayResolved.diagnosticRevenue;
      const totalRevenue = salesRevenue + diagnosticRevenue;

      m.set(iso, {
        ...cdi,
        spend: merged.spend,
        autoSpend: autoBlock.spend,
        manualSpendRaw: useProjectOverrides ? (proj?.manualSpend ?? null) : cdi.manualSpendRaw ?? null,
        leads: merged.leads,
        autoLeads: autoBlock.leads,
        manualLeadsRaw: useProjectOverrides ? (proj?.manualLeads ?? null) : cdi.manualLeadsRaw ?? null,
        crmDiagnostics: crmDiag,
        crmDiagnosticRevenue: crmDiagRev,
        crmSales,
        crmSalesRevenueOnly: crmSalesRev,
        diagnostics: merged.diagnostics,
        diagnosticRevenue,
        sales: merged.sales,
        salesRevenue,
        manualDiagnostics: cdi.manualDiagnostics ?? 0,
        manualDiagnosticRevenue: cdi.manualDiagnosticRevenue ?? 0,
        manualSales: cdi.manualSales ?? 0,
        manualSalesRevenue: cdi.manualSalesRevenue ?? 0,
        crmRevenue: totalRevenue,
        crmRevenueOnly: crmSalesRev + crmDiagRev,
        manualDiagnosticsRaw: useProjectOverrides
          ? (proj?.manualDiagnostics ?? null)
          : (canEditManual ? cdi.manualDiagnosticsRaw : null),
        manualDiagnosticRevenueRaw: useProjectOverrides
          ? (proj?.manualDiagnosticRevenue ?? null)
          : (canEditManual ? cdi.manualDiagnosticRevenueRaw : null),
        manualSalesRaw: useProjectOverrides
          ? (proj?.manualSales ?? null)
          : (canEditManual ? cdi.manualSalesRaw : null),
        manualSalesRevenueRaw: useProjectOverrides
          ? (proj?.manualSalesRevenue ?? null)
          : (canEditManual ? cdi.manualSalesRevenueRaw : null),
        crmReceived: merged.crmReceived,
        autoCrmReceived: autoBlock.crmReceived,
        manualCrmReceivedRaw: useProjectOverrides ? (proj?.manualCrmReceived ?? null) : null,
        joins: rnp?.joins ?? 0,
        qualified: merged.qualified,
        autoQualified: autoBlock.qualified,
        manualQualifiedRaw: useProjectOverrides ? (proj?.manualQualified ?? null) : null,
        prepayCount: merged.prepayCount,
        prepaySum: merged.prepaySum,
        plannedVisits: merged.plannedVisits,
        autoPlannedVisits: autoBlock.plannedVisits,
        manualPlannedVisitsRaw: useProjectOverrides ? (proj?.manualPlannedVisits ?? null) : null,
        conductedVisits: merged.conductedVisits,
        autoConductedVisits: autoBlock.conductedVisits,
        manualConductedVisitsRaw: useProjectOverrides ? (proj?.manualConductedVisits ?? null) : null,
        diagnosticsPaid: merged.diagnosticsPaid,
        autoDiagnosticsPaid: autoBlock.diagnosticsPaid,
        manualDiagnosticsPaidRaw: useProjectOverrides ? (proj?.manualDiagnosticsPaid ?? null) : null,
        diagnosticRevenuePaid: rnp?.diagnosticRevenuePaid ?? 0,
        cashRevenue: merged.cashRevenue,
        autoCashRevenue: autoBlock.cashRevenue,
        manualCashRaw: useProjectOverrides ? (proj?.manualCash ?? null) : null,
      });
    }

    return m;
  }, [
    data, monthDays, crmByDay, rnpByDay, rnpManualByDate, canEditManual, allLeads, cdiFactRows,
    cabinetInternalIds, cabinetId, externalIdByCabinetId, projectOverrides, useProjectOverrides,
  ]);

  const factFromDaily = useMemo(() => {
    let spend = 0, leads = 0, diagnostics = 0, diagnosticRevenue = 0;
    let sales = 0, salesRevenue = 0, revenue = 0;
    let crmReceived = 0, qualified = 0, joins = 0, plannedVisits = 0, conductedVisits = 0, diagnosticsPaid = 0;
    for (const { iso } of monthDays) {
      const d = dailyMap.get(iso);
      if (!d) continue;
      spend += d.spend;
      leads += d.leads;
      diagnostics += d.diagnostics;
      diagnosticRevenue += d.diagnosticRevenue;
      sales += d.sales;
      salesRevenue += d.salesRevenue;
      revenue += d.crmRevenue ?? 0;
      crmReceived += d.crmReceived;
      qualified += d.qualified;
      joins += d.joins ?? 0;
      plannedVisits += d.plannedVisits ?? 0;
      conductedVisits += d.conductedVisits ?? 0;
      diagnosticsPaid += d.diagnosticsPaid ?? 0;
    }
    return { spend, leads, diagnostics, diagnosticRevenue, sales, salesRevenue, revenue, crmReceived, qualified, joins, plannedVisits, conductedVisits, diagnosticsPaid };
  }, [dailyMap, monthDays]);

  const factSales = factFromDaily.sales;
  const factRevenue = factFromDaily.revenue;
  const factCrmReceived = factFromDaily.crmReceived;
  const factJoins = factFromDaily.joins;
  const factPlannedVisits = factFromDaily.plannedVisits;
  const factConductedVisits = factFromDaily.conductedVisits;
  const factDiagnosticsPaid = factFromDaily.diagnosticsPaid;
  const factMetaLeads = factFromDaily.leads;
  const factLeads = factCrmReceived;
  const factSpend = factFromDaily.spend;
  const factCpl = factCrmReceived > 0 ? factSpend / factCrmReceived : 0;
  const crLeadJoin =
    factCrmReceived > 0 ? (factJoins / factCrmReceived) * 100 : 0;
  const crJoinSale =
    factJoins > 0 ? (factSales / factJoins) * 100 : 0;
  const crLeadDiagnostic =
    factCrmReceived > 0 ? (factConductedVisits / factCrmReceived) * 100 : 0;
  const crDiagnosticSale =
    factConductedVisits > 0 ? (factSales / factConductedVisits) * 100 : 0;

  const daysWithData = useMemo(
    () =>
      monthDays.filter(({ iso }) => {
        const d = dailyMap.get(iso);
        if (!d) return false;
        return (
          d.spend > 0 ||
          d.leads > 0 ||
          d.crmReceived > 0 ||
          (d.joins ?? 0) > 0 ||
          (d.plannedVisits ?? 0) > 0 ||
          (d.conductedVisits ?? 0) > 0 ||
          (d.diagnosticsPaid ?? 0) > 0 ||
          d.sales > 0 ||
          (d.crmRevenue ?? 0) > 0 ||
          d.cashRevenue > 0 ||
          (d.prepayCount ?? 0) > 0
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
      "Затраты", "Лиды Meta", "Лиды CRM", "CPL CRM", "Вступлений", "Записано", "Диагностики",
      "Предоплат", "Сумма предоплат", "Оплачено диагностик", "Сумма диагностик",
      "Продажи", "Выручка продаж", "Касса", "Сумма",
    ];
    const rows = monthDays.map(({ day, iso, weekday }) => {
      const d = dailyMap.get(iso);
      const crmLeads = d?.crmReceived ?? 0;
      const cplCrm = d && crmLeads > 0 ? d.spend / crmLeads : 0;
      return [
        iso,
        `${String(day).padStart(2, "0")} ${weekday}`,
        d?.spend ?? 0,
        d?.leads ?? 0,
        crmLeads,
        cplCrm ? Math.round(cplCrm) : "",
        d?.joins ?? 0,
        d?.plannedVisits ?? 0,
        d?.conductedVisits ?? 0,
        d?.prepayCount ?? 0,
        d?.prepaySum ?? 0,
        d?.diagnosticsPaid ?? 0,
        d?.diagnosticRevenue ?? d?.diagnosticRevenuePaid ?? 0,
        d?.sales ?? 0,
        d?.salesRevenue ?? 0,
        d?.cashRevenue ?? 0,
        d?.crmRevenue ?? 0,
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
      const since = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}-01`;
      const until = ymdAlmaty();
      const targetCab = cabinetId !== "all"
        ? cabinets.find((c) => c.id === cabinetId)
        : null;
      const daily = await syncMetaDaily({
        since,
        until,
        ...(targetCab ? { cabinet_id: targetCab.id } : {}),
      });
      const messages = formatMetaSyncMessages({
        daily,
        structure: { kind: "structure", ok: true, results: [] },
      });
      if (messages.success) toast.success(messages.success);
      for (const warning of messages.warnings) toast.warning(warning);
      if (messages.error) toast.error(messages.error);
      const okRows = (daily.results ?? []).filter((r) => r.ok);
      const syncedDays = okRows.reduce((s, r) => s + (r.days ?? 0), 0);
      const syncedLeads = okRows.reduce((s, r) => s + (r.leads ?? 0), 0);
      const now = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      if (messages.error) {
        setLastSyncStatus({
          kind: "error",
          text: messages.error,
          at: now,
        });
      } else if (!okRows.length) {
        setLastSyncStatus({
          kind: "warning",
          text: "Meta ответила без новых данных за выбранный период",
          at: now,
        });
      } else {
        setLastSyncStatus({
          kind: "success",
          text: `Обновлено: ${okRows.length} каб., ${syncedDays} дн., ${syncedLeads} лидов`,
          at: now,
        });
      }
      refresh();
      setCdiTick((t) => t + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось синхронизировать";
      toast.error(msg);
      const now = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      setLastSyncStatus({
        kind: "error",
        text: msg,
        at: now,
      });
    } finally {
      setResyncing(false);
    }
  };

  const upsertManualFact = async (
    isoDate: string,
    patch: {
      manual_spend?: number | null;
      manual_leads?: number | null;
      manual_diagnostics?: number | null;
      manual_sales?: number | null;
      manual_revenue?: number | null;
      manual_diagnostic_revenue?: number | null;
      manual_crm_received?: number | null;
      manual_qualified?: number | null;
      manual_planned_visits?: number | null;
      manual_conducted_visits?: number | null;
      manual_diagnostics_paid?: number | null;
      manual_cash?: number | null;
    },
  ) => {
    if (useProjectOverrides) {
      await saveProjectManual(isoDate, patch);
      return;
    }
    if (!manualCabinet?.externalId) {
      toast.error("Подключи рекламный кабинет с Ad Account ID");
      return;
    }

    const cleanPatch = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [
        key,
        value === null ? null : Math.max(0, Number(value) || 0),
      ]),
    );

    const legacyAdPatch = (p: Record<string, unknown>): Record<string, unknown> => {
      const out = { ...p };
      if (out.manual_spend !== undefined && out.manual_spend !== null) {
        out.spend = out.manual_spend;
        delete out.manual_spend;
      }
      if (out.manual_leads !== undefined && out.manual_leads !== null) {
        out.leads = out.manual_leads;
        delete out.manual_leads;
      }
      return out;
    };

    try {
      const { data: existing, error: findError } = await supabase
        .from("cabinet_daily_insights")
        .select("id")
        .eq("cabinet_id", manualCabinet.id)
        .eq("date", isoDate)
        .maybeSingle();
      if (findError) throw findError;

      const writeRow = async (rowPatch: Record<string, unknown>) => {
        if (existing?.id) {
          const { error: updateError } = await (supabase as any)
            .from("cabinet_daily_insights")
            .update(rowPatch)
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
              ...rowPatch,
            });
          if (insertError) throw insertError;
        }
      };

      try {
        await writeRow(cleanPatch);
      } catch (writeErr) {
        const msg = writeErr instanceof Error ? writeErr.message : "";
        if (/manual_spend|manual_leads/i.test(msg)) {
          await writeRow(legacyAdPatch(cleanPatch));
        } else {
          throw writeErr;
        }
      }

      refresh();
      setCdiTick((t) => t + 1);
      toast.success("Ручной факт сохранен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить факт");
    }
  };

  const saveProjectManual = async (isoDate: string, patch: RnpManualPatch) => {
    if (rnpTableMissing) {
      toast.error("Примени миграцию rnp_daily в Supabase");
      return;
    }
    try {
      await upsertRnpManual(isoDate, patch);
      setProjectTick((t) => t + 1);
      toast.success("Ручной факт сохранен");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
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
        factRevenue={factRevenue}
        factSpend={factSpend}
        factMetaLeads={factMetaLeads}
        factCrmReceived={factLeads}
        factJoins={factJoins}
        factPlannedVisits={factPlannedVisits}
        factConductedVisits={factConductedVisits}
        factDiagnosticsPaid={factDiagnosticsPaid}
        factSales={factSales}
        factCpl={factCpl}
        crLeadJoin={crLeadJoin}
        crJoinSale={crJoinSale}
        crLeadDiagnostic={crLeadDiagnostic}
        crDiagnosticSale={crDiagnosticSale}
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
              onClick={() => setTableMode("business")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                tableMode === "business" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Бизнес вид
            </button>
            <button
              type="button"
              onClick={() => setTableMode("detailed")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                tableMode === "detailed" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Детально
            </button>
          </div>
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

      {tableMode === "detailed" && canEditManual && editScope && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{manualHint}</span>
        </div>
      )}

      {!hasMetaConnectedCabinets && (
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Meta данные не подтягиваются</div>
            <div className="mt-0.5 text-xs opacity-90">
              В личных кабинетах не заполнен Ad Account ID (`act_...`), поэтому колонки «Затраты / Передано» пустые.
              Откройте «Управление рекламой» и укажите внешний ID кабинета Meta.
            </div>
          </div>
        </div>
      )}

      {lastSyncStatus && (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
            lastSyncStatus.kind === "success" && "border-success/25 bg-success/5 text-success",
            lastSyncStatus.kind === "warning" && "border-warning/25 bg-warning/5 text-warning",
            lastSyncStatus.kind === "error" && "border-destructive/25 bg-destructive/5 text-destructive",
          )}
        >
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Последняя синхронизация ({lastSyncStatus.at}): {lastSyncStatus.text}
          </span>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Не удалось загрузить статистику</div>
            <div className="mt-0.5 text-xs opacity-90">{error}</div>
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

      <div className="mt-4">
        <MetricsDataTable
          mode={tableMode}
          monthDays={monthDays}
          visibleDays={visibleDays}
          dailyMap={dailyMap}
          loading={loading}
          loadingLabel={`Загружаем данные за ${MONTHS_GEN_RU[monthCursor.getMonth()]} ${monthCursor.getFullYear()}...`}
          canEdit={Boolean(editScope) && canEditManual}
          rnpEditDisabled={rnpTableMissing}
          onSaveSpend={(iso, next) => upsertManualFact(iso, { manual_spend: next })}
          onSaveLeads={(iso, next) => upsertManualFact(iso, { manual_leads: next })}
          onSaveCrmReceived={(iso, next) => saveProjectManual(iso, { manual_crm_received: next })}
          onSaveQualified={(iso, next) => saveProjectManual(iso, { manual_qualified: next })}
          onSavePlannedVisits={(iso, next) => saveProjectManual(iso, { manual_planned_visits: next })}
          onSaveConductedVisits={(iso, next) => saveProjectManual(iso, { manual_conducted_visits: next })}
          onSaveDiagnosticsPaid={(iso, next) => saveProjectManual(iso, { manual_diagnostics_paid: next })}
          onSaveDiagnosticRevenue={(iso, next) =>
            upsertManualFact(iso, { manual_diagnostic_revenue: next })
          }
          onSaveSales={(iso, next) => upsertManualFact(iso, { manual_sales: next })}
          onSaveSalesRevenue={(iso, next) => upsertManualFact(iso, { manual_revenue: next })}
          onSaveCash={(iso, next) => saveProjectManual(iso, { manual_cash: next })}
          onSavePrepayCount={(iso, next) => saveProjectManual(iso, { prepayments_count: next ?? 0 })}
          onSavePrepaySum={(iso, next) => saveProjectManual(iso, { prepayments_sum: next ?? 0 })}
        />
      </div>
    </PageContainer>
  );
};

export default Metrics;
