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
  Sparkles,
  Percent,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
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
  if (!isFinite(n) || isNaN(n) || n === 0) return n === 0 ? `0\u00A0₸` : "—";
  return `${fmt(n)}\u00A0₸`;
};

type Mode = "revenue" | "budget";
type Tab = "decomp" | "agency" | "dynamics";

/* -------------------- Smart numeric input -------------------- */

interface SmartInputProps {
  icon: React.ElementType;
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
  disabled?: boolean;
  highlight?: boolean;
  placeholder?: string;
}

const SmartInput = ({
  icon: Icon, label, hint, value, onChange, suffix, disabled, highlight, placeholder,
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
    <div className={cn(
      "group relative rounded-2xl border p-4 transition-all",
      disabled
        ? "border-border/40 bg-card/30 opacity-60"
        : highlight
          ? "border-success/40 bg-success/5 shadow-[0_0_0_1px_hsl(var(--success)/0.15)]"
          : "border-border/60 bg-card/60 hover:border-success/30 focus-within:border-success/50 focus-within:shadow-[0_0_0_1px_hsl(var(--success)/0.2)]",
    )}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", highlight && "text-success")} />
        <span>{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <Input
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={(e) => handle(e.target.value)}
          disabled={disabled}
          placeholder={placeholder ?? "0"}
          className="h-auto border-0 bg-transparent p-0 text-2xl font-bold tabular-nums shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/30"
        />
        <span className="text-sm font-semibold text-muted-foreground">{suffix}</span>
      </div>
      {hint && (
        <div className="mt-1.5 text-[11px] text-muted-foreground/80">{hint}</div>
      )}
    </div>
  );
};

/* -------------------- CR slider -------------------- */

const CrSlider = ({
  icon: Icon, label, value, onChange,
}: {
  icon: React.ElementType; label: string; value: number; onChange: (v: number) => void;
}) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-success/30">
    <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
      <span className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="rounded-md bg-success/15 px-2 py-0.5 text-sm font-bold tabular-nums text-success">
        {value}%
      </span>
    </div>
    <Slider
      className="mt-4"
      min={0} max={100} step={0.5}
      value={[value]}
      onValueChange={(v) => onChange(v[0] ?? 0)}
    />
    <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground/70">
      <span>0%</span><span>50%</span><span>100%</span>
    </div>
  </div>
);

/* -------------------- Funnel step -------------------- */

interface FunnelStepProps {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  step: number;
}

const FunnelStep = ({ icon: Icon, label, value, sub, highlight, step }: FunnelStepProps) => (
  <div className={cn(
    "relative flex-1 overflow-hidden rounded-2xl border p-5 transition-all",
    highlight
      ? "border-success/50 bg-gradient-to-br from-success/10 to-success/5 shadow-[0_0_24px_-8px_hsl(var(--success)/0.5)]"
      : "border-border/60 bg-card/40 hover:border-border",
  )}>
    <div className="absolute right-3 top-3 text-[10px] font-bold tabular-nums text-muted-foreground/40">
      {String(step).padStart(2, "0")}
    </div>
    <span className={cn(
      "grid h-10 w-10 place-items-center rounded-xl",
      highlight ? "bg-success/20 text-success" : "bg-secondary text-muted-foreground",
    )}>
      <Icon className="h-5 w-5" />
    </span>
    <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
    <div className={cn(
      "mt-1.5 text-2xl font-bold tabular-nums",
      highlight ? "text-success" : "text-foreground",
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

/* -------------------- Page -------------------- */

const Finance = () => {
  const [tab, setTab] = useState<Tab>("decomp");
  const [mode, setMode] = useState<Mode>("revenue");
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const { savePlan, getPlan } = useFinancePlans();

  // Inputs (sensible defaults so funnel never looks "dead")
  const [revenue, setRevenue] = useState(5_000_000);
  const [avgCheck, setAvgCheck] = useState(1_000_000);
  const [crLeadVisit, setCrLeadVisit] = useState(10);
  const [crVisitSale, setCrVisitSale] = useState(20);
  const [cpl, setCpl] = useState(2_000);
  const [budget, setBudget] = useState(500_000);
  const [taxRate, setTaxRate] = useState(10); // %

  useEffect(() => {
    const p = getPlan(monthKey(monthCursor));
    if (p) {
      setRevenue(p.revenue || 5_000_000);
      setAvgCheck(p.avgCheck || 1_000_000);
      setCrLeadVisit(p.crLeadVisit || 10);
      setCrVisitSale(p.crVisitSale || 20);
      setCpl(p.cpl || 2_000);
      setBudget(p.spend || 500_000);
    }
  }, [monthCursor, getPlan]);

  const calc = useMemo(() => {
    const safe = (n: number) => (isFinite(n) && !isNaN(n) ? n : 0);
    if (mode === "revenue") {
      const sales = avgCheck > 0 ? safe(revenue / avgCheck) : 0;
      const visits = crVisitSale > 0 ? safe(sales / (crVisitSale / 100)) : 0;
      const leads = crLeadVisit > 0 ? safe(visits / (crLeadVisit / 100)) : 0;
      const spend = leads * cpl;
      return { sales, visits, leads, spend, revenue };
    }
    const leads = cpl > 0 ? safe(budget / cpl) : 0;
    const visits = leads * (crLeadVisit / 100);
    const sales = visits * (crVisitSale / 100);
    const rev = sales * avgCheck;
    return { sales, visits, leads, spend: budget, revenue: rev };
  }, [mode, revenue, avgCheck, crLeadVisit, crVisitSale, cpl, budget]);

  const cpv = calc.visits > 0 ? calc.spend / calc.visits : 0;
  const cac = calc.sales > 0 ? calc.spend / calc.sales : 0;
  const tax = calc.revenue * (taxRate / 100);
  const profit = calc.revenue - calc.spend - tax;
  const romi = calc.spend > 0 ? ((calc.revenue - calc.spend) / calc.spend) * 100 : 0;
  const margin = calc.revenue > 0 ? (profit / calc.revenue) * 100 : 0;

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
          {/* Mode + live indicator */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-2xl border border-border/60 bg-card/60 p-1.5">
              {([
                { id: "revenue" as const, label: "От целевой выручки", icon: Target },
                { id: "budget" as const, label: "От бюджета", icon: Wallet },
              ]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                    mode === m.id
                      ? "bg-success/15 text-success"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <m.icon className="h-4 w-4" />
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Расчёт в реальном времени
            </div>
          </div>

          {/* Inputs */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SmartInput
              icon={Target} label="Целевая выручка"
              hint={mode === "budget" ? "Рассчитывается из бюджета" : "Сколько хотим заработать за месяц"}
              value={revenue} onChange={setRevenue}
              suffix="₸" disabled={mode === "budget"}
              highlight={mode === "revenue"}
            />
            <SmartInput
              icon={Receipt} label="Средний чек"
              hint="Сколько в среднем платит один клиент"
              value={avgCheck} onChange={setAvgCheck} suffix="₸"
            />
            <SmartInput
              icon={DollarSign} label="Стоимость лида (CPL)"
              hint="Сколько стоит один лид"
              value={cpl} onChange={setCpl} suffix="₸"
            />
            <CrSlider
              icon={Percent} label="CR лид → диагностика"
              value={crLeadVisit} onChange={setCrLeadVisit}
            />
            <CrSlider
              icon={Percent} label="CR диагностика → продажа"
              value={crVisitSale} onChange={setCrVisitSale}
            />
            <SmartInput
              icon={Wallet} label="Бюджет на рекламу"
              hint={mode === "revenue" ? "Рассчитывается из выручки" : "Сколько готовы вложить за месяц"}
              value={mode === "revenue" ? Math.round(calc.spend) : budget}
              onChange={setBudget}
              suffix="₸" disabled={mode === "revenue"}
              highlight={mode === "budget"}
            />
          </div>

          {/* Funnel */}
          <div className="mt-8 rounded-2xl border border-border/60 bg-gradient-to-br from-card/60 to-card/30 p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-success">
                <Sparkles className="h-4 w-4" />
                {mode === "revenue"
                  ? "Обратная воронка — от выручки к бюджету"
                  : "Прямая воронка — от бюджета к выручке"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Обновляется автоматически
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
              <FunnelStep
                step={1} icon={DollarSign} label="Целевая выручка"
                value={fmtT(calc.revenue)} highlight={mode === "revenue"}
              />
              <FunnelArrow />
              <FunnelStep
                step={2} icon={Target} label="Нужно продаж"
                value={fmt(calc.sales)} sub={`чек ${fmtT(avgCheck)}`}
              />
              <FunnelArrow />
              <FunnelStep
                step={3} icon={Users} label="Нужно диагностик"
                value={fmt(calc.visits)} sub={`CR ${crVisitSale}% → продажа`}
              />
              <FunnelArrow />
              <FunnelStep
                step={4} icon={UserPlus} label="Нужно лидов"
                value={fmt(calc.leads)} sub={`CR ${crLeadVisit}% → диагностика`}
              />
              <FunnelArrow />
              <FunnelStep
                step={5} icon={Wallet} label="Бюджет на рекламу"
                value={fmtT(calc.spend)} sub={`CPL ${fmtT(cpl)}`}
                highlight={mode === "budget"}
              />
            </div>
          </div>

          {/* KPI cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={DollarSign} label="CPL" value={fmtT(cpl)} sub="Стоимость лида" />
            <Kpi icon={Users} label="CPD" value={fmtT(cpv)} sub="Стоимость диагностики" />
            <Kpi icon={Target} label="CAC" value={fmtT(cac)} sub="Стоимость клиента" />
            <Kpi icon={TrendingUp} label="ROMI" value={`${fmt(romi)}%`}
              sub="Возврат на маркетинг" highlight={romi > 0} />
          </div>

          {/* P&L */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40">
              <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
                <span className="text-xs font-bold uppercase tracking-wider">
                  Финансовый итог
                </span>
                <span className="text-[11px] text-muted-foreground">{monthLabel}</span>
              </div>
              <div className="divide-y divide-border/40">
                <Row label="Прогнозная выручка" value={fmtT(calc.revenue)} accent="success" big />
                <Row label="Расходы на рекламу" value={`− ${fmtT(calc.spend)}`} />
                <Row label={`Налоги (${taxRate}%)`} value={`− ${fmtT(tax)}`} />
                <Row label="Чистая прибыль" value={fmtT(profit)} accent={profit >= 0 ? "success" : "destructive"} big />
                <Row label="Маржинальность" value={`${fmt(margin)}%`} accent={margin >= 0 ? "success" : "destructive"} />
                <Row label="ROMI" value={`${fmt(romi)}%`} accent={romi >= 0 ? "success" : "destructive"} />
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Налог на выручку
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <Input
                  type="number"
                  value={taxRate || ""}
                  onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
                  className="h-auto border-0 bg-transparent p-0 text-3xl font-bold tabular-nums shadow-none focus-visible:ring-0"
                />
                <span className="text-lg font-semibold text-muted-foreground">%</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Применяется к прогнозной выручке для расчёта чистой прибыли.
              </p>
            </div>
          </div>

          {/* Save */}
          <div className="mt-6 rounded-2xl border border-border/60 bg-card/40 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Save className="h-4 w-4 text-success" />
              Сохранить план в Таблицу показателей
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Расходы {fmtT(calc.spend)} · Лиды {fmt(calc.leads)} ·
              CPL {fmtT(cpl)} · Диагностики {fmt(calc.visits)} · Оплаты {fmt(calc.sales)} ·
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

const Row = ({
  label, value, accent, big,
}: {
  label: string; value: string; accent?: "success" | "destructive"; big?: boolean;
}) => (
  <div className="flex items-center justify-between px-6 py-3">
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
      "mt-2 text-2xl font-bold tabular-nums",
      highlight && "text-success",
    )}>
      {value}
    </div>
    <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
  </div>
);

export default Finance;
