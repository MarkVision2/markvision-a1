import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  DollarSign,
  Download,
  Eye,
  Loader2,
  Pencil,
  RefreshCw,
  Repeat,
  Save,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { PeriodPicker, monthRange } from "@/components/dashboard/PeriodPicker";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useMultiMetaInsights, type DailyInsightRow } from "@/hooks/useMetaInsights";
import { useFinancePlans, monthKey } from "@/hooks/useFinancePlan";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { isLeadPaid } from "@/lib/leadStageFlags";
import { crmDailyMetrics, type ReportPeriodRange } from "@/hooks/useReportData";
import { isManualOverrideActive, manualValueForSave, resolveCdiMetric } from "@/lib/cdiManualOverride";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AdCabinet } from "@/types/ads";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

const MONTHS_GEN_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const WEEKDAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const formatTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const formatNumber = (n: number) => Math.round(n).toLocaleString("ru-RU");
const formatPercent = (n: number) => `${n.toFixed(0)}%`;

interface SummaryCardProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  formula: string;
  badge: string;
  accent?: "success" | "warning" | "primary";
}

const SummaryCard = ({
  icon: Icon,
  label,
  value,
  formula,
  badge,
  accent = "success",
}: SummaryCardProps) => {
  const tone = {
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    primary: "bg-primary/10 text-primary border-primary/20",
  }[accent];

  return (
    <div className="flex min-h-[118px] flex-col rounded-2xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-success/30 hover:bg-card/80">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg border", tone)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider", tone)}>
          {badge}
        </span>
      </div>
      <p className="mt-2.5 text-xs font-semibold leading-snug text-foreground">
        {label}
      </p>
      <div className="mt-2 text-lg font-bold tabular-nums leading-tight sm:text-xl">
        {value}
      </div>
      <p className="mt-auto pt-1.5 text-[10px] leading-4 text-muted-foreground">
        {formula}
      </p>
    </div>
  );
};

const Cell = ({ children, mono = true }: { children: React.ReactNode; mono?: boolean }) => (
  <td
    className={cn(
      "px-2 py-2 text-right text-xs",
      mono && "tabular-nums",
    )}
  >
    {children}
  </td>
);

const Dash = () => <span className="text-muted-foreground/50">—</span>;

const Metrics = () => {
  const [period, setPeriod] = useState<ReportPeriodRange>(() => monthRange(new Date()));
  const monthCursor = period.from;
  const [cabinetId, setCabinetId] = useState<string>("all");
  const { cabinets } = usePersonalCabinets();
  const [resyncing, setResyncing] = useState(false);

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

  const crmByDay = useMemo(
    () => crmDailyMetrics(allLeads, crmPeriod, cabinetSelector),
    [allLeads, crmPeriod, cabinetSelector],
  );

  const canEditManual = cabinetId !== "all" || cabinetsWithExternalId.length === 1;
  const orphanPaid = useMemo(() => {
    if (cabinetId !== "all") return [];
    return allLeads.filter((l) => {
      if (l.cabinetId) return false;
      if (!isLeadPaid(l)) return false;
      const ref = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(ref).getTime();
      return t >= monthStartTs && t < monthEndTs;
    });
  }, [allLeads, cabinetId, monthStartTs, monthEndTs]);
  const orphanSalesCount = orphanPaid.length;
  const orphanRevenue = orphanPaid.reduce((s, l) => s + (l.amount || 0), 0);

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

      const manualDiagRaw = canEditManual ? cdi.manualDiagnosticsRaw : null;
      const manualDiagRevRaw = canEditManual ? cdi.manualDiagnosticRevenueRaw : null;
      const manualSalesRaw = canEditManual ? cdi.manualSalesRaw : null;
      const manualSalesRevRaw = canEditManual ? cdi.manualSalesRevenueRaw : null;

      const diagnostics = resolveCdiMetric(manualDiagRaw, crmDiag);
      const diagnosticRevenue = resolveCdiMetric(manualDiagRevRaw, crmDiagRev);
      const sales = resolveCdiMetric(manualSalesRaw, crmSales);
      const salesRevenue = resolveCdiMetric(manualSalesRevRaw, crmSalesRev);

      m.set(iso, {
        ...cdi,
        crmDiagnostics: crmDiag,
        crmDiagnosticRevenue: crmDiagRev,
        crmSales,
        crmSalesRevenueOnly: crmSalesRev,
        diagnostics,
        diagnosticRevenue,
        sales,
        salesRevenue,
        manualDiagnostics: isManualOverrideActive(manualDiagRaw) ? Number(manualDiagRaw) : 0,
        manualDiagnosticRevenue: isManualOverrideActive(manualDiagRevRaw) ? Number(manualDiagRevRaw) : 0,
        manualSales: isManualOverrideActive(manualSalesRaw) ? Number(manualSalesRaw) : 0,
        manualSalesRevenue: isManualOverrideActive(manualSalesRevRaw) ? Number(manualSalesRevRaw) : 0,
        crmRevenue: salesRevenue + diagnosticRevenue,
        crmRevenueOnly: crmSalesRev + crmDiagRev,
        manualDiagnosticsRaw: manualDiagRaw,
        manualDiagnosticRevenueRaw: manualDiagRevRaw,
        manualSalesRaw,
        manualSalesRevenueRaw: manualSalesRevRaw,
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
  }, [data, monthDays, crmByDay, canEditManual, orphanThisMonth]);

  // ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ: CDI (кабинеты) + orphan CRM (лиды без cabinet_id).
  // Раньше orphan исключали, чтобы избежать задвоения с manual_sales — но manual
  // привязан к конкретному кабинету+дате, а orphan лиды имеют cabinet_id=NULL, поэтому
  // они никогда не пересекаются. Включаем orphan в итоги, иначе цифры на Metrics
  // отличаются от CRM/Analytics/Dashboard (одна и та же продажа выглядит как «3/2/2»).
  const factDiagnostics = useMemo(
    () => monthDays.reduce((sum, { iso }) => sum + (dailyMap.get(iso)?.diagnostics ?? 0), 0),
    [monthDays, dailyMap],
  );
  const factDiagnosticRevenue = useMemo(
    () => monthDays.reduce((sum, { iso }) => sum + (dailyMap.get(iso)?.diagnosticRevenue ?? 0), 0),
    [monthDays, dailyMap],
  );
  const factSales = useMemo(
    () => monthDays.reduce((sum, { iso }) => sum + (dailyMap.get(iso)?.sales ?? 0), 0),
    [monthDays, dailyMap],
  );
  const factSalesRevenue = useMemo(
    () => monthDays.reduce((sum, { iso }) => sum + (dailyMap.get(iso)?.salesRevenue ?? 0), 0),
    [monthDays, dailyMap],
  );
  const factRevenue = factSalesRevenue + factDiagnosticRevenue;
  const factLeads = (totals?.leads ?? 0) + orphanThisMonth.length;
  const factCac = factSales > 0 ? (totals?.spend ?? 0) / factSales : 0;
  const factCpd = factDiagnostics > 0 ? (totals?.spend ?? 0) / factDiagnostics : 0;
  const crLeadDiagnostics =
    factLeads > 0 ? (factDiagnostics / factLeads) * 100 : 0;
  const crDiagnosticsSale =
    factDiagnostics > 0 ? (factSales / factDiagnostics) * 100 : 0;

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
        description={`${filledDays} дней с данными из ${daysInMonth}`}
        meta={
          <div className="hidden min-w-[180px] flex-col gap-1 sm:flex">
            <Progress value={monthProgress} className="h-2" />
            <span className="text-right text-[11px] font-medium text-success">
              {monthProgress}% месяца
            </span>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="mt-8 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <SummaryCard
          icon={Eye}
          label="Стоимость диагностики"
          badge="CPD"
          accent="success"
          value={factCpd > 0 ? formatTenge(factCpd) : <Dash />}
          formula="Расходы / диагностики"
        />
        <SummaryCard
          icon={Wallet}
          label="Стоимость клиента"
          badge="CAC"
          accent="warning"
          value={factCac > 0 ? formatTenge(factCac) : <Dash />}
          formula="Расходы / оплаты"
        />
        <SummaryCard
          icon={DollarSign}
          label="Стоимость заявки"
          badge="CPL"
          accent="primary"
          value={
            totals && totals.cpl > 0 ? (
              <span>{formatTenge(totals.cpl)}</span>
            ) : (
              <Dash />
            )
          }
          formula="Расходы / заявки"
        />
        <SummaryCard
          icon={Repeat}
          label="Лид в диагностику"
          badge="CR"
          accent="success"
          value={crLeadDiagnostics > 0 ? <span>{formatPercent(crLeadDiagnostics)}</span> : <Dash />}
          formula="Диагностики / лиды"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Диагностика в продажу"
          badge="CR"
          accent="success"
          value={crDiagnosticsSale > 0 ? <span>{formatPercent(crDiagnosticsSale)}</span> : <Dash />}
          formula="Оплаты / диагностики"
        />
      </div>

      {/* Диагностика источников выручки: чтобы было видно, из чего складывается factRevenue.
          Помогает понять, если сумма не сходится с CRM (например, в orphan лежат старые/тестовые лиды). */}
      <div className="mt-6 grid gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Из рекламных кабинетов (CDI)
          </div>
          <div className="mt-1.5 text-lg font-bold tabular-nums">{formatTenge(totals?.crmRevenue ?? 0)}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {totals?.sales ?? 0} оплат · авто-синк из CRM + ручной факт
          </div>
        </div>
        <div className={cn(
          "rounded-xl border p-3",
          orphanRevenue > 0 ? "border-warning/30 bg-warning/5" : "border-border/40 bg-background/40",
        )}>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            CRM без привязки к кабинету
          </div>
          <div className="mt-1.5 text-lg font-bold tabular-nums">{formatTenge(orphanRevenue)}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {orphanSalesCount} оплат · учтены в Итого
            {orphanRevenue > 0 && cabinetId === "all" && (
              <div className="mt-1 text-warning">⚠ Привяжи лида к кабинету в CRM, чтобы атрибутировать продажу к источнику рекламы</div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-success/30 bg-success/5 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-success">
            Итого (источник правды)
          </div>
          <div className="mt-1.5 text-lg font-bold tabular-nums text-success">{formatTenge(factRevenue)}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {factSales} оплат · CDI + orphan CRM (1:1 с Dashboard и Analytics)
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-success/20 bg-success/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/15 text-success">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold">Единый ручной факт</div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                Редактируй диагностики, оплаты и сумму прямо в дневных строках. Ручное значение ПЕРЕЗАПИСЫВАЕТ авто-данные из CRM за этот день (если поле пустое — берётся факт из CRM). Так цифры в отчётах всегда совпадают с реальностью.
              </p>
            </div>
          </div>
          <div className={cn(
            "rounded-xl border px-3 py-2 text-xs font-medium",
            manualCabinet
              ? "border-success/30 bg-success/10 text-success"
              : "border-warning/30 bg-warning/10 text-warning",
          )}>
            {manualHint}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker range={period} onChange={setPeriod} />

          <Select value={cabinetId} onValueChange={setCabinetId}>
            <SelectTrigger className="h-12 min-w-[220px] rounded-2xl border-border/60 bg-card/60">
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

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {plan ? "План задан" : "План не задан"}
          </span>
          <Button
            variant="outline"
            className="h-12 gap-2 rounded-2xl border-border/60"
            onClick={handleResync}
            disabled={resyncing || actIds.length === 0}
            title="Перетянуть данные с 1 числа выбранного месяца"
          >
            {resyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Пересинхронизировать
          </Button>
          <Button
            variant="outline"
            className="h-12 gap-2 rounded-2xl border-border/60"
            onClick={handleExportCsv}
          >
            <Download className="h-4 w-4" />
            Экспорт CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Не удалось загрузить статистику</div>
            <div className="mt-0.5 text-xs opacity-90">{error}</div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[78px]" />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-border/60 bg-card/60">
              <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Дата
              </th>
              {[
                "Расходы", "Лиды", "CPL",
                "Диагностики", "Опл. диагн. ₸",
                "Продажи", "Выр. продаж ₸", "Итого ₸",
              ].map((h) => (
                <th
                  key={h}
                  className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
            <tbody>
              {/* Plan row */}
              <tr className="border-b border-border/60">
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-success/10 text-success">
                      <Target className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-success">
                      План
                    </span>
                  </div>
                </td>
                <Cell>{plan ? formatNumber(plan.spend) : <Dash />}</Cell>
                <Cell>{plan ? formatNumber(plan.leads) : <Dash />}</Cell>
                <Cell>{plan ? formatNumber(plan.cpl) : <Dash />}</Cell>
                <Cell>{plan ? formatNumber(plan.visits) : <Dash />}</Cell>
                <Cell><Dash /></Cell>
                <Cell>{plan ? formatNumber(plan.sales) : <Dash />}</Cell>
                <Cell><Dash /></Cell>
                <Cell>{plan ? formatNumber(plan.revenue) : <Dash />}</Cell>
              </tr>

              {/* Fact row */}
              <tr className="border-b border-border/60 bg-card/30">
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                      <BarChart3 className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Факт
                    </span>
                  </div>
                </td>
                <Cell>
                  <span className="font-bold">
                    {totals ? formatNumber(totals.spend) : <Dash />}
                  </span>
                </Cell>
                <Cell>
                  <span className="font-bold text-success">
                    {factLeads > 0 ? formatNumber(factLeads) : <Dash />}
                  </span>
                </Cell>
                <Cell>
                  <span className="font-bold">
                    {totals && totals.cpl > 0 ? formatNumber(totals.cpl) : <Dash />}
                  </span>
                </Cell>
                <Cell>
                  <span className="font-bold">
                    {factDiagnostics > 0 ? formatNumber(factDiagnostics) : <Dash />}
                  </span>
                </Cell>
                <Cell>
                  <span className="font-bold">
                    {factDiagnosticRevenue > 0 ? formatNumber(factDiagnosticRevenue) : <Dash />}
                  </span>
                </Cell>
                <Cell>
                  <span className="font-bold">
                    {factSales > 0 ? formatNumber(factSales) : <Dash />}
                  </span>
                </Cell>
                <Cell>
                  <span className="font-bold">
                    {factSalesRevenue > 0 ? formatNumber(factSalesRevenue) : <Dash />}
                  </span>
                </Cell>
                <Cell>
                  <span className="font-bold text-success">
                    {factRevenue > 0 ? formatNumber(factRevenue) : <Dash />}
                  </span>
                </Cell>
              </tr>

              {/* % completion row */}
              <tr className="border-b border-border/60">
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-warning/15 text-warning">
                      <TrendingUp className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-warning">
                      % выполн.
                    </span>
                  </div>
                </td>
                {(() => {
                  const pct = (fact: number, p: number) =>
                    plan && p > 0 ? `${Math.round((fact / p) * 100)}%` : null;
                  const factSpend = totals?.spend ?? 0;
                  const cells = [
                    pct(factSpend, plan?.spend ?? 0),
                    pct(factLeads, plan?.leads ?? 0),
                    null,
                    pct(factDiagnostics, plan?.visits ?? 0),
                    null,
                    pct(factSales, plan?.sales ?? 0),
                    null,
                    pct(factRevenue, plan?.revenue ?? 0),
                  ];
                  return cells.map((v, i) => (
                    <Cell key={i}>
                      {v ? <span className="font-semibold text-warning">{v}</span> : <Dash />}
                    </Cell>
                  ));
                })()}
              </tr>

              {/* Days */}
              {monthDays.map(({ day, iso, weekday }) => {
                const d = dailyMap.get(iso);
                const cpl = d && d.leads > 0 ? d.spend / d.leads : 0;
                // d.crmRevenue теперь уже override-aware (manual если задан, иначе CRM).
                // FB pixel revenue (d.revenue) больше не используем — это атрибуционный сигнал, а не реальные деньги.
                const dayRevenue = d?.crmRevenue ?? 0;
                const hasData = !!d && (
                  d.spend > 0 ||
                  d.leads > 0 ||
                  d.impressions > 0 ||
                  d.diagnostics > 0 ||
                  d.sales > 0 ||
                  dayRevenue > 0
                );
                return (
                  <tr
                    key={iso}
                    className="border-b border-border/30 transition-colors hover:bg-card/40"
                  >
                    <td className="px-2 py-2 text-xs">
                      <span className="font-medium tabular-nums">
                        {String(day).padStart(2, "0")}
                      </span>
                      <span className="ml-1 text-muted-foreground">{weekday}</span>
                    </td>
                    <Cell>{hasData ? formatNumber(d!.spend) : <Dash />}</Cell>
                    <Cell>{hasData && d!.leads > 0 ? formatNumber(d!.leads) : <Dash />}</Cell>
                    <Cell>{cpl > 0 ? formatNumber(cpl) : <Dash />}</Cell>
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
                        disabled={!manualCabinet || !canEditManual}
                        onSave={(next) => upsertManualFact(iso, { manual_diagnostics: next })}
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
                        disabled={!manualCabinet || !canEditManual}
                        format={formatNumber}
                        allowDecimal
                        onSave={(next) => upsertManualFact(iso, { manual_diagnostic_revenue: next })}
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
                        disabled={!manualCabinet || !canEditManual}
                        onSave={(next) => upsertManualFact(iso, { manual_sales: next })}
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
                        disabled={!manualCabinet || !canEditManual}
                        format={formatNumber}
                        allowDecimal
                        onSave={(next) => upsertManualFact(iso, { manual_revenue: next })}
                      />
                    </Cell>
                    <Cell>
                      <span className="font-semibold tabular-nums text-success">
                        {dayRevenue > 0 ? formatNumber(dayRevenue) : <Dash />}
                      </span>
                    </Cell>
                  </tr>
                );
              })}
          </tbody>
        </table>

        {loading && (
          <div className="flex items-center justify-center gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Загружаем данные за {MONTHS_GEN_RU[monthCursor.getMonth()]} {monthCursor.getFullYear()}...
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Расходы и лиды — из Meta. Диагностики, продажи и выручка — из CRM (карточки воронки), с возможностью ручной корректировки по дням для выбранного кабинета.
      </p>
    </PageContainer>
  );
};

const ManualFactCell = ({
  title,
  icon: Icon,
  isoDate,
  value,
  crm,
  manual,
  manualRaw,
  autoLabel,
  onSave,
  disabled,
  format = formatNumber,
  allowDecimal,
}: {
  title: string;
  icon: React.ElementType;
  isoDate: string;
  /** Итоговое значение, которое реально показывается (override-aware). */
  value: number;
  /** Чистое CRM значение, БЕЗ применения override. Нужно, чтобы попап показал "Из CRM: N" корректно. */
  crm: number;
  manual: number;
  manualRaw?: number | null;
  autoLabel: string;
  onSave: (newManual: number | null) => Promise<void>;
  disabled?: boolean;
  format?: (n: number) => string;
  allowDecimal?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const hasManualOverride = isManualOverrideActive(manualRaw);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const auto = Math.max(0, crm);
  const hasValue = value > 0;

  const handleSave = async () => {
    const next = manualValueForSave(val);
    setSaving(true);
    try {
      await onSave(next);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await onSave(null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (disabled) {
    return (
      <span className="inline-flex min-w-0 w-full justify-end text-muted-foreground/50">
        {hasValue ? format(value) : "—"}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) setVal(hasManualOverride ? String(manualRaw ?? manual) : "");
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex min-w-0 w-full items-center justify-end gap-1.5 rounded-lg border border-transparent px-2 py-1 text-right transition-colors hover:border-success/30 hover:bg-success/10",
            !hasValue && "text-muted-foreground",
            hasManualOverride && "border-success/20 bg-success/5 text-success",
          )}
          title={`${title}: ${isoDate}`}
        >
          <span className="font-semibold tabular-nums">{hasValue ? format(value) : "—"}</span>
          <Pencil className="h-3 w-3 opacity-45 transition-opacity group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 rounded-2xl border-border/70" align="end">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/10 text-success">
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-muted-foreground">{isoDate}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-border/60 bg-card/60 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{autoLabel}</div>
              <div className="mt-1 text-sm font-bold tabular-nums">{format(auto)}</div>
            </div>
            <div className="rounded-xl border border-success/25 bg-success/10 p-2">
              <div className="text-[10px] uppercase tracking-wider text-success">Вручную</div>
              <div className="mt-1 text-sm font-bold tabular-nums text-success">{format(manual)}</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/60 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Показано</div>
              <div className="mt-1 text-sm font-bold tabular-nums">{format(value)}</div>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            «Из CRM» — реальные карточки воронки. Ручное значение перезаписывает день. Пустое поле или «Сбросить» — снова авто из CRM.
          </p>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Ввести ручное значение
            </label>
            <Input
              type="number"
              min={0}
              step={allowDecimal ? "0.01" : "1"}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder="0"
              className="h-11 rounded-xl text-right text-base font-semibold tabular-nums"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => void handleReset()} disabled={saving}>
              Сбросить к CRM
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button size="sm" className="gap-2" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Сохранить
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default Metrics;
