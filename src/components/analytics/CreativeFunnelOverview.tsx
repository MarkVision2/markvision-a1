import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Crown,
  Link2,
  ShoppingCart,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { CreativePreview } from "@/components/creatives/CreativePreview";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";
import {
  buildCreativeDecisionSummary,
  metaLeadCount,
  sumCreativeTableTotals,
} from "@/lib/creativeFunnelUtils";
import { pickCreativeTitle } from "@/lib/creativeDisplay";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00a0")}\u00a0₸`;
const fmtPct = (n: number) => `${n >= 10 ? Math.round(n) : n.toFixed(1)}%`;

interface Props {
  rows: MetaCreativeRow[];
  totalProjectCrmLeads: number;
  displayMetaLeads: number;
  onOpenCreative: (row: MetaCreativeRow) => void;
}

export function CreativeFunnelOverview({
  rows,
  totalProjectCrmLeads,
  displayMetaLeads,
  onOpenCreative,
}: Props) {
  const summary = buildCreativeDecisionSummary(rows, totalProjectCrmLeads);
  const totals = sumCreativeTableTotals(rows);
  const riskShare = summary.spend > 0 ? (summary.riskSpend / summary.spend) * 100 : 0;
  const romi = summary.spend > 0
    ? ((summary.revenue - summary.spend) / summary.spend) * 100
    : null;
  const winners = rows
    .filter((row) => row.spend > 0 && row.crmSales > 0 && row.crmRevenue > row.spend)
    .sort((a, b) => b.crmProfit - a.crmProfit || b.crmRevenue - a.crmRevenue)
    .slice(0, 3);

  const stages = [
    { label: "Результаты Meta", value: displayMetaLeads, color: "bg-primary" },
    { label: "Привязано к CRM", value: totals.crmLeads, color: "bg-cyan-500" },
    { label: "Квалифицировано", value: totals.crmQualified, color: "bg-violet-500" },
    { label: "Диагностики", value: totals.crmDiagnostics, color: "bg-amber-500" },
    { label: "Продажи", value: totals.crmSales, color: "bg-success" },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/60 bg-card/50 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold">Центр решений по креативам</h2>
                <p className="text-xs text-muted-foreground">
                  Деньги и реальные продажи из CRM важнее кликов. Сигналы ниже не ставят рекламу на паузу автоматически.
                </p>
              </div>
            </div>
          </div>
          <div
            className={cn(
              "rounded-full px-3 py-1 text-xs font-bold",
              romi == null && "bg-secondary text-muted-foreground",
              romi != null && romi >= 0 && "bg-success/15 text-success",
              romi != null && romi < 0 && "bg-destructive/15 text-destructive",
            )}
          >
            ROMI CRM {romi == null ? "—" : `${romi >= 0 ? "+" : ""}${Math.round(romi)}%`}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <SummaryCard
            icon={Wallet}
            label="Расход"
            value={summary.spend > 0 ? fmtTenge(summary.spend) : "—"}
            hint={`${rows.filter((r) => r.spend > 0).length} креативов с доставкой`}
          />
          <SummaryCard
            icon={CircleDollarSign}
            label="Выручка CRM"
            value={summary.revenue > 0 ? fmtTenge(summary.revenue) : "—"}
            hint={`${summary.sales} продаж`}
            tone={summary.revenue > 0 ? "success" : undefined}
          />
          <SummaryCard
            icon={summary.profit >= 0 ? CheckCircle2 : AlertTriangle}
            label="Прибыль"
            value={summary.revenue > 0 ? fmtTenge(summary.profit) : "—"}
            hint={summary.revenue > 0 ? "Выручка минус реклама" : "Появится после оплат"}
            tone={summary.revenue > 0 ? (summary.profit >= 0 ? "success" : "danger") : undefined}
          />
          <SummaryCard
            icon={Crown}
            label="Победители"
            value={fmtNum(summary.winners)}
            hint="Есть продажи и прибыль"
            tone={summary.winners > 0 ? "success" : undefined}
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Расход под риском"
            value={summary.riskSpend > 0 ? fmtTenge(summary.riskSpend) : "—"}
            hint={summary.riskSpend > 0 ? `${fmtPct(riskShare)} рекламного расхода` : "Проблемных сигналов нет"}
            tone={summary.riskSpend > 0 ? "warning" : undefined}
          />
        </div>

        <div className="mt-4 rounded-xl border border-border/50 bg-background/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Link2 className="h-3.5 w-3.5 text-primary" />
              Покрытие атрибуцией
            </div>
            <div className="text-xs tabular-nums">
              <span className="font-bold">{fmtPct(summary.attributionCoverage)}</span>
              <span className="text-muted-foreground">
                {" "}· {fmtNum(summary.attributedCrmLeads)} из {fmtNum(totalProjectCrmLeads)} CRM-лидов
              </span>
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary/50">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                summary.attributionCoverage >= 80 ? "bg-success" : summary.attributionCoverage >= 50 ? "bg-warning" : "bg-destructive",
              )}
              style={{ width: `${summary.attributionCoverage}%` }}
            />
          </div>
          {summary.unattributedCrmLeads > 0 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {fmtNum(summary.unattributedCrmLeads)} CRM-лидов не привязаны к ad.id — они не участвуют в сравнении креативов.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Общая воронка атрибутированных креативов</h3>
            <p className="text-[11px] text-muted-foreground">Показывает, где теряется результат после рекламы</p>
          </div>
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stages.map((stage, index) => {
            const prev = index > 0 ? stages[index - 1].value : null;
            const conversion = prev != null && prev > 0 ? (stage.value / prev) * 100 : null;
            return (
              <div key={stage.label} className="relative rounded-xl border border-border/50 bg-background/50 p-3">
                {index > 0 && (
                  <ArrowRight className="absolute -left-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground lg:block" />
                )}
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {stage.label}
                </div>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <span className="text-xl font-bold tabular-nums">{fmtNum(stage.value)}</span>
                  {conversion != null && (
                    <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {fmtPct(conversion)}
                    </span>
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary/50">
                  <div
                    className={cn("h-full rounded-full", stage.color)}
                    style={{
                      width: `${displayMetaLeads > 0 ? Math.min(100, (stage.value / displayMetaLeads) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {winners.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h3 className="text-base font-semibold">Креативы-победители</h3>
              <p className="text-xs text-muted-foreground">Ранжирование по прибыли CRM, не по кликам Meta</p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {winners.map((row, index) => {
              const title = pickCreativeTitle({ name: row.name, headline: row.headline }).title;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onOpenCreative(row)}
                  className="group flex min-w-0 gap-3 rounded-2xl border border-success/30 bg-success/5 p-3 text-left transition hover:bg-success/10"
                >
                  <div className="relative shrink-0">
                    <CreativePreview row={row} compact className="h-20 w-14 rounded-lg ring-1 ring-success/30" />
                    <span className="absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-success text-[10px] font-bold text-white">
                      {index + 1}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-semibold">{title}</div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <span className="text-muted-foreground">Прибыль</span>
                      <span className="text-right font-bold text-success">{fmtTenge(row.crmProfit)}</span>
                      <span className="text-muted-foreground">Продажи</span>
                      <span className="text-right font-bold">{fmtNum(row.crmSales)}</span>
                      <span className="text-muted-foreground">ROMI</span>
                      <span className="text-right font-bold text-success">+{Math.round(row.crmRomi)}%</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "danger" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-background/50 px-3 py-3",
        tone === "success" && "border-success/30 bg-success/5",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
        tone === "warning" && "border-warning/30 bg-warning/5",
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
