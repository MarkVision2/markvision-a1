import { useMemo } from "react";
import { AlertTriangle, Clock, MoveRight, Timer, Users2, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { stageColorClasses } from "@/components/crm/StageIcon";
import {
  formatDuration,
  formatHours,
  type RejectReasonRow,
  type SlaMetrics,
  type StageBucket,
} from "@/hooks/useCrmFlow";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

interface SlaCardsProps {
  sla: SlaMetrics;
  periodLeadsTotal: number;
}

export function SlaCards({ sla, periodLeadsTotal }: SlaCardsProps) {
  const cards = [
    {
      key: "avg",
      icon: Timer,
      label: "Среднее время до ответа",
      value: periodLeadsTotal > 0 ? formatDuration(sla.avgResponseMin) : "—",
      hint: periodLeadsTotal > 0
        ? `медиана ${formatDuration(sla.medResponseMin)}`
        : "нет заявок в периоде",
      tone: sla.avgResponseMin <= 15 ? "success" : sla.avgResponseMin <= 60 ? "warning" : "destructive",
    },
    {
      key: "p5",
      icon: Zap,
      label: "Отвечено за ≤ 5 мин",
      value: periodLeadsTotal > 0 ? `${Math.round(sla.pctUnder5)}%` : "—",
      hint: "сколько из ответивших",
      tone: sla.pctUnder5 >= 60 ? "success" : sla.pctUnder5 >= 30 ? "warning" : "destructive",
    },
    {
      key: "p15",
      icon: Clock,
      label: "Отвечено за ≤ 15 мин",
      value: periodLeadsTotal > 0 ? `${Math.round(sla.pctUnder15)}%` : "—",
      hint: "целевой SLA",
      tone: sla.pctUnder15 >= 80 ? "success" : sla.pctUnder15 >= 50 ? "warning" : "destructive",
    },
    {
      key: "await",
      icon: AlertTriangle,
      label: "Ждут первого касания",
      value: fmtNum(sla.awaitingFirstTouch),
      hint: sla.awaitingOver15 > 0 ? `${fmtNum(sla.awaitingOver15)} > 15 мин` : "всё в SLA",
      tone: sla.awaitingOver15 > 0 ? "destructive" : sla.awaitingFirstTouch > 0 ? "warning" : "success",
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.key}
            className="rounded-2xl border border-border/60 bg-card/60 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Icon className="h-3 w-3" />
                {c.label}
              </span>
            </div>
            <div
              className={cn(
                "mt-2 text-2xl font-bold tabular-nums",
                c.tone === "success" && "text-success",
                c.tone === "warning" && "text-warning",
                c.tone === "destructive" && "text-destructive",
              )}
            >
              {c.value}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</div>
          </div>
        );
      })}
    </div>
  );
}

interface StageDistributionProps {
  stages: StageBucket[];
  totalActive: number;
}

export function StageDistribution({ stages, totalActive }: StageDistributionProps) {
  if (stages.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        Пока нет активных заявок в воронке.
      </div>
    );
  }

  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground/90">
          <MoveRight className="h-3.5 w-3.5" />
          Сейчас в воронке
        </span>
        <span className="text-xs text-muted-foreground">
          активных: <span className="font-semibold text-foreground tabular-nums">{fmtNum(totalActive)}</span>
        </span>
      </div>

      <div className="space-y-2.5">
        {stages.map((s) => {
          const pct = (s.count / max) * 100;
          const overdue = s.maxHoursStuck >= 48;
          const warn = s.maxHoursStuck >= 24 && !overdue;
          const palette = stageColorClasses(s.color);
          return (
            <div key={s.stageId} className="grid grid-cols-[160px_1fr_auto] items-center gap-3">
              <div className="flex items-center gap-2 truncate text-xs">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", palette.bar)} />
                <span className="truncate font-medium">{s.title}</span>
              </div>
              <div className="relative h-8 overflow-hidden rounded-lg border border-border/40 bg-secondary/20">
                <div
                  className={cn(
                    "h-full bg-gradient-to-r",
                    overdue && "from-destructive/40 to-destructive/15",
                    warn && "from-warning/35 to-warning/15",
                    !overdue && !warn && "from-primary/30 to-primary/10",
                  )}
                  style={{ width: `${Math.max(pct, s.count > 0 ? 6 : 0)}%` }}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold tabular-nums">
                  {fmtNum(s.count)}
                </span>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                  висит ⌀ {formatHours(s.avgHoursStuck)}
                </span>
              </div>
              <div
                className={cn(
                  "min-w-[80px] text-right text-[11px] tabular-nums",
                  overdue && "font-semibold text-destructive",
                  warn && "text-warning",
                  !overdue && !warn && "text-muted-foreground",
                )}
              >
                max {formatHours(s.maxHoursStuck)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RejectReasonsProps {
  reasons: RejectReasonRow[];
}

export function RejectReasonsCard({ reasons }: RejectReasonsProps) {
  const total = useMemo(() => reasons.reduce((s, r) => s + r.count, 0), [reasons]);

  if (reasons.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        <XCircle className="mx-auto mb-2 h-5 w-5 text-success" />
        Отказов в этом периоде нет — отличный результат.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground/90">
          <XCircle className="h-3.5 w-3.5 text-destructive" />
          Топ-5 причин отказа
        </span>
        <span className="text-xs text-muted-foreground">
          всего: <span className="font-semibold text-foreground tabular-nums">{fmtNum(total)}</span>
        </span>
      </div>
      <div className="space-y-2">
        {reasons.map((r) => (
          <div key={r.reason} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
            <div className="truncate text-sm">{r.label}</div>
            <div className="relative h-2 w-24 overflow-hidden rounded-full bg-secondary/30">
              <div
                className="h-full bg-gradient-to-r from-destructive/60 to-destructive/30"
                style={{ width: `${Math.max(r.share, 4)}%` }}
              />
            </div>
            <div className="min-w-[64px] text-right text-xs tabular-nums">
              <span className="font-semibold">{fmtNum(r.count)}</span>
              <span className="ml-1 text-muted-foreground">· {Math.round(r.share)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface PanelProps {
  sla: SlaMetrics;
  stages: StageBucket[];
  reasons: RejectReasonRow[];
  activeLeadsTotal: number;
  periodLeadsTotal: number;
}

export function CrmFlowPanel({ sla, stages, reasons, activeLeadsTotal, periodLeadsTotal }: PanelProps) {
  return (
    <div className="space-y-4">
      <SlaCards sla={sla} periodLeadsTotal={periodLeadsTotal} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <StageDistribution stages={stages} totalActive={activeLeadsTotal} />
        </div>
        <div>
          <RejectReasonsCard reasons={reasons} />
        </div>
      </div>
      {/* Подсказка для пустого периода */}
      {periodLeadsTotal === 0 && activeLeadsTotal === 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
          <Users2 className="mx-auto mb-2 h-5 w-5" />
          В выбранном периоде нет ни одной заявки в CRM.
        </div>
      )}
    </div>
  );
}
