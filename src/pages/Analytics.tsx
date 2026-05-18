import { useMemo, useState } from "react";
import {
  AlertCircle,
  DollarSign,
  GitBranch,
  Loader2,
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
import { useLeadsLite, type LeadLite } from "@/hooks/useLeadsLite";
import { CHANNELS, resolveChannel, type ChannelKey } from "@/lib/channelAttribution";
import { ChannelCard, type ChannelStat } from "@/components/analytics/ChannelCard";
import { UtmTable, type UtmRow } from "@/components/analytics/UtmTable";
import { TrendChart, type TrendPoint } from "@/components/analytics/TrendChart";
import { PeriodPicker, monthRange } from "@/components/dashboard/PeriodPicker";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";

const MONTHS_RU = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const fmtMoney = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const fmtNumber = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtPct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;

interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub: string;
  delta?: number | null;
  emphasized?: boolean;
}

const KpiCard = ({ icon: Icon, label, value, sub, delta, emphasized }: KpiCardProps) => (
  <div
    className={cn(
      "rounded-2xl border border-border/60 bg-card/60 p-5 transition-colors",
      emphasized && "border-success/40 bg-success/5",
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-success/10 text-success">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {delta !== null && delta !== undefined && Math.abs(delta) > 0.5 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
            delta >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
          )}
        >
          {delta >= 0 ? "+" : ""}
          {Math.round(delta)}%
        </span>
      )}
    </div>
    <div className="mt-4 text-2xl font-bold tabular-nums">{value}</div>
    <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
  </div>
);

interface FunnelRowProps {
  label: string;
  value: number;
  base: number;
  prevValue?: number;
  color: string;
  transition?: string;
}

const FunnelRow = ({ label, value, base, prevValue, color, transition }: FunnelRowProps) => {
  const widthPct = base > 0 ? Math.max((value / base) * 100, value > 0 ? 4 : 0) : 0;
  const conv = prevValue !== undefined && prevValue > 0 ? (value / prevValue) * 100 : null;
  return (
    <div>
      <div className="flex items-end justify-between text-sm">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {transition && (
            <span className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/70">
              {transition}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold tabular-nums">{fmtNumber(value)}</span>
          {conv !== null && (
            <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
              {fmtPct(conv)}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-secondary/40">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  );
};

function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return cur > 0 ? 100 : null;
  return ((cur - prev) / prev) * 100;
}

const Analytics = () => {
  const [period, setPeriod] = useState<ReportPeriodRange>(() => monthRange(new Date()));
  const monthCursor = period.from;
  const [cabinetId, setCabinetId] = useState<string>("all");
  const { cabinets } = usePersonalCabinets();

  const monthParam = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}`;
  const prevCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
  const prevParam = `${prevCursor.getFullYear()}-${String(prevCursor.getMonth() + 1).padStart(2, "0")}`;
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

  const { data, loading, error, refresh } = useMultiMetaInsights(actIds, monthParam, actIds.length > 0);
  const { data: prevData } = useMultiMetaInsights(actIds, prevParam, actIds.length > 0);

  const { leads, loading: leadsLoading, refetch } = useLeadsLite();

  // Filter leads by month
  const monthStart = monthCursor.getTime();
  const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1).getTime();
  const prevStart = prevCursor.getTime();
  const prevEnd = monthStart;

  const monthLeads = useMemo(
    () => leads.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= monthStart && t < monthEnd;
    }),
    [leads, monthStart, monthEnd],
  );
  const prevLeads = useMemo(
    () => leads.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= prevStart && t < prevEnd;
    }),
    [leads, prevStart, prevEnd],
  );

  // Optional cabinet filter on leads
  const filteredLeads = useMemo(() => {
    if (cabinetId === "all") return monthLeads;
    return monthLeads.filter((l) => l.cabinetId === cabinetId);
  }, [monthLeads, cabinetId]);

  const sales = filteredLeads.filter((l) => l.stageKey === "paid");
  const visits = filteredLeads.filter((l) => l.stageKey === "visit" || l.stageKey === "paid");
  const leadCount = data?.totals.leads || filteredLeads.length;
  const diagnosticsCount = data?.totals.diagnostics || visits.length;
  const salesCount = data?.totals.sales || sales.length;
  const revenue = data?.totals.crmRevenue || sales.reduce((sum, l) => sum + (l.amount || 0), 0);

  const prevSales = prevLeads.filter((l) => l.stageKey === "paid");
  const prevRevenue = prevData?.totals.crmRevenue || prevSales.reduce((s, l) => s + (l.amount || 0), 0);

  const spend = data?.totals.spend ?? 0;
  const prevSpend = prevData?.totals.spend ?? 0;
  const adsLeads = data?.totals.leads ?? 0;
  const impressions = data?.totals.impressions ?? 0;
  const clicks = data?.totals.clicks ?? 0;
  const prevTotalLeads = prevData?.totals.leads || prevLeads.length;
  const cpl = leadCount > 0 && spend > 0 ? spend / leadCount : 0;
  const romi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
  const avgCheck = salesCount > 0 ? revenue / salesCount : 0;
  const conversion = leadCount > 0 ? (salesCount / leadCount) * 100 : 0;

  const crLeadVisit = leadCount > 0 ? (diagnosticsCount / leadCount) * 100 : 0;
  const crVisitSale = diagnosticsCount > 0 ? (salesCount / diagnosticsCount) * 100 : 0;

  // Per-channel attribution
  const channels = useMemo<ChannelStat[]>(() => {
    const map = new Map<ChannelKey, ChannelStat>();
    for (const l of filteredLeads) {
      const meta = resolveChannel(l as LeadLite);
      const cur = map.get(meta.key) ?? { meta, spend: 0, leads: 0, sales: 0, revenue: 0 };
      cur.leads += 1;
      if (l.stageKey === "paid") {
        cur.sales += 1;
        cur.revenue += l.amount || 0;
      }
      map.set(meta.key, cur);
    }
    // Attribute Meta ad spend to facebook bucket (extend later for google/tiktok)
    if (spend > 0) {
      const fb = map.get("facebook") ?? { meta: CHANNELS.facebook, spend: 0, leads: 0, sales: 0, revenue: 0 };
      fb.spend += spend;
      fb.leads = Math.max(fb.leads, adsLeads);
      map.set("facebook", fb);
    }
    // Always show core 4 channels even if empty so user sees structure
    for (const k of ["facebook", "google", "tiktok", "instagram"] as ChannelKey[]) {
      if (!map.has(k)) {
        map.set(k, { meta: CHANNELS[k], spend: 0, leads: 0, sales: 0, revenue: 0 });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const order: ChannelKey[] = ["facebook", "instagram", "google", "tiktok", "youtube", "yandex", "vk", "telegram", "whatsapp", "direct", "referral", "other"];
      return order.indexOf(a.meta.key) - order.indexOf(b.meta.key);
    });
  }, [filteredLeads, spend, adsLeads]);

  // UTM campaigns table + AI quality aggregates
  const utmRows = useMemo<UtmRow[]>(() => {
    const map = new Map<string, UtmRow & { _scoreSum: number; _scoreCount: number }>();
    for (const l of filteredLeads) {
      const u = l.utm ?? {};
      if (!u.source && !u.campaign && !u.medium) continue;
      const key = `${u.source ?? ""}|${u.campaign ?? ""}|${u.medium ?? ""}`;
      const cur = map.get(key) ?? {
        source: u.source ?? "",
        campaign: u.campaign ?? "",
        medium: u.medium ?? "",
        leads: 0, sales: 0, revenue: 0,
        avgScore: 0, hotCount: 0, paidCount: 0,
        _scoreSum: 0, _scoreCount: 0,
      };
      cur.leads += 1;
      if (l.stageKey === "paid") {
        cur.sales += 1;
        cur.revenue += l.amount || 0;
        cur.paidCount = (cur.paidCount ?? 0) + 1;
      }
      const score = Number((l as { aiScore?: number }).aiScore ?? 0);
      if (score > 0) {
        cur._scoreSum += score;
        cur._scoreCount += 1;
        if (score >= 75 || l.stageKey === "scheduled" || l.stageKey === "diagnosed") {
          cur.hotCount = (cur.hotCount ?? 0) + 1;
        }
      }
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map(({ _scoreSum, _scoreCount, ...r }) => ({
        ...r,
        avgScore: _scoreCount > 0 ? _scoreSum / _scoreCount : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || (b.avgScore ?? 0) - (a.avgScore ?? 0) || b.leads - a.leads);
  }, [filteredLeads]);

  // Trend data: per day
  const trend = useMemo<TrendPoint[]>(() => {
    const days = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
    const points: TrendPoint[] = [];
    const dailyMap = new Map<string, { spend: number }>();
    for (const d of data?.daily ?? []) {
      dailyMap.set(d.date, { spend: d.spend });
    }
    const leadsByDate = new Map<string, { leads: number; sales: number }>();
    for (const l of filteredLeads) {
      const d = new Date(l.createdAt).toISOString().slice(0, 10);
      const cur = leadsByDate.get(d) ?? { leads: 0, sales: 0 };
      cur.leads += 1;
      if (l.stageKey === "paid") cur.sales += 1;
      leadsByDate.set(d, cur);
    }
    for (let i = 1; i <= days; i++) {
      const iso = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      points.push({
        date: iso,
        spend: Math.round(dailyMap.get(iso)?.spend ?? 0),
        leads: leadsByDate.get(iso)?.leads ?? 0,
        sales: leadsByDate.get(iso)?.sales ?? 0,
      });
    }
    return points;
  }, [data, filteredLeads, monthCursor]);

  const hasLinkedData = actIds.length > 0;
  const hasMonthData = !!data?.daily.length || filteredLeads.length > 0;
  const funnelBase = Math.max(impressions, clicks, leadCount, diagnosticsCount, salesCount, 1);

  return (
    <main className="container max-w-7xl py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success">
            <Zap className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Сквозная аналитика</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              UTM-атрибуция · эффективность каналов · полная воронка
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker range={period} onChange={setPeriod} />
          <button
            onClick={() => { refresh(); refetch(); }}
            className="grid h-12 w-12 place-items-center rounded-2xl border border-border/60 bg-card/60 hover:bg-secondary"
            aria-label="Обновить"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <Select value={cabinetId} onValueChange={setCabinetId}>
            <SelectTrigger className="h-12 min-w-[200px] rounded-2xl border-border/60 bg-card/60">
              <SelectValue placeholder="Все кабинеты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все кабинеты</SelectItem>
              {cabinets.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI grid */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-4">
        <KpiCard icon={DollarSign} label="Расход" value={spend > 0 ? fmtMoney(spend) : "—"} sub="за период" delta={pctDelta(spend, prevSpend)} />
        <KpiCard icon={Users} label="Лиды" value={fmtNumber(leadCount)} sub={adsLeads ? `${adsLeads} из рекламы` : `${filteredLeads.length} в CRM`} delta={pctDelta(leadCount, prevTotalLeads)} />
        <KpiCard icon={Target} label="CPL" value={cpl > 0 ? fmtMoney(cpl) : "—"} sub="стоимость лида" emphasized />
        <KpiCard icon={ShoppingBag} label="Продажи" value={fmtNumber(salesCount)} sub={salesCount > 0 ? fmtPct(conversion) + " конверсия" : "нет продаж"} delta={pctDelta(salesCount, prevData?.totals.sales || prevSales.length)} />
        <KpiCard icon={TrendingUp} label="Выручка" value={revenue > 0 ? fmtMoney(revenue) : "—"} sub={salesCount > 0 ? `${salesCount} продаж` : "нет данных"} delta={pctDelta(revenue, prevRevenue)} />
        <KpiCard icon={GitBranch} label="ROMI" value={romi !== null ? <span className={romi >= 0 ? "text-success" : "text-destructive"}>{romi >= 0 ? "+" : ""}{Math.round(romi)}%</span> : "—"} sub={spend > 0 ? "возврат инвестиций" : "нет расходов"} emphasized />
        <KpiCard icon={Target} label="Средний чек" value={avgCheck > 0 ? fmtMoney(avgCheck) : "—"} sub={salesCount > 0 ? `по ${salesCount} продажам` : "нет продаж"} />
        <KpiCard icon={Zap} label="Конв. лид→визит" value={fmtPct(crLeadVisit)} sub={`визит→продажа ${fmtPct(crVisitSale)}`} />
      </div>

      {!loading && !leadsLoading && !hasMonthData && (
        <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <div className="font-semibold">
            {hasLinkedData ? "За выбранный месяц данных пока нет" : "Нет подключенных личных рекламных кабинетов"}
          </div>
          <div className="mt-1 text-xs opacity-80">
            {hasLinkedData
              ? "Перейдите в «Управление рекламой» и нажмите «Получить статистику» по кабинету или обновите период здесь."
              : "Добавьте личный рекламный кабинет в разделе «Управление рекламой», чтобы сквозная аналитика считалась автоматически."}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Не удалось загрузить статистику</div>
            <div className="mt-0.5 text-xs opacity-90">{error}</div>
          </div>
        </div>
      )}

      {/* Funnel + Trend */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">Воронка конверсий</h2>
              <p className="mt-1 text-xs text-muted-foreground">От охвата до реальных продаж · {monthLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              {clicks > 0 && (
                <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-success">
                  Конверсия сайта: {((leadCount / clicks) * 100).toFixed(1)}%
                </span>
              )}
              <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">Live</span>
            </div>
          </div>
          <div className="mt-6 space-y-5">
            <FunnelRow label="Показы" value={impressions} base={funnelBase} color="bg-gradient-to-r from-success to-success/60" />
            <FunnelRow label="Клики" transition="CTR" value={clicks} base={funnelBase} prevValue={impressions} color="bg-gradient-to-r from-success/80 to-success/40" />
            <FunnelRow label="Лиды" transition="Конверсия сайта" value={leadCount} base={funnelBase} prevValue={clicks || impressions} color="bg-gradient-to-r from-success/60 to-success/30" />
            <FunnelRow label="Диагностики" transition="Дошли" value={diagnosticsCount} base={funnelBase} prevValue={leadCount} color="bg-gradient-to-r from-primary/70 to-primary/30" />
            <FunnelRow label="Продажи" transition="Закрыли" value={salesCount} base={funnelBase} prevValue={diagnosticsCount} color="bg-gradient-to-r from-warning/70 to-warning/30" />
          </div>
          {loading && (
            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Обновляем данные...
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">Динамика по дням</h2>
              <p className="mt-1 text-xs text-muted-foreground">Расход / лиды / продажи</p>
            </div>
          </div>
          <div className="mt-4">
            <TrendChart data={trend} />
          </div>
        </div>
      </div>

      {/* Channels */}
      <section className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Эффективность каналов</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Атрибуция автоматически по UTM-меткам и источнику лида
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {channels.map((c) => (
            <ChannelCard key={c.meta.key} stat={c} />
          ))}
        </div>
      </section>

      {/* UTM table */}
      <section className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight">UTM-кампании</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Срез по utm_source / utm_campaign / utm_medium из лидов CRM
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-border/60 bg-card/40 p-4">
          <UtmTable rows={utmRows} />
        </div>
      </section>
    </main>
  );
};

export default Analytics;
