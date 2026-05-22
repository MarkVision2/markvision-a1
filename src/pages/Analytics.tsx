import { lazy, Suspense, useMemo, useState } from "react";
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
import { useDestinationSplit } from "@/hooks/useDestinationSplit";
import { useLeadsLite, type LeadLite } from "@/hooks/useLeadsLite";
import { CHANNELS, resolveChannel, type ChannelKey } from "@/lib/channelAttribution";
import { isLeadPaid } from "@/lib/leadStageFlags";
import { ChannelCard, type ChannelStat } from "@/components/analytics/ChannelCard";
import { UtmTable, type UtmRow } from "@/components/analytics/UtmTable";
import type { TrendPoint } from "@/components/analytics/TrendChart";
const TrendChart = lazy(() =>
  import("@/components/analytics/TrendChart").then((m) => ({ default: m.TrendChart })),
);
import { PeriodPicker, monthRange } from "@/components/dashboard/PeriodPicker";
import { useReportData, type ReportPeriodRange } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

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
      "rounded-2xl border border-border/60 bg-card/60 p-3.5 transition-colors",
      emphasized && "border-success/40 bg-success/5",
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-success/10 text-success">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {delta !== null && delta !== undefined && Math.abs(delta) > 0.5 && (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
            delta >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
          )}
        >
          {delta >= 0 ? "+" : ""}
          {Math.round(delta)}%
        </span>
      )}
    </div>
    <div className="mt-2.5 text-xl font-bold tabular-nums leading-tight">{value}</div>
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

  // Единый источник правды для KPI — тот же, что у Dashboard / Reports / Metrics.
  // Это убирает расхождение «100 vs 107 vs 115» между страницами.
  const { data: reportData } = useReportData(cabinetId, period, true);
  const reportTotals = reportData?.totals;
  const reportPrevTotals = reportData?.prev;

  // Split-by-destination метрики (сайт vs WhatsApp) — берём напрямую из meta_campaign_daily.
  const cabinetIdsForSplit = useMemo(() => {
    if (cabinetId === "all") return cabinets.map((c) => c.id);
    return [cabinetId];
  }, [cabinetId, cabinets]);
  const { data: splitData } = useDestinationSplit(cabinetIdsForSplit, monthParam, cabinetIdsForSplit.length > 0);

  const { leads, loading: leadsLoading, refetch } = useLeadsLite();

  // Filter leads by month
  const monthStart = monthCursor.getTime();
  const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1).getTime();

  const monthLeads = useMemo(
    () => leads.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= monthStart && t < monthEnd;
    }),
    [leads, monthStart, monthEnd],
  );
  // Optional cabinet filter on leads (используется для UTM-таблицы и каналов)
  const filteredLeads = useMemo(() => {
    if (cabinetId === "all") return monthLeads;
    return monthLeads.filter((l) => l.cabinetId === cabinetId);
  }, [monthLeads, cabinetId]);

  // ВСЕ KPI — из useReportData, чтобы цифры на Analytics совпадали с Dashboard /
  // Reports / Metrics. Раньше Analytics считал leadCount/salesCount/revenue по
  // своей формуле (adsLeads + orphanByCreatedAt), из-за чего на одинаковом
  // периоде показывалось разное число лидов (например 107 на Dashboard и 115 здесь).
  const adsLeads = reportTotals?.adsLeads ?? 0;
  const leadCount = reportTotals?.totalLeads ?? 0;
  const diagnosticsCount = reportTotals?.visits ?? 0;
  const salesCount = reportTotals?.sales ?? 0;
  const revenue = reportTotals?.revenue ?? 0;
  const spend = reportTotals?.spend ?? 0;
  const impressions = reportTotals?.impressions ?? 0;
  const clicks = reportTotals?.clicks ?? 0;
  const cpl = reportTotals?.cpl ?? 0;
  const romi = reportTotals && reportTotals.spend > 0 ? reportTotals.romi : null;
  const avgCheck = reportTotals?.aov ?? 0;
  const conversion = leadCount > 0 ? (salesCount / leadCount) * 100 : 0;
  const crLeadVisit = leadCount > 0 ? (diagnosticsCount / leadCount) * 100 : 0;
  const crVisitSale = diagnosticsCount > 0 ? (salesCount / diagnosticsCount) * 100 : 0;

  const prevTotalLeads = reportPrevTotals?.totalLeads ?? 0;
  const prevSpend = reportPrevTotals?.spend ?? 0;
  const prevRevenue = reportPrevTotals?.revenue ?? 0;
  const prevSales = reportPrevTotals?.sales ?? 0;

  // Per-channel attribution.
  // ВЫСОКОУРОВНЕВЫЕ КАНАЛЫ ТРАФИКА: WhatsApp · Сайт · Instagram · Google Ads · TikTok Ads.
  // Раньше показывали «Facebook Ads» как канал, но это провайдер рекламы (как Google),
  // а не точка входа лида. Реальные каналы трафика, куда приходит лид, — это
  // WhatsApp / Сайт / Instagram / лид-формы.
  //
  // Правила атрибуции (та же логика, что и в Dashboard.useDashboardData.classify):
  //   • lead.source / channel / referrer / utm.source классифицируется в один из бакетов.
  //   • Лид с cabinet_id попадает в бакет на основании destination (whatsapp/site),
  //     не задваиваясь с CRM-orphan.
  //   • Расход CDI распределяется пропорционально доле лидов по платным бакетам.
  const channels = useMemo<ChannelStat[]>(() => {
    type ChannelBucket = "whatsapp" | "site" | "instagram" | "google" | "tiktok";

    const BUCKET_META: Record<ChannelBucket, ChannelStat["meta"]> = {
      whatsapp: CHANNELS.whatsapp,
      site: { ...CHANNELS.direct, label: "Сайт" },
      instagram: CHANNELS.instagram,
      google: CHANNELS.google,
      tiktok: CHANNELS.tiktok,
    };

    const classify = (l: { source?: string | null; channel?: string | null; referrer?: string | null; utm?: { source?: string | null } | null }): ChannelBucket => {
      const src = (l.source ?? "").toLowerCase();
      const ch = (l.channel ?? "").toLowerCase();
      const refr = (l.referrer ?? "").toLowerCase();
      const landing = (l.utm?.source ?? "").toLowerCase();
      if (/whatsapp|^wa$|wa\.me/.test(src) || /whatsapp|^wa$/.test(ch) || /wa\.me|whatsapp/.test(refr)) return "whatsapp";
      if (/tiktok|tt_ads|^tt$/.test(src) || /tiktok/.test(landing)) return "tiktok";
      if (/google|googleads|gads|gsearch/.test(src) || /google/.test(landing)) return "google";
      if (/instagram|^ig$|insta/.test(src) || /instagram/.test(landing) || /instagram\.com/.test(refr)) return "instagram";
      if (/site|web|landing|tilda|wordpress/.test(src) || /site|web/.test(landing)) return "site";
      // Meta/Facebook без явного канала — раскидываем на whatsapp/site через destination,
      // не оставляем как «Facebook Ads», т.к. это провайдер, не канал трафика.
      if (/meta|facebook|fb_ads|^fb$/.test(src)) {
        if (/whatsapp|wa\.me/.test(refr) || /whatsapp/.test(landing)) return "whatsapp";
        return "site";
      }
      return "site";
    };

    const map = new Map<ChannelBucket, ChannelStat>();
    const ensure = (k: ChannelBucket) => {
      let cur = map.get(k);
      if (!cur) {
        cur = { meta: BUCKET_META[k], spend: 0, leads: 0, sales: 0, revenue: 0 };
        map.set(k, cur);
      }
      return cur;
    };

    // Заглушки в порядке, как просил пользователь
    for (const k of ["whatsapp", "site", "instagram", "google", "tiktok"] as ChannelBucket[]) ensure(k);

    // 1) Все лиды в периоде раскладываем по каналу (по createdAt)
    for (const l of filteredLeads) {
      ensure(classify(l as LeadLite)).leads += 1;
    }
    // 2) Все продажи в периоде раскладываем по каналу (по paid_at — единый источник)
    for (const l of leads) {
      if (!isLeadPaid(l)) continue;
      // Только активный кабинет (если выбран) — иначе все продажи
      if (cabinetId !== "all" && l.cabinetId !== cabinetId) continue;
      const paidAt = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(paidAt).getTime();
      if (t < monthStart || t >= monthEnd) continue;
      const bucket = ensure(classify(l as LeadLite));
      bucket.sales += 1;
      bucket.revenue += l.amount || 0;
    }
    // 3) Расход CDI распределяем по платным бакетам пропорционально доле лидов
    const paidBucketKeys: ChannelBucket[] = ["whatsapp", "site"];
    const paidLeadsTotal = paidBucketKeys.reduce((s, k) => s + (map.get(k)?.leads ?? 0), 0);
    if (spend > 0 && paidLeadsTotal > 0) {
      for (const k of paidBucketKeys) {
        const b = map.get(k);
        if (b) b.spend = (b.leads / paidLeadsTotal) * spend;
      }
    }

    return ["whatsapp", "site", "instagram", "google", "tiktok"]
      .map((k) => map.get(k as ChannelBucket)!)
      .filter(Boolean);
  }, [filteredLeads, leads, monthStart, monthEnd, spend, cabinetId]);

  // UTM campaigns table + AI quality aggregates.
  // ЕДИНАЯ СЕМАНТИКА: leads — по createdAt в периоде, sales/revenue — по paid_at.
  // Раньше sales/revenue считались по createdAt — лид, оплаченный в следующем
  // месяце, не давал выручку, поэтому таблица казалась пустой при ненулевом
  // KPI «Продажи» сверху.
  const utmRows = useMemo<UtmRow[]>(() => {
    const map = new Map<string, UtmRow & { _scoreSum: number; _scoreCount: number }>();
    const ensure = (utm: { source?: string | null; campaign?: string | null; medium?: string | null }) => {
      const key = `${utm.source ?? ""}|${utm.campaign ?? ""}|${utm.medium ?? ""}`;
      let cur = map.get(key);
      if (!cur) {
        cur = {
          source: utm.source ?? "",
          campaign: utm.campaign ?? "",
          medium: utm.medium ?? "",
          leads: 0, sales: 0, revenue: 0,
          avgScore: 0, hotCount: 0, paidCount: 0,
          _scoreSum: 0, _scoreCount: 0,
        };
        map.set(key, cur);
      }
      return cur;
    };
    // Лиды периода (createdAt + cabinet filter)
    for (const l of filteredLeads) {
      const u = l.utm ?? {};
      if (!u.source && !u.campaign && !u.medium) continue;
      const cur = ensure(u);
      cur.leads += 1;
      const score = Number((l as { aiScore?: number }).aiScore ?? 0);
      if (score > 0) {
        cur._scoreSum += score;
        cur._scoreCount += 1;
        if (score >= 75 || l.stageKey === "scheduled" || l.stageKey === "diagnosed") {
          cur.hotCount = (cur.hotCount ?? 0) + 1;
        }
      }
    }
    // Продажи периода (paid_at + cabinet filter) — могут включать лида,
    // созданного в предыдущем месяце, но оплатившего в текущем.
    for (const l of leads) {
      if (!isLeadPaid(l)) continue;
      if (cabinetId !== "all" && l.cabinetId !== cabinetId) continue;
      const paidAt = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(paidAt).getTime();
      if (t < monthStart || t >= monthEnd) continue;
      const u = l.utm ?? {};
      if (!u.source && !u.campaign && !u.medium) continue;
      const cur = ensure(u);
      cur.sales += 1;
      cur.revenue += l.amount || 0;
      cur.paidCount = (cur.paidCount ?? 0) + 1;
    }
    return Array.from(map.values())
      .map(({ _scoreSum, _scoreCount, ...r }) => ({
        ...r,
        avgScore: _scoreCount > 0 ? _scoreSum / _scoreCount : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || (b.avgScore ?? 0) - (a.avgScore ?? 0) || b.leads - a.leads);
  }, [filteredLeads, leads, monthStart, monthEnd, cabinetId]);

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
      if (isLeadPaid(l)) cur.sales += 1;
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
    <PageContainer>
      <PageHeader
        icon={Zap}
        title="Сквозная аналитика"
        description="UTM-атрибуция · эффективность каналов · полная воронка"
        actions={
          <>
            <PeriodPicker range={period} onChange={setPeriod} />
            <button
              onClick={() => { refresh(); refetch(); }}
              className="grid h-10 w-10 place-items-center rounded-xl border border-border/60 bg-card/60 hover:bg-secondary"
              aria-label="Обновить"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <Select value={cabinetId} onValueChange={setCabinetId}>
              <SelectTrigger className="h-10 min-w-[200px] rounded-xl border-border/60 bg-card/60">
                <SelectValue placeholder="Все кабинеты" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все кабинеты</SelectItem>
                {cabinets.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {/* KPI grid */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-4">
        <KpiCard icon={DollarSign} label="Расход" value={spend > 0 ? fmtMoney(spend) : "—"} sub="за период" delta={pctDelta(spend, prevSpend)} />
        <KpiCard icon={Users} label="Лиды" value={fmtNumber(leadCount)} sub={adsLeads ? `${adsLeads} из рекламы` : `${filteredLeads.length} в CRM`} delta={pctDelta(leadCount, prevTotalLeads)} />
        <KpiCard icon={Target} label="CPL" value={cpl > 0 ? fmtMoney(cpl) : "—"} sub="стоимость лида" emphasized />
        <KpiCard icon={ShoppingBag} label="Продажи" value={fmtNumber(salesCount)} sub={salesCount > 0 ? fmtPct(conversion) + " конверсия" : "нет продаж"} delta={pctDelta(salesCount, prevSales)} />
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
              <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">Live</span>
            </div>
          </div>

          {/* Split-by-destination конверсии: сайт (по каждому URL) и WhatsApp отдельно */}
          {(splitData.sites.length > 0 || splitData.whatsapp.clicks > 0) && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-success/20 bg-success/5 p-3">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-success">
                  <span>Сайт · клик → лид</span>
                  {splitData.siteTotals.clicks > 0 && (
                    <span className="text-xs font-bold tabular-nums">{fmtPct(splitData.siteTotals.cr)}</span>
                  )}
                </div>
                {splitData.sites.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {splitData.sites.map((s) => (
                      <div key={s.url} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium" title={s.url}>{s.label}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {fmtNumber(s.leads)}/{fmtNumber(s.clicks)} ·{" "}
                          <span className="font-bold text-success">{fmtPct(s.cr)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Нет сайтовых кампаний</div>
                )}
              </div>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <span>WhatsApp · клик → диалог</span>
                  {splitData.whatsapp.clicks > 0 && (
                    <span className="text-xs font-bold tabular-nums">{fmtPct(splitData.whatsapp.cr)}</span>
                  )}
                </div>
                {splitData.whatsapp.clicks > 0 ? (
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Диалогов / кликов</span>
                    <span className="tabular-nums">
                      {fmtNumber(splitData.whatsapp.messages)}/{fmtNumber(splitData.whatsapp.clicks)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Нет WhatsApp-кампаний</div>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 space-y-5">
            <FunnelRow label="Показы" value={impressions} base={funnelBase} color="bg-gradient-to-r from-success to-success/60" />
            <FunnelRow label="Клики" transition="CTR" value={clicks} base={funnelBase} prevValue={impressions} color="bg-gradient-to-r from-success/80 to-success/40" />
            <FunnelRow label="Лиды" transition="всего" value={leadCount} base={funnelBase} prevValue={clicks || impressions} color="bg-gradient-to-r from-success/60 to-success/30" />
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
            <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/30" />}>
              <TrendChart data={trend} />
            </Suspense>
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
              Срез по utm_source / utm_campaign / utm_medium из лидов CRM.
              Лиды — по дате создания в периоде, продажи — по дате оплаты.
              {(() => {
                const noUtm = filteredLeads.filter((l) => {
                  const u = l.utm ?? {};
                  return !u.source && !u.campaign && !u.medium;
                }).length;
                return noUtm > 0
                  ? ` Лидов без UTM-меток: ${noUtm} (не попадают в таблицу).`
                  : "";
              })()}
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-border/60 bg-card/40 p-4">
          <UtmTable rows={utmRows} />
        </div>
      </section>
    </PageContainer>
  );
};

export default Analytics;
