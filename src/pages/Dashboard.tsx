import { useMemo, useState } from "react";
import {
  AlertCircle, BarChart3, DollarSign, Loader2, RefreshCw, Repeat, ShoppingCart,
  Target, TrendingUp, Users, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PeriodPicker } from "@/components/dashboard/PeriodPicker";
import { MoneyKpiCard } from "@/components/dashboard/MoneyKpiCard";
import { AlertsPanel } from "@/components/dashboard/AlertsPanel";
import { EnhancedFunnel } from "@/components/dashboard/EnhancedFunnel";
import { ChannelsTable } from "@/components/dashboard/ChannelsTable";
import { CrmFunnel } from "@/components/dashboard/CrmFunnel";
import { RevenueSpendChart } from "@/components/dashboard/RevenueSpendChart";
import { UnitEconomicsCard } from "@/components/dashboard/UnitEconomicsCard";
import { getPresetRange, useDashboardData, type PeriodPreset } from "@/hooks/useDashboardData";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { QualityBlock, QualityFunnel } from "@/components/crm/QualityBlock";
import { deltaPct, type ReportPeriodRange } from "@/hooks/useReportData";
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

const Dashboard = () => {
  const [preset, setPreset] = useState<PeriodPreset>("30d");
  const [range, setRange] = useState<ReportPeriodRange>(() => getPresetRange("30d"));
  const [comparing] = useState(true);

  const { data, loading, error, alerts, crmFunnel, channels, timeseries } =
    useDashboardData("all", range, comparing);
  const { leads: liteLeads } = useLeadsLite();
  const periodLeads = useMemo(() => liteLeads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= range.from.getTime() && t <= range.to.getTime();
  }), [liteLeads, range]);

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
    <main className="container max-w-7xl py-8 animate-fade-in-up">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Дашборд</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rangeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker
            preset={preset}
            range={range}
            onChange={(p, r) => {
              setPreset(p);
              setRange(r);
            }}
          />
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
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
      {totals && <EnhancedFunnel totals={totals} />}

      {/* Block 4 — Channels */}
      <SectionTitle>Источники заявок</SectionTitle>
      <ChannelsTable
        channels={channels}
        totalSpend={totals?.spend ?? 0}
        totalLeads={totals?.totalLeads ?? 0}
      />

      {/* Block 6 — CRM funnel */}
      <SectionTitle accent="bg-success">CRM: движение заявок</SectionTitle>
      <CrmFunnel data={crmFunnel} />

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
