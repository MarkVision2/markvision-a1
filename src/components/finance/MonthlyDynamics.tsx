import { useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, DollarSign, Target,
  PiggyBank, Receipt,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, LineChart, Line,
} from "recharts";
import { cn } from "@/lib/utils";
import { useMonthlyAggregates } from "@/hooks/useMonthlyAggregates";
import { useFinancePlans, monthKey } from "@/hooks/useFinancePlan";

const MONTHS_RU_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_RU_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtT = (n: number) => `${fmt(n)}\u00A0₸`;
const fmtMln = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${Math.round(n)}`;
};

type Mode = "fact" | "plan_vs_fact" | "yoy";

interface KpiProps { icon: React.ElementType; label: string; value: string; tone?: "default" | "success" | "warning" | "danger"; }
const Kpi = ({ icon: Icon, label, value, tone = "default" }: KpiProps) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/10 text-success">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
    <div className={cn(
      "mt-5 text-3xl font-bold tabular-nums",
      tone === "success" && "text-success",
      tone === "warning" && "text-warning",
      tone === "danger" && "text-destructive",
    )}>
      {value}
    </div>
  </div>
);

const MonthlyDynamics = () => {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [mode, setMode] = useState<Mode>("fact");
  const { data: current } = useMonthlyAggregates(year);
  const { data: prev } = useMonthlyAggregates(year - 1);
  const { store: planStore } = useFinancePlans();

  const now = new Date();
  const isCurrentYear = now.getFullYear() === year;
  const currentMonthIdx = now.getMonth();

  const monthsData = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const e = current[m] ?? { revenue: 0, spend: 0 };
      const tax = e.revenue * 0.1;
      const profit = e.revenue - e.spend - tax;
      const key = `${year}-${String(m + 1).padStart(2, "0")}`;
      const planRevenue = planStore[key]?.revenue ?? 0;
      const planSpend = planStore[key]?.spend ?? 0;
      const prevRevenue = prev[m]?.revenue ?? 0;
      return {
        idx: m,
        key,
        label: MONTHS_RU_SHORT[m],
        full: `${MONTHS_RU_FULL[m]} ${year}`,
        revenue: e.revenue,
        spend: e.spend,
        tax,
        profit,
        planRevenue,
        planSpend,
        prevRevenue,
      };
    });
  }, [year, current, prev, planStore]);

  const totals = useMemo(() => {
    const revenue = monthsData.reduce((s, m) => s + m.revenue, 0);
    const spend = monthsData.reduce((s, m) => s + m.spend, 0);
    const tax = revenue * 0.1;
    const afterMarketing = revenue - spend - tax;
    return { revenue, spend, tax, afterMarketing };
  }, [monthsData]);

  const chart1 = monthsData.map((m) => ({
    label: m.label,
    Выручка: m.revenue,
    Расходы: m.spend,
    ПланВыручка: m.planRevenue,
    ПрошлыйГод: m.prevRevenue,
  }));

  const chart2 = monthsData.map((m) => ({
    label: m.label,
    "После маркетинга": m.profit,
  }));

  return (
    <>
      {/* Controls */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-2xl border border-border/60 bg-card/60 px-2 py-1.5">
            <button
              onClick={() => setYear((y) => y - 1)}
              className="grid h-9 w-9 place-items-center rounded-xl hover:bg-secondary"
              aria-label="Предыдущий год"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-sm font-semibold tabular-nums">{year}</span>
            <button
              onClick={() => setYear((y) => y + 1)}
              className="grid h-9 w-9 place-items-center rounded-xl hover:bg-secondary"
              aria-label="Следующий год"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="inline-flex rounded-2xl border border-border/60 bg-card/60 p-1.5">
            {([
              { id: "fact" as const, label: "Факт" },
              { id: "plan_vs_fact" as const, label: "План vs Факт" },
              { id: "yoy" as const, label: "Год к году" },
            ]).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                  mode === m.id
                    ? "bg-success/15 text-success"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Выручка — оплаченные клиенты из «Агентской аналитики». Расходы — общие затраты по кабинетам.
        </div>
      </div>

      {/* KPI */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={DollarSign} label="Выручка за год" value={fmtT(totals.revenue)} tone="success" />
        <Kpi icon={Target} label="Расходы" value={fmtT(totals.spend)} tone="danger" />
        <Kpi icon={PiggyBank} label="После маркетинга и налогов" value={fmtT(totals.afterMarketing)} tone="success" />
        <Kpi icon={Receipt} label="Налоги (10%)" value={fmtT(totals.tax)} tone="warning" />
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <div className="text-sm font-semibold">
            {mode === "plan_vs_fact" ? "План vs Факт (выручка)"
              : mode === "yoy" ? "Год к году (выручка)"
              : "Выручка vs Расходы"}
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart1} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtMln} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.75rem",
                    fontSize: "12px",
                  }}
                  formatter={(v: number) => fmtT(v)}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                {mode === "fact" && (
                  <>
                    <Bar dataKey="Выручка" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Расходы" fill="hsl(var(--destructive))" radius={[6, 6, 0, 0]} />
                  </>
                )}
                {mode === "plan_vs_fact" && (
                  <>
                    <Bar dataKey="ПланВыручка" name="План" fill="hsl(var(--muted-foreground))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Выручка" name="Факт" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                  </>
                )}
                {mode === "yoy" && (
                  <>
                    <Bar dataKey="ПрошлыйГод" name={`${year - 1}`} fill="hsl(var(--muted-foreground))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Выручка" name={`${year}`} fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <div className="text-sm font-semibold">Прибыль (после маркетинга и налогов)</div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart2} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={fmtMln} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.75rem",
                    fontSize: "12px",
                  }}
                  formatter={(v: number) => fmtT(v)}
                />
                <Line
                  type="monotone"
                  dataKey="После маркетинга"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--success))", r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
        <div className="border-b border-border/60 px-6 py-4">
          <span className="text-sm font-semibold">Помесячная таблица</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-3 text-left">Месяц</th>
                <th className="px-4 py-3 text-right">Выручка</th>
                <th className="px-4 py-3 text-right">Расходы</th>
                <th className="px-4 py-3 text-right">Налоги</th>
                <th className="px-4 py-3 text-right">Прибыль</th>
              </tr>
            </thead>
            <tbody>
              {monthsData.map((m) => {
                const isCurrent = isCurrentYear && m.idx === currentMonthIdx;
                const empty = m.revenue === 0 && m.spend === 0;
                return (
                  <tr key={m.key} className="border-b border-border/30 hover:bg-card/40">
                    <td className="px-6 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-2 text-sm",
                        isCurrent && "font-semibold text-success",
                      )}>
                        {MONTHS_RU_SHORT[m.idx]} {year}
                        {isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-success">
                      {m.revenue > 0 ? fmtT(m.revenue) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-destructive">
                      {m.spend > 0 ? fmtT(m.spend) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-warning">
                      {m.tax > 0 ? fmtT(m.tax) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className={cn(
                      "px-4 py-3 text-right font-semibold tabular-nums",
                      empty ? "text-muted-foreground/50"
                        : m.profit > 0 ? "text-success" : m.profit < 0 ? "text-destructive" : "text-muted-foreground/50",
                    )}>
                      {empty ? "—" : fmtT(m.profit)}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-card/60 font-bold">
                <td className="px-6 py-4">Итого {year}</td>
                <td className="px-4 py-4 text-right tabular-nums text-success">{fmtT(totals.revenue)}</td>
                <td className="px-4 py-4 text-right tabular-nums text-destructive">{fmtT(totals.spend)}</td>
                <td className="px-4 py-4 text-right tabular-nums text-warning">{fmtT(totals.tax)}</td>
                <td className={cn(
                  "px-4 py-4 text-right tabular-nums",
                  totals.afterMarketing >= 0 ? "text-success" : "text-destructive",
                )}>
                  {fmtT(totals.afterMarketing)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default MonthlyDynamics;
