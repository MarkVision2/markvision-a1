import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
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
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useMultiMetaInsights, type DailyInsightRow } from "@/hooks/useMetaInsights";
import { useFinancePlans, monthKey } from "@/hooks/useFinancePlan";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AdCabinet } from "@/types/ads";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
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
    <div className="min-h-[168px] rounded-2xl border border-border/60 bg-card/60 p-5 transition-colors hover:border-success/30 hover:bg-card/80">
      <div className="flex items-start justify-between gap-3">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border", tone)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className={cn("rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider", tone)}>
          {badge}
        </span>
      </div>
      <div className="mt-5 min-h-[42px] text-[15px] font-bold leading-5 text-foreground">
        {label}
      </div>
      <div className="mt-4 text-3xl font-bold leading-none tabular-nums text-foreground md:text-[2rem]">
        {value}
      </div>
      <div className="mt-3 text-xs leading-4 text-muted-foreground">
        {formula}
      </div>
    </div>
  );
};

const Cell = ({ children, mono = true }: { children: React.ReactNode; mono?: boolean }) => (
  <td
    className={cn(
      "px-3 py-3 text-right text-sm",
      mono && "tabular-nums",
    )}
  >
    {children}
  </td>
);

const Dash = () => <span className="text-muted-foreground/50">—</span>;

const Metrics = () => {
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [cabinetId, setCabinetId] = useState<string>("all");
  const { cabinets } = usePersonalCabinets();
  const [resyncing, setResyncing] = useState(false);

  const shiftMonth = (delta: number) =>
    setMonthCursor(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1),
    );

  const monthLabel = `${MONTHS_RU[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`;
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
    ? `Ручной факт пишется в кабинет «${manualCabinet.name}»`
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
  const dailyMap = useMemo(() => {
    const m = new Map<string, DailyInsightRow>();
    for (const d of data?.daily ?? []) m.set(d.date, d);
    return m;
  }, [data]);

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
  const factDiagnostics = totals?.diagnostics ?? 0;
  const factSales = totals?.sales ?? 0;
  const factRevenue = totals?.crmRevenue || totals?.revenue || 0;
  const factCac = factSales > 0 ? (totals?.spend ?? 0) / factSales : 0;
  const factCpd = factDiagnostics > 0 ? (totals?.spend ?? 0) / factDiagnostics : 0;
  const crLeadDiagnostics =
    totals && totals.leads > 0 ? (factDiagnostics / totals.leads) * 100 : 0;
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
        d?.crmRevenue || d?.revenue || 0,
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
      manual_diagnostics?: number;
      manual_sales?: number;
      manual_revenue?: number;
    },
  ) => {
    if (!manualCabinet?.externalId) {
      toast.error("Выбери конкретный кабинет для ручного ввода");
      return;
    }

    const cleanPatch = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]),
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
    <main className="container max-w-[1500px] py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success">
            <CalendarDays className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Таблица показателей
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {filledDays} дней с данными из {daysInMonth}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden min-w-[180px] flex-col gap-1 sm:flex">
            <Progress value={monthProgress} className="h-2" />
            <span className="text-right text-[11px] font-medium text-success">
              {monthProgress}% месяца
            </span>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
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

      <div className="mt-6 rounded-2xl border border-success/20 bg-success/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/15 text-success">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold">Единый ручной факт</div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                Редактируй диагностики, оплаты и сумму прямо в дневных строках. Эти значения складываются с CRM и сразу попадают в сквозную аналитику, рекламный кабинет и сводку этой таблицы.
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
          <div className="flex items-center gap-1 rounded-2xl border border-border/60 bg-card/60 px-2 py-1.5">
            <button
              onClick={() => shiftMonth(-1)}
              className="grid h-9 w-9 place-items-center rounded-xl hover:bg-secondary"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-sm font-semibold capitalize tabular-nums">
              {monthLabel}
            </span>
            <button
              onClick={() => shiftMonth(1)}
              className="grid h-9 w-9 place-items-center rounded-xl hover:bg-secondary"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-card/60">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Дата
                </th>
                {[
                  "Расходы", "Лиды", "CPL",
                  "Диагностики", "Оплаты", "Выручка",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Plan row */}
              <tr className="border-b border-border/60">
                <td className="px-4 py-3">
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
                <Cell>{plan ? formatNumber(plan.sales) : <Dash />}</Cell>
                <Cell>{plan ? formatNumber(plan.revenue) : <Dash />}</Cell>
              </tr>

              {/* Fact row */}
              <tr className="border-b border-border/60 bg-card/30">
                <td className="px-4 py-3">
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
                    {totals ? formatNumber(totals.leads) : <Dash />}
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
                    {factSales > 0 ? formatNumber(factSales) : <Dash />}
                  </span>
                </Cell>
                <Cell>
                  <span className="font-bold">
                    {factRevenue > 0 ? formatNumber(factRevenue) : <Dash />}
                  </span>
                </Cell>
              </tr>

              {/* % completion row */}
              <tr className="border-b border-border/60">
                <td className="px-4 py-3">
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
                  const factLeads = totals?.leads ?? 0;
                  const cells = [
                    pct(factSpend, plan?.spend ?? 0),
                    pct(factLeads, plan?.leads ?? 0),
                    null,
                    pct(factDiagnostics, plan?.visits ?? 0),
                    pct(factSales, plan?.sales ?? 0),
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
                const dayRevenue = d ? d.crmRevenue || d.revenue : 0;
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
                    <td className="px-4 py-3 text-sm">
                      <span className="font-medium tabular-nums">
                        {String(day).padStart(2, "0")}
                      </span>
                      <span className="ml-2 text-muted-foreground">{weekday}</span>
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
                        manual={d?.manualDiagnostics ?? 0}
                        autoLabel="CRM"
                        disabled={!manualCabinet}
                        onSave={(next) => upsertManualFact(iso, { manual_diagnostics: next })}
                      />
                    </Cell>
                    <Cell>
                      <ManualFactCell
                        title="Оплаты"
                        icon={Wallet}
                        isoDate={iso}
                        value={d?.sales ?? 0}
                        manual={d?.manualSales ?? 0}
                        autoLabel="CRM"
                        disabled={!manualCabinet}
                        onSave={(next) => upsertManualFact(iso, { manual_sales: next })}
                      />
                    </Cell>
                    <Cell>
                      <ManualFactCell
                        title="Сумма оплат"
                        icon={DollarSign}
                        isoDate={iso}
                        value={dayRevenue}
                        manual={d?.manualRevenue ?? 0}
                        autoLabel="CRM"
                        disabled={!manualCabinet}
                        format={formatNumber}
                        allowDecimal
                        onSave={(next) => upsertManualFact(iso, { manual_revenue: next })}
                      />
                    </Cell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Загружаем данные за {monthLabel.toLowerCase()}...
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Данные подгружаются из подключенных личных рекламных кабинетов: расходы и лиды из Meta, диагностики, оплаты и выручка из CRM плюс ручной факт из этой таблицы.
      </p>
    </main>
  );
};

const ManualFactCell = ({
  title,
  icon: Icon,
  isoDate,
  value,
  manual,
  autoLabel,
  onSave,
  disabled,
  format = formatNumber,
  allowDecimal,
}: {
  title: string;
  icon: React.ElementType;
  isoDate: string;
  value: number;
  manual: number;
  autoLabel: string;
  onSave: (newManual: number) => Promise<void>;
  disabled?: boolean;
  format?: (n: number) => string;
  allowDecimal?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(String(manual || ""));
  const [saving, setSaving] = useState(false);
  const auto = Math.max(0, value - manual);
  const hasValue = value > 0;

  const handleSave = async () => {
    const raw = Number(val) || 0;
    const next = allowDecimal ? Math.max(0, raw) : Math.max(0, Math.floor(raw));
    setSaving(true);
    try {
      await onSave(next);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (disabled) {
    return (
      <span className="inline-flex min-w-[86px] justify-end text-muted-foreground/50">
        {hasValue ? format(value) : "—"}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setVal(manual ? String(manual) : ""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex min-w-[86px] items-center justify-end gap-1.5 rounded-lg border border-transparent px-2 py-1 text-right transition-colors hover:border-success/30 hover:bg-success/10",
            !hasValue && "text-muted-foreground",
            manual > 0 && "border-success/20 bg-success/5 text-success",
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
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Итого</div>
              <div className="mt-1 text-sm font-bold tabular-nums">{format(value)}</div>
            </div>
          </div>

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
