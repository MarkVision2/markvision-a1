import { useMemo, useState } from "react";
import {
  AlertCircle, BarChart3, DollarSign, Download, Loader2, RefreshCw, Repeat, ShoppingCart,
  Target, TrendingUp, Users, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MonthSwitcher, monthRange, monthRangeLabel } from "@/components/ui/month-switcher";
import { MoneyKpiCard } from "@/components/dashboard/MoneyKpiCard";
import { AlertsPanel } from "@/components/dashboard/AlertsPanel";
import { EnhancedFunnel } from "@/components/dashboard/EnhancedFunnel";
import { CampaignGoalsBreakdown } from "@/components/dashboard/CampaignGoalsBreakdown";
import { ChannelsTable } from "@/components/dashboard/ChannelsTable";
import { CreativesGrid } from "@/components/dashboard/CreativesGrid";
import { CrmFunnel } from "@/components/dashboard/CrmFunnel";
import { CrmFlowPanel } from "@/components/dashboard/CrmFlowPanel";
import { InstagramOrganicFunnel } from "@/components/dashboard/InstagramOrganicFunnel";
import { RevenueSpendChart } from "@/components/dashboard/RevenueSpendChart";
import { UnitEconomicsCard } from "@/components/dashboard/UnitEconomicsCard";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useCodewordStats } from "@/hooks/useInstagramOrganic";
import { useCrmFlow } from "@/hooks/useCrmFlow";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { useMetaCampaigns, useMetaCreatives } from "@/hooks/useMetaStructure";
import { QualityBlock, QualityFunnel } from "@/components/crm/QualityBlock";
import { deltaPct } from "@/hooks/useReportData";
import { mergeChannelsWithMetaCampaignGoals } from "@/lib/dashboardChannels";
import { syncMetaStructure } from "@/lib/metaStructureSync";
import { cn } from "@/lib/utils";

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
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const range = useMemo(() => monthRange(monthCursor), [monthCursor]);
  const [comparing] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const handleSyncMetaStructure = async () => {
    setSyncing(true);
    try {
      const data = await syncMetaStructure({ since: ymdLocal(range.from), until: ymdLocal(range.to) });
      const results = data.results ?? [];
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      if (ok.length > 0) {
        const camps = ok.reduce((s, r) => s + (r.campaigns ?? 0), 0);
        const ads = ok.reduce((s, r) => s + (r.creatives ?? 0), 0);
        toast.success(`Синхронизировано: ${ok.length} кабинет(ов), ${camps} кампаний, ${ads} креативов`);
      }
      if (failed.length > 0) {
        toast.error(`Ошибка по ${failed.length} кабинет(ам): ${failed[0].cabinet}`);
      }
      setMonthCursor((p) => new Date(p.getFullYear(), p.getMonth(), 1));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать Meta");
    } finally {
      setSyncing(false);
    }
  };

  const { data, loading, error, alerts, crmFunnel, channels, timeseries, instagramFunnel } =
    useDashboardData("all", range, comparing);
  const { stats: codewordStats } = useCodewordStats();
  const crmFlow = useCrmFlow(range);
  const { rows: metaCreatives } = useMetaCreatives(range);
  const { rows: metaCampaigns } = useMetaCampaigns(range);
  const hasCreativeCrmRevenue = useMemo(
    () => metaCreatives.some((creative) => (creative.crmRevenue ?? 0) > 0),
    [metaCreatives],
  );
  const sourceChannels = useMemo(
    () => mergeChannelsWithMetaCampaignGoals(channels, metaCampaigns),
    [channels, metaCampaigns],
  );
  const { leads: liteLeads } = useLeadsLite();
  const periodLeads = useMemo(() => liteLeads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
    return t >= range.from.getTime() && t < toTs;
  }), [liteLeads, range]);

  const totals = data?.totals;
  const prev = data?.prev;
  const profit = totals ? totals.revenue - totals.spend : 0;
  const prevProfit = prev ? prev.revenue - prev.spend : undefined;

  const rangeLabel = useMemo(() => monthRangeLabel(monthCursor), [monthCursor]);

  return (
    <main className="container max-w-7xl py-8 animate-fade-in-up">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Дашборд</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rangeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthSwitcher value={monthCursor} onChange={setMonthCursor} size="lg" />
          <Button
            variant="outline"
            className="h-10 gap-2 rounded-xl border-border/60"
            onClick={handleSyncMetaStructure}
            disabled={syncing}
            title="Синхронизировать кампании и креативы Meta с серверов Facebook"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Синхронизировать Meta
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-xl border-border/60"
            aria-label="Обновить"
            onClick={() => setMonthCursor((p) => new Date(p.getFullYear(), p.getMonth(), 1))}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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

      {/* Block 1 — Money */}
      <SectionTitle accent="bg-success">Деньги</SectionTitle>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        <MoneyKpiCard
          icon={DollarSign}
          label="Выручка"
          value={fmtTenge(totals?.revenue ?? 0)}
          delta={deltaPct(totals?.revenue ?? 0, prev?.revenue)}
          comparing={comparing}
        />
        <MoneyKpiCard
          icon={Wallet}
          label="Расходы"
          value={fmtTenge(totals?.spend ?? 0)}
          delta={deltaPct(totals?.spend ?? 0, prev?.spend)}
          comparing={comparing}
          invertDelta
        />
        <MoneyKpiCard
          icon={TrendingUp}
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
          label="Стоимость клиента"
          value={totals && totals.cac > 0 ? fmtTenge(totals.cac) : "—"}
          delta={deltaPct(totals?.cac ?? 0, prev?.cac)}
          comparing={comparing}
          invertDelta
        />
        <MoneyKpiCard
          icon={ShoppingCart}
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
        channels={sourceChannels}
        totalSpend={totals?.spend ?? 0}
        totalLeads={Math.max(
          totals?.totalLeads ?? 0,
          sourceChannels.reduce((sum, channel) => sum + channel.leads, 0),
        )}
      />

      {/* Block 4.1 — Instagram organic funnel (код-слова → DM → клик → заявка) */}
      {(instagramFunnel.codewordDms > 0 || codewordStats.length > 0) && (
        <>
          <SectionTitle accent="bg-pink-500">Instagram organic — воронка код-слов</SectionTitle>
          <InstagramOrganicFunnel funnel={instagramFunnel} topCodewords={codewordStats} />
        </>
      )}

      {/* Block 4.2 — Цели кампаний Meta (WhatsApp / лиды с сайта / direct и т.д.) */}
      <SectionTitle accent="bg-primary">Цели рекламных кампаний Meta</SectionTitle>
      <CampaignGoalsBreakdown rows={metaCampaigns} />

      {/* Block 4.3 — Топ-6 креативов Meta по выручке CRM */}
      <SectionTitle>{hasCreativeCrmRevenue ? "Топ креативов по выручке CRM" : "Топ креативов по заявкам Meta"}</SectionTitle>
      <CreativesGrid rows={metaCreatives} topMode viewAllHref="/ads?tab=creatives" />

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
      <RevenueSpendChart data={timeseries} />

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
    </main>
  );
};

export default Dashboard;
