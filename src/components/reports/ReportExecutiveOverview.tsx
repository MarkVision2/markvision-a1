import { useMemo } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  CircleAlert,
  CircleDollarSign,
  Database,
  Lightbulb,
  Minus,
  MousePointerClick,
  ReceiptText,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { ReportData } from "@/hooks/useReportData";
import {
  buildReportExecutive,
  type ReportAction,
  type ReportStatus,
} from "@/lib/reportExecutive";
import { pickCreativeTitle } from "@/lib/creativeDisplay";
import { cn } from "@/lib/utils";
import { reportFmt } from "./reportFormat";

interface Props {
  data: ReportData;
  comparing: boolean;
}

function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">без сравнения</span>;
  }
  const positive = invert ? value <= 0 : value >= 0;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1", positive ? "text-success" : "text-destructive")}>
      <Icon className="h-3 w-3" />
      {Math.abs(value).toFixed(0)}% к прошлому периоду
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
  invertDelta,
  tone = "default",
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  delta: number | null;
  invertDelta?: boolean;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <div className={cn(
      "rounded-2xl border p-4",
      tone === "success"
        ? "border-success/30 bg-success/[0.06]"
        : tone === "danger"
          ? "border-destructive/30 bg-destructive/[0.05]"
          : "border-border/50 bg-card/35",
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          {label}
        </span>
        <Icon className={cn(
          "h-4 w-4",
          tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : "text-muted-foreground",
        )} />
      </div>
      <div className="mt-3 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-2 text-[10px] font-medium">
        <Delta value={delta} invert={invertDelta} />
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<ReportStatus["tone"], string> = {
  success: "border-success/35 bg-success/10 text-success",
  default: "border-primary/35 bg-primary/10 text-primary",
  warning: "border-warning/35 bg-warning/10 text-warning",
  muted: "border-border/60 bg-secondary/30 text-muted-foreground",
};

const ACTION_STYLES: Record<ReportAction["tone"], string> = {
  success: "border-success/30 bg-success/[0.05]",
  warning: "border-warning/30 bg-warning/[0.05]",
  danger: "border-destructive/30 bg-destructive/[0.05]",
  info: "border-primary/25 bg-primary/[0.04]",
};

function TrendBars({ data }: { data: ReportData["monthlyMeta"] }) {
  const points = useMemo(() => {
    if (data.length <= 14) return data;
    const chunkSize = Math.ceil(data.length / 14);
    return Array.from({ length: Math.ceil(data.length / chunkSize) }, (_, index) => {
      const chunk = data.slice(index * chunkSize, (index + 1) * chunkSize);
      return {
        date: chunk.at(-1)?.date ?? "",
        spend: chunk.reduce((sum, point) => sum + point.spend, 0),
        leads: chunk.reduce((sum, point) => sum + point.leads, 0),
        revenue: chunk.reduce((sum, point) => sum + point.revenue, 0),
      };
    });
  }, [data]);
  const max = Math.max(...points.flatMap((point) => [point.spend, point.revenue]), 1);

  if (points.length === 0) {
    return (
      <div className="grid h-40 place-items-center rounded-xl border border-dashed border-border/50 text-xs text-muted-foreground">
        Динамика появится после синхронизации
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-40 items-end gap-1.5">
        {points.map((point) => (
          <div key={point.date} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
            <div
              className="w-1/2 min-w-[3px] rounded-t bg-primary/60 transition-colors group-hover:bg-primary"
              style={{ height: point.spend > 0 ? `${Math.max(2, (point.spend / max) * 100)}%` : "0%" }}
            />
            <div
              className="w-1/2 min-w-[3px] rounded-t bg-success/60 transition-colors group-hover:bg-success"
              style={{ height: point.revenue > 0 ? `${Math.max(2, (point.revenue / max) * 100)}%` : "0%" }}
            />
            <div className="pointer-events-none absolute bottom-full z-10 mb-2 hidden w-40 rounded-lg border border-border/60 bg-popover p-2 text-[10px] shadow-xl group-hover:block">
              <div className="font-semibold">{point.date}</div>
              <div className="mt-1 text-muted-foreground">Расход: {reportFmt.fmtTenge(point.spend)}</div>
              <div className="text-muted-foreground">Выручка: {reportFmt.fmtTenge(point.revenue)}</div>
              <div className="text-muted-foreground">Заявки: {point.leads}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
        <span>{points[0]?.date}</span>
        <span className="flex items-center gap-3">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-primary/70" />Расход</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-success/70" />Выручка</span>
        </span>
        <span>{points.at(-1)?.date}</span>
      </div>
    </div>
  );
}

export function ReportExecutiveOverview({ data, comparing }: Props) {
  const executive = useMemo(
    () => buildReportExecutive({ data, comparing }),
    [data, comparing],
  );
  const { totals } = data;
  const profitPositive = executive.profit >= 0;
  const bestTitle = executive.bestCreative
    ? pickCreativeTitle(executive.bestCreative).title
    : null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card/30">
      <div className="relative border-b border-border/50 p-5 sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--success)/0.12),transparent_42%)]" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-success">
                <Sparkles className="h-4 w-4" />
                Центр решений
              </span>
              <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold", STATUS_STYLES[executive.status.tone])}>
                {executive.status.label}
              </span>
            </div>
            <h2 className="mt-3 max-w-3xl text-xl font-bold sm:text-2xl">
              {executive.status.description}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Сводка объединяет Meta, CRM, оплаты, каналы и креативы. Ниже — цифры, узкое место и следующие действия.
            </p>
          </div>
          <div className={cn(
            "min-w-[230px] rounded-2xl border p-4",
            profitPositive ? "border-success/30 bg-success/[0.06]" : "border-destructive/30 bg-destructive/[0.05]",
          )}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              Выручка минус реклама
            </div>
            <div className={cn("mt-1 text-3xl font-bold tabular-nums", profitPositive ? "text-success" : "text-destructive")}>
              {reportFmt.fmtTenge(executive.profit)}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Выручка CRM минус рекламный расход
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 p-5 sm:p-7 lg:grid-cols-4">
        <MetricCard icon={Wallet} label="Расход" value={reportFmt.fmtTenge(totals.spend)} delta={executive.deltas.spend} invertDelta />
        <MetricCard icon={ReceiptText} label="Выручка CRM" value={reportFmt.fmtTenge(totals.revenue)} delta={executive.deltas.revenue} tone={totals.revenue > 0 ? "success" : "default"} />
        <MetricCard icon={Users} label="Заявки" value={reportFmt.fmtNum(totals.totalLeads)} delta={executive.deltas.leads} />
        <MetricCard icon={CircleDollarSign} label="Продажи" value={reportFmt.fmtNum(totals.sales)} delta={executive.deltas.sales} tone={totals.spend > 0 && totals.sales === 0 ? "danger" : "default"} />
      </div>

      <div className="grid gap-5 border-t border-border/50 p-5 sm:p-7 xl:grid-cols-[1.25fr_0.75fr]">
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">Расход и подтверждённая выручка</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Динамика внутри выбранного периода</p>
            </div>
            <span className="rounded-full border border-border/50 bg-secondary/25 px-2.5 py-1 text-[10px] font-semibold">
              ROMI {totals.romi >= 0 ? "+" : ""}{Math.round(totals.romi)}%
            </span>
          </div>
          <TrendBars data={data.monthlyMeta} />
        </div>

        <div className="rounded-2xl border border-border/50 bg-secondary/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Полнота данных</h3>
            </div>
            <span className="text-lg font-bold tabular-nums">{executive.dataHealth.score}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary/50">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-success" style={{ width: `${executive.dataHealth.score}%` }} />
          </div>
          <div className="mt-4 space-y-2 text-xs">
            {[
              ["Meta расходы и показы", executive.dataHealth.metaConnected],
              ["CRM заявки", executive.dataHealth.crmConnected],
              ["Продажи и выручка", executive.dataHealth.revenueConnected],
            ].map(([label, ready]) => (
              <div key={String(label)} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{label}</span>
                <span className={cn("inline-flex items-center gap-1 font-semibold", ready ? "text-success" : "text-warning")}>
                  {ready ? <BadgeCheck className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                  {ready ? "Есть" : "Нет"}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Атрибуция CRM → креатив</span>
              <span className="font-semibold tabular-nums">{Math.round(executive.dataHealth.creativeAttribution)}%</span>
            </div>
          </div>
          {bestTitle && (
            <div className="mt-4 rounded-xl border border-success/25 bg-success/[0.05] p-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-success">
                <TrendingUp className="h-3.5 w-3.5" />
                Лидер по выручке
              </div>
              <div className="mt-1 line-clamp-2 text-xs font-semibold">{bestTitle}</div>
              <div className="mt-1 text-sm font-bold tabular-nums text-success">
                {reportFmt.fmtTenge(executive.bestCreative?.crmRevenue ?? 0)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/50 p-5 sm:p-7">
        <div className="mb-4 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-bold">Что делать дальше</h3>
          <span className="text-xs text-muted-foreground">по приоритету</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {executive.actions.map((action, index) => (
            <article key={action.key} className={cn("rounded-2xl border p-4", ACTION_STYLES[action.tone])}>
              <div className="flex items-center justify-between">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-background/40 text-[10px] font-bold">
                  {index + 1}
                </span>
                {action.key === "bottleneck" ? <Target className="h-4 w-4 text-warning" /> : <MousePointerClick className="h-4 w-4 text-muted-foreground" />}
              </div>
              <h4 className="mt-3 text-sm font-bold">{action.title}</h4>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{action.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
