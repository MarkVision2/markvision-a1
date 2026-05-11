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
  ArrowRight,
  Percent,
  Receipt,
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

const fmt = (n: number) => {
  if (!isFinite(n) || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("ru-RU");
};
const fmtT = (n: number) => {
  if (!isFinite(n) || isNaN(n)) return "—";
  return `${fmt(n)} ₸`;
};

type Tab = "decomp" | "agency" | "dynamics";

interface SmartInputProps {
  icon: React.ElementType;
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
  placeholder?: string;
}

const SmartInput = ({
  icon: Icon, label, hint, value, onChange, suffix, placeholder,
}: SmartInputProps) => {
  const [raw, setRaw] = useState<string>(value ? String(value) : "");

  useEffect(() => {
    setRaw(value ? String(value) : "");
  }, [value]);

  const handle = (v: string) => {
    const cleaned = v.replace(/[^\d.,]/g, "").replace(",", ".");
    setRaw(cleaned);
    onChange(Number(cleaned) || 0);
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-success/30 focus-within:border-success/50">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <Input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={(e) => handle(e.target.value)}
          placeholder={placeholder ?? "0"}
          className="h-auto border-0 bg-transparent p-0 text-2xl font-bold tabular-nums shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/30"
        />
        <span className="text-sm font-semibold text-muted-foreground">{suffix}</span>
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-muted-foreground/80">{hint}</div>
      )}
    </div>
  );
};

interface FunnelStepProps {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  step: number;
  primary?: boolean;
}

const FunnelStep = ({ icon: Icon, label, value, sub, step, primary }: FunnelStepProps) => (
  <div className={cn(
    "relative flex-1 overflow-hidden rounded-2xl border p-4 transition-all",
    primary
      ? "border-success/50 bg-gradient-to-br from-success/10 to-success/5 shadow-[0_0_24px_-8px_hsl(var(--success)/0.5)]"
      : "border-border/60 bg-card/40",
  )}>
    <div className="absolute right-3 top-3 text-[10px] font-bold tabular-nums text-muted-foreground/40">
      {String(step).padStart(2, "0")}
    </div>
    <span className={cn(
      "grid h-9 w-9 place-items-center rounded-xl",
      primary ? "bg-success/20 text-success" : "bg-secondary text-muted-foreground",
    )}>
      <Icon className="h-4 w-4" />
    </span>
    <div className="mt-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
    <div className={cn(
      "mt-1 text-xl font-bold tabular-nums",
      primary ? "text-success" : "text-foreground",
    )}>
      {value}
    </div>
    {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
  </div>
);

const FunnelArrow = () => (
  <div className="hidden items-center justify-center px-1 lg:flex">
    <ArrowRight className="h-4 w-4 text-success/40" />
  </div>
);

const Finance = () => {
  const [tab, setTab] = useState<Tab>("decomp");
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const { savePlan, getPlan } = useFinancePlans();

  // Inputs in linear order: бюджет → CPL → CR1 → CR2 → чек.
  const [budget, setBudget] = useState(500_000);
  const [cpl, setCpl] = useState(2_000);
  const [crLeadVisit, setCrLeadVisit] = useState(20);
  const [crVisitSale, setCrVisitSale] = useState(40);
  const [avgCheck, setAvgCheck] = useState(500_000);

  useEffect(() => {
    const p = getPlan(monthKey(monthCursor));
    if (p) {
      setBudget(p.spend || 500_000);
      setCpl(p.cpl || 2_000);
      setCrLeadVisit(p.crLeadVisit || 20);
      setCrVisitSale(p.crVisitSale || 40);
      setAvgCheck(p.avgCheck || 500_000);
    }
  }, [monthCursor, getPlan]);

  const calc = useMemo(() => {
    const safe = (n: number) => (isFinite(n) && !isNaN(n) ? n : 0);
    const leads = cpl > 0 ? safe(budget / cpl) : 0;
    const visits = leads * (crLeadVisit / 100);
    const sales = visits * (crVisitSale / 100);
    const revenue = sales * avgCheck;
    return { leads, visits, sales, revenue };
  }, [budget, cpl, crLeadVisit, crVisitSale, avgCheck]);

  const cpv = calc.visits > 0 ? budget / calc.visits : 0;
  const cac = calc.sales > 0 ? budget / calc.sales : 0;
  const profit = calc.revenue - budget;
  const romi = budget > 0 ? ((calc.revenue - budget) / budget) * 100 : 0;
  const margin = calc.revenue > 0 ? (profit / calc.revenue) * 100 : 0;

  const shiftMonth = (delta: number) =>
    setMonthCursor((p) => new Date(p.getFullYear(), p.getMonth() + delta, 1));
  const monthLabel = `${MONTHS_RU[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`;

  const handleSave = () => {
    savePlan(monthKey(monthCursor), {
      spend: Math.round(budget),
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
    <main className="container max-w-7xl py-6 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-success/15 text-success ring-1 ring-success/30">
          <Wallet className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Финансы</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Юнит-экономика, агентская аналитика и динамика
          </p>
        </div>
      </div>

      <div className="mt-5 inline-flex flex-wrap rounded-xl border border-border/60 bg-card/60 p-1">
        {([
          { id: "decomp", label: "Декомпозиция", icon: Calculator },
          { id: "agency", label: "Агентская аналитика", icon: CircleDollarSign },
          { id: "dynamics", label: "Динамика по месяцам", icon: LineChart },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              tab === t.id
                ? "bg-success/15 text-success"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "agency" && <AgencyAnalytics />}
      {tab === "dynamics" && <MonthlyDynamics />}

      {tab === "decomp" && (
        <>
          <div className="mt-5 rounded-xl border border-border/60 bg-card/40 p-3 text-xs text-muted-foreground">
            Введите бюджет и пройдите вниз по воронке — справа считается результат: <span className="text-foreground">бюджет</span> → лиды → диагностики → продажи → <span className="text-success">выручка</span>.
          </div>

          {/* Inputs: linear left-to-right Бюджет → CPL → CR1 → CR2 → чек */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SmartInput
              icon={Wallet} label="Бюджет на месяц"
              hint="Сколько готовы вложить в рекламу"
              value={budget} onChange={setBudget} suffix="₸"
            />
            <SmartInput
              icon={DollarSign} label="Стоимость лида (CPL)"
              hint="Цена одной заявки"
              value={cpl} onChange={setCpl} suffix="₸"
            />
            <SmartInput
              icon={Percent} label="CR лид → диагностика"
              hint="Какой процент лидов доходит до диагностики"
              value={crLeadVisit} onChange={(v) => setCrLeadVisit(Math.min(100, Math.max(0, v)))}
              suffix="%"
            />
            <SmartInput
              icon={Percent} label="CR диагностика → продажа"
              hint="Какой процент диагностик закрывается в продажу"
              value={crVisitSale} onChange={(v) => setCrVisitSale(Math.min(100, Math.max(0, v)))}
              suffix="%"
            />
            <SmartInput
              icon={Receipt} label="Средний чек"
              hint="Сколько платит один клиент"
              value={avgCheck} onChange={setAvgCheck} suffix="₸"
            />
          </div>

          {/* Funnel: forward */}
          <div className="mt-5 rounded-2xl border border-border/60 bg-gradient-to-br from-card/60 to-card/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-success">
              Воронка — от бюджета к выручке
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
              {(() => {
                const order = [
                  <FunnelStep
                    key="b" step={1} icon={Wallet} label="Бюджет"
                    value={fmtT(budget)} sub={`CPL ${fmtT(cpl)}`}
                  />,
                  <FunnelStep
                    key="l" step={2} icon={UserPlus} label="Лиды"
                    value={fmt(calc.leads)} sub={`CR ${crLeadVisit}% → диагностика`}
                  />,
                  <FunnelStep
                    key="v" step={3} icon={Users} label="Диагностики"
                    value={fmt(calc.visits)} sub={`CR ${crVisitSale}% → продажа`}
                  />,
                  <FunnelStep
                    key="s" step={4} icon={Target} label="Продажи"
                    value={fmt(calc.sales)} sub={`чек ${fmtT(avgCheck)}`}
                  />,
                  <FunnelStep
                    key="r" step={5} icon={DollarSign} label="Выручка"
                    value={fmtT(calc.revenue)} primary
                  />,
                ];
                return order.map((s, i) => (
                  <div key={i} className="contents">
                    {s}
                    {i < order.length - 1 && <FunnelArrow />}
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* KPI cards */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={DollarSign} label="CPL" value={fmtT(cpl)} sub="Стоимость лида" />
            <Kpi icon={Users} label="CPD" value={fmtT(cpv)} sub="Стоимость диагностики" />
            <Kpi icon={Target} label="CAC" value={fmtT(cac)} sub="Стоимость клиента" />
            <Kpi icon={TrendingUp} label="ROMI" value={`${fmt(romi)}%`}
              sub="Возврат на маркетинг" highlight={romi > 0} />
          </div>

          {/* P&L */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <span className="text-xs font-bold uppercase tracking-wider">
                Финансовый итог
              </span>
              <span className="text-[11px] text-muted-foreground">{monthLabel}</span>
            </div>
            <div className="divide-y divide-border/40">
              <Row label="Прогнозная выручка" value={fmtT(calc.revenue)} accent="success" big />
              <Row label="Расходы на рекламу" value={`− ${fmtT(budget)}`} />
              <Row label="Прибыль" value={fmtT(profit)} accent={profit >= 0 ? "success" : "destructive"} big />
              <Row label="Маржинальность" value={`${fmt(margin)}%`} accent={margin >= 0 ? "success" : "destructive"} />
              <Row label="ROMI" value={`${fmt(romi)}%`} accent={romi >= 0 ? "success" : "destructive"} />
            </div>
          </div>

          {/* Save */}
          <div className="mt-4 rounded-2xl border border-border/60 bg-card/40 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Save className="h-4 w-4 text-success" />
              Сохранить план в Таблицу показателей
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Бюджет {fmtT(budget)} · Лиды {fmt(calc.leads)} ·
              CPL {fmtT(cpl)} · Диагностики {fmt(calc.visits)} · Продажи {fmt(calc.sales)} ·
              Выручка {fmtT(calc.revenue)}
            </p>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-card/60 px-2 py-1">
                <button
                  onClick={() => shiftMonth(-1)}
                  className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 text-xs font-semibold capitalize tabular-nums">
                  {monthLabel}
                </span>
                <button
                  onClick={() => shiftMonth(1)}
                  className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <Button
                onClick={handleSave}
                className="h-10 flex-1 gap-2 rounded-xl bg-success text-success-foreground hover:bg-success/90"
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

const Row = ({
  label, value, accent, big,
}: {
  label: string; value: string; accent?: "success" | "destructive"; big?: boolean;
}) => (
  <div className="flex items-center justify-between px-5 py-2.5">
    <span className={cn("text-sm", big && "font-semibold")}>{label}</span>
    <span className={cn(
      "tabular-nums font-bold",
      big ? "text-base" : "text-sm",
      accent === "success" && "text-success",
      accent === "destructive" && "text-destructive",
      !accent && "text-foreground",
    )}>{value}</span>
  </div>
);

const Kpi = ({
  icon: Icon, label, value, sub, highlight,
}: {
  icon: React.ElementType; label: string; value: string; sub: string; highlight?: boolean;
}) => (
  <div className={cn(
    "rounded-2xl border p-4 transition-colors",
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
    <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
  </div>
);

export default Finance;
