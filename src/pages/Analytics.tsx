import { useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Eye,
  GitBranch,
  Inbox,
  Loader2,
  MousePointerClick,
  RefreshCw,
  ShoppingBag,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useMultiMetaInsights } from "@/hooks/useMetaInsights";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { normalizeSource } from "@/lib/leadSource";
import { cn } from "@/lib/utils";

const MONTHS_RU = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const formatTenge = (n: number) =>
  n >= 1000
    ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K $`
    : `${Math.round(n).toLocaleString("ru-RU")} $`;
const formatNumber = (n: number) => Math.round(n).toLocaleString("ru-RU");
const formatPct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;

interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub: string;
  delta?: number | null;
  accent?: boolean;
  emphasized?: boolean;
}

const KpiCard = ({
  icon: Icon,
  label,
  value,
  sub,
  delta,
  accent,
  emphasized,
}: KpiCardProps) => (
  <div
    className={cn(
      "rounded-2xl border border-border/60 bg-card/60 p-5 transition-colors",
      emphasized && "border-success/40 bg-success/5",
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-xl",
            "bg-success/10 text-success",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {delta !== undefined && delta !== null && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
            delta >= 0
              ? "bg-success/15 text-success"
              : "bg-destructive/15 text-destructive",
          )}
        >
          {delta >= 0 ? "+" : ""}
          {Math.round(delta)}%
        </span>
      )}
    </div>
    <div
      className={cn(
        "mt-4 text-2xl font-bold tabular-nums",
        accent && "text-success",
      )}
    >
      {value}
    </div>
    <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
  </div>
);

interface FunnelRowProps {
  label: string;
  value: number;
  base: number;
  prevValue?: number;
  color: string;
}

const FunnelRow = ({ label, value, base, prevValue, color }: FunnelRowProps) => {
  const widthPct = base > 0 ? Math.max((value / base) * 100, value > 0 ? 4 : 0) : 0;
  const conversion =
    prevValue !== undefined && prevValue > 0 ? (value / prevValue) * 100 : null;
  return (
    <div>
      <div className="flex items-end justify-between text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tabular-nums">
            {formatNumber(value)}
          </span>
          {conversion !== null && (
            <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
              {formatPct(conversion)}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-secondary/40">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
};

const Analytics = () => {
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [cabinetId, setCabinetId] = useState<string>("all");
  const { cabinets } = usePersonalCabinets();

  const shiftMonth = (delta: number) =>
    setMonthCursor(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1),
    );

  const monthParam = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = `1 ${MONTHS_RU[monthCursor.getMonth()]}. – ${new Date(
    monthCursor.getFullYear(),
    monthCursor.getMonth() + 1,
    0,
  ).getDate()} ${MONTHS_RU[monthCursor.getMonth()]}. ${monthCursor.getFullYear()}`;

  const allActIds = useMemo(
    () => cabinets.map((c) => c.externalId).filter(Boolean),
    [cabinets],
  );
  const actIds = useMemo(() => {
    if (cabinetId === "all") return allActIds;
    const cab = cabinets.find((c) => c.id === cabinetId);
    return cab?.externalId ? [cab.externalId] : [];
  }, [cabinetId, allActIds, cabinets]);

  const { data, loading, error, refresh } = useMultiMetaInsights(
    actIds,
    monthParam,
    actIds.length > 0,
  );

  const { leads } = useLeadsLite();

  // CRM data filtered to current month
  const monthStart = monthCursor.getTime();
  const monthEnd = new Date(
    monthCursor.getFullYear(),
    monthCursor.getMonth() + 1,
    1,
  ).getTime();
  const monthLeads = useMemo(
    () =>
      leads.filter((l) => {
        const t = new Date(l.createdAt).getTime();
        return t >= monthStart && t < monthEnd;
      }),
    [leads, monthStart, monthEnd],
  );

  const sales = monthLeads.filter((l) => l.stageKey === "paid");
  const visits = monthLeads.filter((l) => l.stageKey === "visit" || l.stageKey === "paid");
  const revenue = sales.reduce((sum, l) => sum + (l.amount || 0), 0);

  // KPI
  const spend = data?.totals.spend ?? 0;
  const adsLeads = data?.totals.leads ?? 0;
  const impressions = data?.totals.impressions ?? 0;
  const clicks = data?.totals.clicks ?? 0;
  const totalLeads = adsLeads + monthLeads.length;
  const cpl = totalLeads > 0 ? spend / totalLeads : 0;
  const romi = spend > 0 ? ((revenue - spend) / spend) * 100 : revenue > 0 ? 100 : -100;

  const crLeadVisit = totalLeads > 0 ? (visits.length / totalLeads) * 100 : 0;
  const crVisitSale = visits.length > 0 ? (sales.length / visits.length) * 100 : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

  // Per-source breakdown — REAL sources from CRM, not mock cabinets.
  // Bucket leads by normalized source key, compute leads/sales/revenue per bucket.
  const channels = useMemo(() => {
    const map = new Map<string, { id: string; name: string; spend: number; leads: number; sales: number; revenue: number }>();
    for (const l of monthLeads) {
      const meta = normalizeSource(l.source);
      const id = meta.key === "unknown" && meta.raw ? meta.raw : meta.key;
      const cur = map.get(id) ?? { id, name: meta.label, spend: 0, leads: 0, sales: 0, revenue: 0 };
      cur.leads += 1;
      if (l.stageKey === "paid") {
        cur.sales += 1;
        cur.revenue += l.amount || 0;
      }
      map.set(id, cur);
    }
    // Attribute ad spend to the "ads" bucket so ROMI per source makes sense.
    if (spend > 0) {
      const adsBucket = map.get("ads") ?? { id: "ads", name: "Реклама", spend: 0, leads: 0, sales: 0, revenue: 0 };
      adsBucket.spend = spend;
      map.set("ads", adsBucket);
    }
    return Array.from(map.values()).sort((a, b) => b.leads - a.leads);
  }, [monthLeads, spend]);

  const funnelBase = Math.max(impressions, clicks, totalLeads, visits.length, sales.length, 1);

  return (
    <main className="container max-w-7xl py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success">
            <Zap className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Сквозная аналитика
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Полная воронка: от показа до продажи
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-2xl border border-border/60 bg-card/60 px-2 py-1.5">
            <button
              onClick={() => shiftMonth(-1)}
              className="grid h-9 w-9 place-items-center rounded-xl hover:bg-secondary"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="flex items-center gap-2 px-3 text-sm font-semibold tabular-nums">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
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
          <button
            onClick={refresh}
            className="grid h-12 w-12 place-items-center rounded-2xl border border-border/60 bg-card/60 hover:bg-secondary"
            aria-label="Обновить"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <Select value={cabinetId} onValueChange={setCabinetId}>
            <SelectTrigger className="h-12 min-w-[200px] rounded-2xl border-border/60 bg-card/60">
              <SelectValue placeholder="Все каналы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все каналы</SelectItem>
              {cabinets.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI grid */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-7">
        <KpiCard
          icon={DollarSign}
          label="Расход"
          value={spend > 0 ? formatTenge(spend) : "0 $"}
          sub="за период"
          delta={spend > 0 ? 100 : null}
        />
        <KpiCard
          icon={Users}
          label="Лиды"
          value={formatNumber(totalLeads)}
          sub={`${monthLeads.length} в CRM`}
          delta={totalLeads > 0 ? 100 : null}
        />
        <KpiCard
          icon={Target}
          label="CPL"
          value={cpl > 0 ? formatTenge(cpl) : "—"}
          sub="стоимость лида"
          accent
          emphasized
        />
        <KpiCard
          icon={Eye}
          label="Визиты"
          value={formatNumber(visits.length)}
          sub={visits.length === 0 ? "нет данных" : `${formatPct(crLeadVisit)} от лидов`}
        />
        <KpiCard
          icon={ShoppingBag}
          label="Продажи"
          value={formatNumber(sales.length)}
          sub={sales.length === 0 ? "нет данных" : `${formatPct(crVisitSale)} конверсия`}
        />
        <KpiCard
          icon={TrendingUp}
          label="Выручка"
          value={revenue > 0 ? formatTenge(revenue) : "0 $"}
          sub={sales.length === 0 ? "нет данных" : `${formatNumber(sales.length)} продаж`}
        />
        <KpiCard
          icon={GitBranch}
          label="ROMI"
          value={
            <span className={romi >= 0 ? "text-success" : "text-destructive"}>
              {romi >= 0 ? "+" : ""}
              {Math.round(romi)}%
            </span>
          }
          sub={spend > 0 ? "возврат инвестиций" : "нет расходов"}
        />
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

      {/* Funnel + Channels */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Funnel */}
        <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">
                Воронка конверсий
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                От охвата до реальных продаж
              </p>
            </div>
            <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
              Live
            </span>
          </div>
          <div className="mt-6 space-y-5">
            <FunnelRow
              label="Показы"
              value={impressions}
              base={funnelBase}
              color="bg-gradient-to-r from-success to-success/60"
            />
            <FunnelRow
              label="Клики"
              value={clicks}
              base={funnelBase}
              prevValue={impressions}
              color="bg-gradient-to-r from-success/80 to-success/40"
            />
            <FunnelRow
              label="Лиды"
              value={totalLeads}
              base={funnelBase}
              prevValue={clicks || impressions}
              color="bg-gradient-to-r from-success/60 to-success/30"
            />
            <FunnelRow
              label="Визиты"
              value={visits.length}
              base={funnelBase}
              prevValue={totalLeads}
              color="bg-gradient-to-r from-primary/70 to-primary/30"
            />
            <FunnelRow
              label="Продажи"
              value={sales.length}
              base={funnelBase}
              prevValue={visits.length}
              color="bg-gradient-to-r from-warning/70 to-warning/30"
            />
          </div>
          {loading && (
            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Обновляем данные...
            </div>
          )}
        </div>

        {/* Channels */}
        <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">
                По каналам
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Распределение расходов и продаж
              </p>
            </div>
          </div>
          {channels.length === 0 ? (
            <div className="mt-10 flex flex-col items-center justify-center gap-3 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary/40 text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </span>
              <div className="text-sm text-muted-foreground">
                Нет данных по каналам
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {channels.map((c) => {
                const romiC =
                  c.spend > 0 ? ((c.revenue - c.spend) / c.spend) * 100 : 0;
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-border/40 bg-card/40 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{c.name}</div>
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                          romiC >= 0
                            ? "bg-success/15 text-success"
                            : "bg-destructive/15 text-destructive",
                        )}
                      >
                        ROMI {romiC >= 0 ? "+" : ""}
                        {Math.round(romiC)}%
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Расход
                        </div>
                        <div className="mt-0.5 font-bold tabular-nums">
                          {formatTenge(c.spend)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Лиды
                        </div>
                        <div className="mt-0.5 font-bold tabular-nums">
                          {formatNumber(c.leads)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Продажи
                        </div>
                        <div className="mt-0.5 font-bold tabular-nums">
                          {formatNumber(c.sales)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Выручка
                        </div>
                        <div className="mt-0.5 font-bold tabular-nums">
                          {formatTenge(c.revenue)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <MousePointerClick className="h-3.5 w-3.5" />
            CTR
          </div>
          <div className="mt-3 text-xl font-bold tabular-nums">
            {ctr > 0 ? formatPct(ctr) : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" />
            CPC
          </div>
          <div className="mt-3 text-xl font-bold tabular-nums">
            {clicks > 0 ? formatTenge(spend / clicks) : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            CPM
          </div>
          <div className="mt-3 text-xl font-bold tabular-nums">
            {impressions > 0 ? formatTenge((spend / impressions) * 1000) : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ShoppingBag className="h-3.5 w-3.5" />
            Средний чек
          </div>
          <div className="mt-3 text-xl font-bold tabular-nums">
            {sales.length > 0 ? formatTenge(revenue / sales.length) : "—"}
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Данные собираются из рекламных кабинетов и CRM за выбранный период.
      </p>
    </main>
  );
};

export default Analytics;
