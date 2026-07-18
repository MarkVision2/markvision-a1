import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  Gauge,
  MessageSquare,
  Phone,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import type { ManagerStats } from "@/hooks/useCrmAnalytics";
import {
  buildSalesCommandCenter,
  type SalesPriority,
} from "@/lib/salesCommandCenter";
import type { Lead } from "@/types/crm";
import { cn } from "@/lib/utils";
import { reportFmt } from "@/components/reports/reportFormat";

interface Props {
  leads: Lead[];
  managerStats: ManagerStats[];
  paidPct: number;
  rejectedPct: number;
  avgResponseMin: number;
  onOpenLead: (leadId: string) => void;
  onOpenTab: (tab: "calls" | "chats" | "managers" | "trainer") => void;
}

const PRIORITY_STYLES: Record<SalesPriority["tone"], string> = {
  success: "border-success/30 bg-success/[0.06]",
  warning: "border-warning/30 bg-warning/[0.06]",
  danger: "border-destructive/30 bg-destructive/[0.06]",
  info: "border-primary/30 bg-primary/[0.06]",
};

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <div className={cn(
      "rounded-2xl border p-4",
      tone === "success" && "border-success/30 bg-success/[0.05]",
      tone === "warning" && "border-warning/30 bg-warning/[0.05]",
      tone === "danger" && "border-destructive/30 bg-destructive/[0.05]",
      tone === "default" && "border-border/60 bg-card/45",
    )}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          {label}
        </span>
        <Icon className={cn(
          "h-4 w-4",
          tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-destructive" : "text-primary",
        )} />
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

export function AiRopCommandCenter({
  leads,
  managerStats,
  paidPct,
  rejectedPct,
  avgResponseMin,
  onOpenLead,
  onOpenTab,
}: Props) {
  const center = buildSalesCommandCenter({
    leads,
    managerStats,
    paidPct,
    rejectedPct,
    avgResponseMin,
  });
  const healthTone = center.healthScore >= 80
    ? "text-success"
    : center.healthScore >= 55
      ? "text-warning"
      : "text-destructive";

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-card/45">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.14),transparent_42%)]" />
        <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_250px] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">
                <Sparkles className="h-4 w-4" />
                Командный центр продаж
              </span>
              <span className="rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[10px] font-semibold">
                данные CRM в реальном времени
              </span>
            </div>
            <h2 className="mt-3 text-xl font-bold sm:text-2xl">
              {center.priorities[0]?.title ?? "Продажи под контролем"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {center.priorities[0]?.detail ?? "AI РОП следит за скоростью ответа, задачами, движением сделок и работой менеджеров."}
            </p>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {[
                { tab: "calls" as const, label: "Разбор звонков", icon: Phone },
                { tab: "chats" as const, label: "Разбор чатов", icon: MessageSquare },
                { tab: "managers" as const, label: "Команда", icon: Users },
                { tab: "trainer" as const, label: "Тренажёр", icon: Target },
              ].map(({ tab, label, icon: Icon }) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onOpenTab(tab)}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border/60 bg-background/35 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Здоровье отдела
                </div>
                <div className={cn("mt-1 text-4xl font-black tabular-nums", healthTone)}>
                  {center.healthScore}
                  <span className="text-lg">/100</span>
                </div>
              </div>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Gauge className="h-6 w-6" />
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary/50">
              <div
                className={cn(
                  "h-full rounded-full",
                  center.healthScore >= 80 ? "bg-success" : center.healthScore >= 55 ? "bg-warning" : "bg-destructive",
                )}
                style={{ width: `${center.healthScore}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{center.activeLeads} активных сделок</span>
              <span>{center.urgentLeads} требуют ответа</span>
            </div>
          </div>
        </div>

        <div className="relative grid grid-cols-2 gap-3 border-t border-border/50 p-5 sm:p-6 lg:grid-cols-5">
          <Metric icon={Users} label="В работе" value={String(center.activeLeads)} hint="активных лидов" />
          <Metric icon={CircleDollarSign} label="Воронка" value={reportFmt.fmtTenge(center.pipelineValue)} hint="потенциал сделок" />
          <Metric icon={TrendingUp} label="AI-прогноз" value={reportFmt.fmtTenge(center.weightedForecast)} hint="с учётом score" tone="success" />
          <Metric icon={CalendarClock} label="Визиты сегодня" value={String(center.todayVisits)} hint="по расписанию" tone={center.todayVisits > 0 ? "success" : "default"} />
          <Metric icon={Clock3} label="Просрочено" value={String(center.overdueTasks)} hint="задач менеджеров" tone={center.overdueTasks > 0 ? "danger" : "success"} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border border-border/60 bg-card/45 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h3 className="text-sm font-bold">Приоритеты РОПа</h3>
            <span className="text-[10px] text-muted-foreground">по влиянию на выручку</span>
          </div>
          <div className="mt-3 space-y-2">
            {center.priorities.map((priority, index) => (
              <article key={priority.key} className={cn("rounded-xl border p-3", PRIORITY_STYLES[priority.tone])}>
                <div className="flex items-start gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-background/45 text-[10px] font-bold">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold">{priority.title}</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{priority.detail}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {center.topManager && (
            <div className="mt-3 rounded-xl border border-success/25 bg-success/[0.05] p-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-success">
                <BadgeCheck className="h-3.5 w-3.5" />
                Лидер команды
              </div>
              <div className="mt-1 flex items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">{center.topManager.member.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {center.topManager.paid} оплат · CR {center.topManager.conversion.toFixed(0)}%
                  </div>
                </div>
                <div className="text-sm font-bold tabular-nums text-success">
                  {reportFmt.fmtTenge(center.topManager.revenue)}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border/60 bg-card/45 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">Кого обработать сейчас</h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">задачи → SLA → без движения → высокий AI-score</p>
            </div>
            <span className="rounded-full border border-border/50 px-2 py-1 text-[10px] font-semibold">
              топ {center.priorityLeads.length}
            </span>
          </div>
          {center.priorityLeads.length === 0 ? (
            <div className="mt-3 grid min-h-36 place-items-center rounded-xl border border-dashed border-border/50 text-center text-xs text-muted-foreground">
              Приоритетные лиды появятся после подключения входящего потока
            </div>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {center.priorityLeads.map(({ lead, label, reason }) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onOpenLead(lead.id)}
                  className="group flex items-center gap-3 rounded-xl border border-border/55 bg-background/30 p-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.04]"
                >
                  <span className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold",
                    reason === "overdue_task" || reason === "sla"
                      ? "bg-destructive/12 text-destructive"
                      : reason === "stale"
                        ? "bg-warning/12 text-warning"
                        : "bg-primary/12 text-primary",
                  )}>
                    {lead.aiScore}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold">{lead.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{label}</div>
                    <div className="mt-0.5 text-[10px] tabular-nums text-foreground/75">
                      {reportFmt.fmtTenge(lead.amount || 0)}
                    </div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
