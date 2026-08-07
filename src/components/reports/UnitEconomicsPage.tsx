import { BarChart3, Lock, ShoppingCart, TrendingUp, Users, Wallet } from "lucide-react";
import type { ReportData } from "@/hooks/useReportData";
import { ReportPageWrapper } from "./ReportPageWrapper";
import { SectionTitle } from "./SectionTitle";
import { reportFmt } from "./reportFormat";

interface Props {
  data: ReportData;
  rangeLabel: string;
}

function EcoRow({
  icon: Icon, title, sub, value,
}: { icon: typeof BarChart3; title: string; sub: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 px-2 py-4 last:border-0">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15 text-success">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{sub}</div>
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function UnitEconomicsPage({ data, rangeLabel }: Props) {
  const { totals, scoring } = data;
  const noRevenue = totals.revenue === 0;

  return (
    <ReportPageWrapper
      title="Все проекты"
      rangeLabel={rangeLabel}
      pageNumber={3}
      pageTotal={3}
      rightLabel="Продажи и юнит-экономика"
    >
      <SectionTitle>Качество трафика (AI scoring)</SectionTitle>
      <div className="rounded-2xl border border-border/40 bg-card/30 p-6">
        <div className="flex h-3 overflow-hidden rounded-full bg-secondary/30">
          {scoring.hot > 0 && <div className="h-full bg-destructive" style={{ width: `${scoring.hot}%` }} />}
          {scoring.warm > 0 && <div className="h-full bg-warning" style={{ width: `${scoring.warm}%` }} />}
          {scoring.cold > 0 && <div className="h-full bg-muted" style={{ width: `${scoring.cold}%` }} />}
          {scoring.hot + scoring.warm + scoring.cold === 0 && (
            <div className="h-full w-full bg-warning/60" />
          )}
        </div>
        <div className="mt-6 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-muted-foreground">🔥 Горячие</div>
            <div className="mt-1 text-2xl font-bold text-success">{scoring.hot.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">{scoring.hotLeads} лидов</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">🟡 Тёплые</div>
            <div className="mt-1 text-2xl font-bold text-warning">{scoring.warm.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">{scoring.warmLeads} лидов</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">🗑 Холодные</div>
            <div className="mt-1 text-2xl font-bold text-destructive">{scoring.cold.toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">{scoring.coldLeads} лидов</div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <SectionTitle>Юнит-экономика</SectionTitle>
        <div className="rounded-2xl border border-border/40 bg-card/30 px-4">
          <EcoRow icon={BarChart3} title="Финансовая сводка" sub={`Unit Economics · ${rangeLabel}`} value="" />
          <EcoRow icon={Wallet} title="Общая выручка" sub="оплаты + диагностики за период" value={reportFmt.fmtTenge(totals.revenue)} />
          <EcoRow icon={ShoppingCart} title="Средний чек" sub="оплаты продаж ÷ число продаж (без диагностик)" value={totals.sales > 0 ? reportFmt.fmtTenge(totals.aov) : "—"} />
          <EcoRow icon={Users} title="Стоимость клиента" sub="расход ÷ продажи (CAC)" value={totals.sales > 0 ? reportFmt.fmtTenge(totals.cac) : "—"} />
          <EcoRow
            icon={TrendingUp}
            title="Окупаемость рекламы"
            sub="(выручка − расход) ÷ расход (ROMI)"
            value={totals.spend > 0 ? `${totals.romi >= 0 ? "+" : ""}${Math.round(totals.romi)}%` : "—"}
          />
        </div>
      </div>

      {noRevenue && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning">
          <Lock className="h-3.5 w-3.5" />
          Нет выручки за период — средний чек и ROMI без данных.
        </div>
      )}
    </ReportPageWrapper>
  );
}