import { lazy, Suspense, useMemo, useState } from "react";
import {
  AlertCircle, BarChart3, DollarSign, Download, Loader2, RefreshCw, Repeat, ShoppingCart,
  Target, TrendingUp, Users, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";
import { MoneyKpiCard } from "@/components/dashboard/MoneyKpiCard";
import { AlertsPanel } from "@/components/dashboard/AlertsPanel";
import { EnhancedFunnel } from "@/components/dashboard/EnhancedFunnel";
import { ChannelsTable } from "@/components/dashboard/ChannelsTable";
import { CreativesGrid } from "@/components/dashboard/CreativesGrid";
import { CrmFunnel } from "@/components/dashboard/CrmFunnel";
import { CrmFlowPanel } from "@/components/dashboard/CrmFlowPanel";
import { InstagramOrganicFunnel } from "@/components/dashboard/InstagramOrganicFunnel";
const RevenueSpendChart = lazy(() =>
  import("@/components/dashboard/RevenueSpendChart").then((m) => ({ default: m.RevenueSpendChart })),
);
import { UnitEconomicsCard } from "@/components/dashboard/UnitEconomicsCard";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useCodewordStats } from "@/hooks/useInstagramOrganic";
import { useCrmFlow } from "@/hooks/useCrmFlow";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { useMetaDashboard } from "@/hooks/useMetaDashboard";
import { QualityBlock, QualityFunnel } from "@/components/crm/QualityBlock";
import { deltaPct, type ReportPeriodRange } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";
import { formatMetaSyncMessages, syncMetaFull, ymdAlmaty } from "@/lib/metaSync";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { LayoutGrid } from "lucide-react";

const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

const SectionTitle = ({ children, accent }: { children: React.ReactNode; accent?: string }) => (
  <div className="mb-4 mt-10 flex items-center gap-2">
    <span className={cn("h-2 w-2 rounded-full", accent ?? "bg-primary")} />
    <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-foreground/90">
      {children}
    </h2>
  </div>
);

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const Dashboard = () => {
  const [range, setRange] = useState<ReportPeriodRange>(() => currentMonthRange());
  const [comparing] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const handleSyncMeta = async () => {
    setSyncing(true);
    try {
      const result = await syncMetaFull({
        since: ymdLocal(range.from),
        until: ymdAlmaty(),
      });
      const messages = formatMetaSyncMessages(result);
      if (messages.success) toast.success(messages.success);
      for (const warning of messages.warnings) toast.warning(warning);
      if (messages.error) toast.error(messages.error);
      // Триггерим перезагрузку данных тем же приёмом, что и кнопка «Обновить».
      setRange({ ...range });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать Meta");
    } finally {
      setSyncing(false);
    }
  };

  const { data, loading, error, alerts, crmFunnel, channels, timeseries, instagramFunnel } =
    useDashboardData("all", range, comparing);
  const { stats: codewordStats } = useCodewordStats();
  const { leads: liteLeads } = useLeadsLite();
  const crmFlow = useCrmFlow(range, liteLeads);
  const { creatives: metaCreatives } = useMetaDashboard(range);
  const periodLeads = useMemo(() => {
    const fromTs = range.from.getTime();
    // toTs = начало следующего дня после range.to, чтобы захватить весь последний день
    // включительно (а не только лиды, созданные ровно в 00:00). Та же half-open
    // конвенция, что в useReportData.aggregateCrm.
    const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
    return liteLeads.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= fromTs && t < toTs;
    });
  }, [liteLeads, range]);

  const totals = data?.totals;
  const prev = data?.prev;
  const profit = totals ? totals.revenue - totals.spend : 0;
  const prevProfit = prev ? prev.revenue - prev.spend : undefined;

  const rangeLabel = useMemo(() => {
    const f = range.from.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const t = range.to.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    return `${f} – ${t}`;
  }, [range]);

  return (
    <PageContainer>
      <PageHeader
        icon={LayoutGrid}
        title="Дашборд"
        description={rangeLabel}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <PeriodPicker range={range} onChange={setRange} className="w-full justify-between sm:w-auto sm:justify-start" />
            <Button
              variant="outline"
              className="h-10 gap-2 rounded-xl border-border/60"
              onClick={handleSyncMeta}
              disabled={syncing}
              title="Подтянуть расходы, лиды, кампании и креативы из Meta"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">Синхронизировать Meta</span>
              <span className="sm:hidden">Meta</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl border-border/60"
              aria-label="Обновить"
              onClick={() => setRange({ ...range })}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Не удалось загрузить статистику</div>
            <div className="mt-0.5 text-xs opacity-90">{error}</div>
          </div>
        </div>
      )}

      {/* Block 1 — Money */}
      <SectionTitle accent="bg-success">Деньги</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MoneyKpiCard
          icon={DollarSign}
          badge="REV"
          label="Выручка"
          value={fmtTenge(totals?.revenue ?? 0)}
          delta={deltaPct(totals?.revenue ?? 0, prev?.revenue)}
          comparing={comparing}
        />
        <MoneyKpiCard
          icon={Wallet}
          badge="ADS"
          label="Расходы"
          value={fmtTenge(totals?.spend ?? 0)}
          delta={deltaPct(totals?.spend ?? 0, prev?.spend)}
          comparing={comparing}
          invertDelta
        />
        <MoneyKpiCard
          icon={TrendingUp}
          badge="P&L"
          label="Прибыль"
          value={
            <span className={cn(profit >= 0 ? "text-success" : "text-destructive")}>
              {fmtTenge(profit)}
            </span>
          }
          delta={deltaPct(profit, prevProfit)}
          comparing={comparing}
          emphasize
        />
        <MoneyKpiCard
          icon={Repeat}
          badge="ROMI"
          label="Окупаемость рекламы"
          value={
            <span className={cn((totals?.romi ?? 0) >= 0 ? "text-success" : "text-destructive")}>
              {totals && totals.spend > 0 ? `${totals.romi >= 0 ? "+" : ""}${Math.round(totals.romi)}%` : "—"}
            </span>
          }
          delta={deltaPct(totals?.romi ?? 0, prev?.romi)}
          comparing={comparing}
        />
        <MoneyKpiCard
          icon={Target}
          badge="CAC"
          label="Стоимость клиента"
          value={totals && totals.cac > 0 ? fmtTenge(totals.cac) : "—"}
          delta={deltaPct(totals?.cac ?? 0, prev?.cac)}
          comparing={comparing}
          invertDelta
        />
        <MoneyKpiCard
          icon={ShoppingCart}
          badge="AOV"
          label="Средний чек"
          value={totals && totals.aov > 0 ? fmtTenge(totals.aov) : "—"}
          delta={deltaPct(totals?.aov ?? 0, prev?.aov)}
          comparing={comparing}
        />
      </div>

      {/* Block 2 — Alerts */}
      <SectionTitle accent="bg-warning">Что требует внимания</SectionTitle>
      <AlertsPanel alerts={alerts} />

      {/* Block 3 — Funnel */}
      <SectionTitle>Путь от рекламы до оплаты</SectionTitle>
      {totals && <EnhancedFunnel totals={totals} periodLabel={rangeLabel} />}

      {/* Block 4 — Channels */}
      <SectionTitle>Источники заявок</SectionTitle>
      <ChannelsTable
        channels={channels}
        totalSpend={totals?.spend ?? 0}
        totalLeads={totals?.totalLeads ?? 0}
      />

      {/* Block 4.1 — Instagram organic funnel (код-слова → DM → клик → заявка) */}
      {(instagramFunnel.codewordDms > 0 || codewordStats.length > 0) && (
        <>
          <SectionTitle accent="bg-pink-500">Instagram organic — воронка код-слов</SectionTitle>
          <InstagramOrganicFunnel funnel={instagramFunnel} topCodewords={codewordStats} />
        </>
      )}

      {/* Block 4.2 — Топ-6 креативов Meta по выручке CRM */}
      <SectionTitle>Топ креативов по выручке CRM</SectionTitle>
      <CreativesGrid
        rows={metaCreatives}
        topMode
        topLimit={4}
        periodLabel={rangeLabel}
        viewAllHref="/ads?tab=creatives"
      />

      {/* Block 6 — CRM funnel + SLA / stage distribution / reject reasons */}
      <SectionTitle accent="bg-success">CRM: движение заявок</SectionTitle>
      <div className="space-y-4">
        <CrmFlowPanel
          sla={crmFlow.sla}
          stages={crmFlow.stageBuckets}
          reasons={crmFlow.topRejectReasons}
          activeLeadsTotal={crmFlow.activeLeadsTotal}
          periodLeadsTotal={crmFlow.periodLeadsTotal}
        />
        <CrmFunnel data={crmFunnel} />
      </div>

      {/* Block 6.1 — Quality + Funnel: lead → diagnosis → payment */}
      <SectionTitle accent="bg-warning">Качество лидов</SectionTitle>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <QualityBlock leads={periodLeads} />
        <QualityFunnel leads={periodLeads} />
      </div>

      {/* Block 7 — Charts */}
      <SectionTitle>Динамика</SectionTitle>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/30" />}>
        <RevenueSpendChart data={timeseries} />
      </Suspense>

      {/* Block 8 — Unit economics */}
      <SectionTitle accent="bg-primary">Окупаемость и стоимость результата</SectionTitle>
      {totals && <UnitEconomicsCard totals={totals} />}

      <div className="mt-12 grid grid-cols-2 gap-3 text-[11px] text-muted-foreground sm:grid-cols-4">
        <div>
          Заявок всего: <span className="font-semibold text-foreground">{fmtNum(totals?.totalLeads ?? 0)}</span>
        </div>
        <div>
          Кликов: <span className="font-semibold text-foreground">{fmtNum(totals?.clicks ?? 0)}</span>
        </div>
        <div>
          Клики из показов: <span className="font-semibold text-foreground">{totals && totals.ctr > 0 ? `${totals.ctr.toFixed(2)}%` : "—"}</span>
        </div>
        <div>
          Стоимость заявки: <span className="font-semibold text-foreground">{totals && totals.cpl > 0 ? fmtTenge(totals.cpl) : "—"}</span>
        </div>
      </div>
    </PageContainer>
  );
};

export default Dashboard;
