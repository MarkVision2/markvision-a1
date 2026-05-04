import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  LineChart,
  Save,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  CircleDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useFinancePlans, monthKey } from "@/hooks/useFinancePlan";
import AgencyAnalytics from "@/components/finance/AgencyAnalytics";
import MonthlyDynamics from "@/components/finance/MonthlyDynamics";

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtT = (n: number) => `${fmt(n)} $`;

type Mode = "revenue" | "budget";
type Tab = "decomp" | "agency" | "dynamics";

interface FieldProps {
  icon: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
  disabled?: boolean;
}

const NumField = ({ icon, label, value, onChange, suffix, disabled }: FieldProps) => (
  <div className={cn(
    "rounded-2xl border border-border/60 bg-card/60 p-4",
    disabled && "opacity-60",
  )}>
    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span>{icon}</span>
      <span>{label}</span>
    </div>
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3">
      <Input
        type="number"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        disabled={disabled}
        className="border-0 bg-transparent p-0 text-lg font-semibold tabular-nums shadow-none focus-visible:ring-0"
      />
      <span className="text-sm font-medium text-muted-foreground">{suffix}</span>
    </div>
  </div>
);

interface FunnelStepProps {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}

const FunnelStep = ({ icon: Icon, label, value, sub, highlight }: FunnelStepProps) => (
  <div className={cn(
    "flex-1 rounded-2xl border p-5 text-center",
    highlight
      ? "border-success/40 bg-success/5"
      : "border-border/60 bg-card/40",
  )}>
    <span className={cn(
      "mx-auto grid h-10 w-10 place-items-center rounded-xl",
      highlight ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground",
    )}>
      <Icon className="h-5 w-5" />
    </span>
    <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
    <div className={cn(
      "mt-2 text-xl font-bold tabular-nums",
      highlight && "text-success",
    )}>
      {value}
    </div>
    {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
  </div>
);

const FunnelArrow = () => (
  <div className="hidden items-center justify-center px-1 text-muted-foreground/50 lg:flex">
    →
  </div>
);

const Finance = () => {
  const [tab, setTab] = useState<Tab>("decomp");
  const [mode, setMode] = useState<Mode>("revenue");
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const { savePlan, getPlan } = useFinancePlans();

  // Inputs
  const [revenue, setRevenue] = useState(5_000_000);
  const [avgCheck, setAvgCheck] = useState(1_000_000);
  const [crLeadVisit, setCrLeadVisit] = useState(10);  // %
  const [crVisitSale, setCrVisitSale] = useState(20);  // %
  const [cpl, setCpl] = useState(2_000);
  const [budget, setBudget] = useState(500_000);

  // Load existing plan when month changes
  useEffect(() => {
    const p = getPlan(monthKey(monthCursor));
    if (p) {
      setRevenue(p.revenue);
      setAvgCheck(p.avgCheck);
      setCrLeadVisit(p.crLeadVisit);
      setCrVisitSale(p.crVisitSale);
      setCpl(p.cpl);
      setBudget(p.spend);
    }
  }, [monthCursor, getPlan]);

  // Decomposition math
  const calc = useMemo(() => {
    if (mode === "revenue") {
      const sales = avgCheck > 0 ? revenue / avgCheck : 0;
      const visits = crVisitSale > 0 ? sales / (crVisitSale / 100) : 0;
      const leads = crLeadVisit > 0 ? visits / (crLeadVisit / 100) : 0;
      const spend = leads * cpl;
      return { sales, visits, leads, spend, revenue };
    }
    // mode === "budget"
    const leads = cpl > 0 ? budget / cpl : 0;
    const visits = leads * (crLeadVisit / 100);
    const sales = visits * (crVisitSale / 100);
    const rev = sales * avgCheck;
    return { sales, visits, leads, spend: budget, revenue: rev };
  }, [mode, revenue, avgCheck, crLeadVisit, crVisitSale, cpl, budget]);

  const cpv = calc.visits > 0 ? calc.spend / calc.visits : 0;
  const cac = calc.sales > 0 ? calc.spend / calc.sales : 0;
  const romi = calc.spend > 0 ? ((calc.revenue - calc.spend) / calc.spend) * 100 : 0;

  const shiftMonth = (delta: number) =>
    setMonthCursor((p) => new Date(p.getFullYear(), p.getMonth() + delta, 1));
  const monthLabel = `${MONTHS_RU[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`;

  const handleSave = () => {
    savePlan(monthKey(monthCursor), {
      spend: Math.round(calc.spend),
      leads: Math.round(calc.leads),
      cpl: Math.round(cpl),
      visits: Math.round(calc.visits),
      sales: Math.round(calc.sales),
      revenue: Math.round(calc.revenue),
      avgCheck,
      crLeadVisit,
      crVisitSale,
    });
    toast.success(`План на ${monthLabel} сохранён`, {
      description: "Перенесён в Таблицу показателей",
    });
  };

  return (
    <main className="container max-w-7xl py-8 animate-fade-in-up">
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success">
          <Wallet className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Финансы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Юнит-экономика, агентская аналитика и динамика
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-8 inline-flex flex-wrap rounded-2xl border border-border/60 bg-card/60 p-1.5">
        {([
          { id: "decomp", label: "Декомпозиция", icon: Calculator },
          { id: "agency", label: "Агентская аналитика", icon: CircleDollarSign },
          { id: "dynamics", label: "Динамика по месяцам", icon: LineChart },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-success/15 text-success"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "agency" && <AgencyAnalytics />}

      {tab === "dynamics" && <MonthlyDynamics />}

      {tab === "decomp" && (
        <>
          {/* Mode switch */}
          <div className="mt-8 inline-flex rounded-2xl border border-border/60 bg-card/60 p-1.5">
            {([
              { id: "revenue" as const, label: "От целевой выручки" },
              { id: "budget" as const, label: "От бюджета" },
            ]).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  "rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                  mode === m.id
                    ? "bg-success/15 text-success"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Inputs */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <NumField
              icon="🎯" label="Целевая выручка"
              value={revenue} onChange={setRevenue}
              suffix="$" disabled={mode === "budget"}
            />
            <NumField
              icon="💰" label="Средний чек"
              value={avgCheck} onChange={setAvgCheck} suffix="$"
            />
            <NumField
              icon="📈" label="CR лид → диагностика"
              value={crLeadVisit} onChange={setCrLeadVisit} suffix="%"
            />
            <NumField
              icon="📊" label="CR диагностика → продажа"
              value={crVisitSale} onChange={setCrVisitSale} suffix="%"
            />
            <NumField
              icon="💸" label="Стоимость лида (CPL)"
              value={cpl} onChange={setCpl} suffix="$"
            />
          </div>

          {mode === "budget" && (
            <div className="mt-4 max-w-xs">
              <NumField
                icon="💼" label="Бюджет на рекламу"
                value={budget} onChange={setBudget} suffix="$"
              />
            </div>
          )}

          {/* Funnel */}
          <div className="mt-8 rounded-2xl border border-border/60 bg-card/40 p-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-success">
              <Calculator className="h-4 w-4" />
              {mode === "revenue"
                ? "Обратная воронка — от выручки к бюджету"
                : "Прямая воронка — от бюджета к выручке"}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
              <FunnelStep
                icon={DollarSign} label="Целевая выручка"
                value={fmtT(calc.revenue)} highlight
              />
              <FunnelArrow />
              <FunnelStep
                icon={Target} label="Нужно продаж"
                value={fmt(calc.sales)} sub={`чек ${fmtT(avgCheck)}`}
              />
              <FunnelArrow />
              <FunnelStep
                icon={Users} label="Нужно диагностик"
                value={fmt(calc.visits)} sub={`CR ${crVisitSale}% → продажа`}
              />
              <FunnelArrow />
              <FunnelStep
                icon={UserPlus} label="Нужно лидов"
                value={fmt(calc.leads)} sub={`CR ${crLeadVisit}% → диагностика`}
              />
              <FunnelArrow />
              <FunnelStep
                icon={Wallet} label="Бюджет на рекламу"
                value={fmtT(calc.spend)} sub={`CPL ${fmtT(cpl)}`} highlight
              />
            </div>
          </div>

          {/* Summary table */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
            <div className="border-b border-border/60 px-6 py-4">
              <span className="text-xs font-bold uppercase tracking-wider">
                Сводная таблица
              </span>
            </div>
            <div className="divide-y divide-border/40">
              <div className="bg-card/30 px-6 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Блок 1: Затраты
              </div>
              <Row label="Расходы на рекламу (Бюджет)" value={fmtT(calc.spend)} />

              <div className="bg-card/30 px-6 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Блок 2: Воронка и стоимость
              </div>
              <Row label="Количество лидов" value={fmt(calc.leads)} />
              <Row label="Стоимость лида (CPL)" value={fmtT(cpl)} />
              <Row label="Количество визитов / диагностик" value={fmt(calc.visits)} />
              <Row label="Стоимость визита (CPV)" value={fmtT(cpv)} />
              <Row label="Количество продаж" value={fmt(calc.sales)} />
              <Row label="Стоимость продажи / клиента (CAC)" value={fmtT(cac)} />

              <div className="bg-card/30 px-6 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Блок 3: Финансовый итог
              </div>
              <Row label="Прогнозная выручка" value={fmtT(calc.revenue)} />
              <Row label="Реальный ROMI" value={`${fmt(romi)}%`} />
            </div>
          </div>

          {/* KPI cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi icon={Wallet} label="Расходы" value={fmtT(calc.spend)} sub={`${fmt(calc.leads)} лидов × ${fmtT(cpl)}`} />
            <Kpi icon={UserPlus} label="Лиды" value={fmt(calc.leads)} sub={`CR ${crLeadVisit}% → визит`} />
            <Kpi icon={DollarSign} label="CPL" value={fmtT(cpl)} sub="Стоимость лида" />
            <Kpi icon={Users} label="Визиты" value={fmt(calc.visits)} sub={`CR ${crVisitSale}% → продажа`} />
            <Kpi icon={Target} label="Оплаты" value={fmt(calc.sales)} sub="Стоимость CAC" />
            <Kpi icon={TrendingUp} label="Выручка" value={fmtT(calc.revenue)} sub="Прогноз по чеку" highlight />
          </div>

          {/* Save */}
          <div className="mt-6 rounded-2xl border border-border/60 bg-card/40 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Save className="h-4 w-4 text-success" />
              Сохранить план в Таблицу показателей
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              План будет сохранён: Расходы {fmtT(calc.spend)} · Лиды {fmt(calc.leads)} ·
              CPL {fmtT(cpl)} · Визиты {fmt(calc.visits)} · Оплаты {fmt(calc.sales)} ·
              Выручка {fmtT(calc.revenue)}
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1 rounded-2xl border border-border/60 bg-card/60 px-2 py-1.5">
                <button
                  onClick={() => shiftMonth(-1)}
                  className="grid h-9 w-9 place-items-center rounded-xl hover:bg-secondary"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-3 text-sm font-semibold capitalize tabular-nums">
                  {monthLabel}
                </span>
                <button
                  onClick={() => shiftMonth(1)}
                  className="grid h-9 w-9 place-items-center rounded-xl hover:bg-secondary"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <Button
                onClick={handleSave}
                className="h-12 flex-1 gap-2 rounded-2xl bg-success text-success-foreground hover:bg-success/90"
              >
                <Save className="h-4 w-4" />
                Сохранить план на {MONTHS_RU[monthCursor.getMonth()]}
              </Button>
            </div>
          </div>
        </>
      )}
    </main>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between px-6 py-3">
    <span className="text-sm">{label}</span>
    <span className="text-sm font-bold tabular-nums text-success">{value}</span>
  </div>
);

const Kpi = ({
  icon: Icon, label, value, sub, highlight,
}: {
  icon: React.ElementType; label: string; value: string; sub: string; highlight?: boolean;
}) => (
  <div className={cn(
    "rounded-2xl border p-4",
    highlight ? "border-success/40 bg-success/5" : "border-border/60 bg-card/40",
  )}>
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
    <div className={cn(
      "mt-2 text-xl font-bold tabular-nums",
      highlight && "text-success",
    )}>
      {value}
    </div>
    <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
  </div>
);

export default Finance;
