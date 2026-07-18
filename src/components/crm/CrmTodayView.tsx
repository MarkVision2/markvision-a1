import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ListTodo,
  Sparkles,
  Target,
  UserRoundCheck,
  Users,
} from "lucide-react";
import type { ManagerStats } from "@/hooks/useCrmAnalytics";
import { buildSalesCommandCenter } from "@/lib/salesCommandCenter";
import type { Lead } from "@/types/crm";
import { reportFmt } from "@/components/reports/reportFormat";
import { cn } from "@/lib/utils";

interface Props {
  leads: Lead[];
  managerStats: ManagerStats[];
  paidPct: number;
  rejectedPct: number;
  avgResponseMin: number;
  onOpenLead: (lead: Lead) => void;
  onOpenFunnel: () => void;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function CrmTodayView({
  leads,
  managerStats,
  paidPct,
  rejectedPct,
  avgResponseMin,
  onOpenLead,
  onOpenFunnel,
}: Props) {
  const now = Date.now();
  const center = buildSalesCommandCenter({
    leads,
    managerStats,
    paidPct,
    rejectedPct,
    avgResponseMin,
    now,
  });
  const visits = leads
    .filter((lead) => lead.nextVisitAt)
    .filter((lead) => {
      const date = new Date(lead.nextVisitAt as string);
      const current = new Date(now);
      return date.getFullYear() === current.getFullYear()
        && date.getMonth() === current.getMonth()
        && date.getDate() === current.getDate();
    })
    .sort((a, b) => new Date(a.nextVisitAt as string).getTime() - new Date(b.nextVisitAt as string).getTime());
  const overdueTasks = leads
    .flatMap((lead) =>
      (lead.tasks ?? [])
        .filter((task) => !task.doneAt && new Date(task.dueAt).getTime() < now)
        .map((task) => ({ lead, task })),
    )
    .sort((a, b) => new Date(a.task.dueAt).getTime() - new Date(b.task.dueAt).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-3xl border border-success/25 bg-card/50">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--success)/0.13),transparent_45%)]" />
        <div className="relative flex flex-col justify-between gap-4 p-5 sm:p-6 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-success">
              <Sparkles className="h-4 w-4" />
              Рабочий стол CRM
            </div>
            <h2 className="mt-2 text-xl font-bold sm:text-2xl">Что важно сделать сегодня</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Лиды отсортированы по реальному риску: просроченная задача, SLA ответа, отсутствие движения и AI-потенциал.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenFunnel}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-success px-4 text-xs font-bold text-success-foreground transition-opacity hover:opacity-90"
          >
            Открыть воронку
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <div className="relative grid grid-cols-2 gap-3 border-t border-border/50 p-5 sm:grid-cols-3 sm:p-6 xl:grid-cols-6">
          {[
            { label: "В работе", value: String(center.activeLeads), hint: "активных лидов", icon: Users, tone: "text-primary" },
            { label: "Горят", value: String(center.urgentLeads), hint: "без ответа >15 мин", icon: AlertTriangle, tone: center.urgentLeads ? "text-destructive" : "text-success" },
            { label: "Задачи", value: String(center.overdueTasks), hint: "просрочено", icon: ListTodo, tone: center.overdueTasks ? "text-warning" : "text-success" },
            { label: "Визиты", value: String(center.todayVisits), hint: "сегодня", icon: CalendarCheck2, tone: "text-success" },
            { label: "Воронка", value: reportFmt.fmtTenge(center.pipelineValue), hint: "потенциал", icon: CircleDollarSign, tone: "text-foreground" },
            { label: "Прогноз", value: reportFmt.fmtTenge(center.weightedForecast), hint: "по AI-score", icon: Target, tone: "text-success" },
          ].map(({ label, value, hint, icon: Icon, tone }) => (
            <div key={label} className="rounded-2xl border border-border/55 bg-background/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                <Icon className={cn("h-3.5 w-3.5", tone)} />
              </div>
              <div className={cn("mt-2 text-lg font-bold tabular-nums sm:text-xl", tone)}>{value}</div>
              <div className="mt-0.5 text-[9px] text-muted-foreground">{hint}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-border/60 bg-card/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold">Очередь на сегодня</h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">нажмите на лида, чтобы сразу начать работу</p>
            </div>
            <span className="rounded-full border border-border/50 px-2 py-1 text-[10px] font-semibold">
              {center.priorityLeads.length}
            </span>
          </div>
          {center.priorityLeads.length === 0 ? (
            <div className="mt-3 grid min-h-48 place-items-center rounded-xl border border-dashed border-border/50 text-center text-xs text-muted-foreground">
              <div>
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-success" />
                Очередь пуста — срочных действий нет
              </div>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-border/40">
              {center.priorityLeads.map(({ lead, label, reason }, index) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onOpenLead(lead)}
                  className="group flex w-full items-center gap-3 py-3 text-left first:pt-0 last:pb-0"
                >
                  <span className="w-5 shrink-0 text-center text-xs font-bold text-muted-foreground">{index + 1}</span>
                  <span className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold",
                    reason === "sla" || reason === "overdue_task"
                      ? "bg-destructive/12 text-destructive"
                      : reason === "stale"
                        ? "bg-warning/12 text-warning"
                        : "bg-primary/12 text-primary",
                  )}>
                    {lead.aiScore}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold">{lead.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{label} · {lead.source}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-bold tabular-nums">{reportFmt.fmtTenge(lead.amount || 0)}</div>
                    <div className="text-[9px] text-muted-foreground">{lead.phone}</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <section className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="h-4 w-4 text-success" />
              <h3 className="text-sm font-bold">Визиты сегодня</h3>
            </div>
            <div className="mt-3 space-y-2">
              {visits.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/50 p-4 text-center text-[11px] text-muted-foreground">
                  На сегодня визитов нет
                </p>
              ) : visits.slice(0, 5).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onOpenLead(lead)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/45 bg-background/25 p-2.5 text-left hover:border-success/30"
                >
                  <span className="rounded-lg bg-success/12 px-2 py-1 text-xs font-bold tabular-nums text-success">
                    {timeLabel(lead.nextVisitAt as string)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{lead.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{lead.service || lead.phone}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-warning" />
              <h3 className="text-sm font-bold">Просроченные задачи</h3>
            </div>
            <div className="mt-3 space-y-2">
              {overdueTasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/50 p-4 text-center text-[11px] text-muted-foreground">
                  Все задачи выполнены вовремя
                </p>
              ) : overdueTasks.slice(0, 5).map(({ lead, task }) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenLead(lead)}
                  className="flex w-full items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.035] p-2.5 text-left hover:border-destructive/35"
                >
                  <ListTodo className="h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{task.title}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{lead.name}</div>
                  </div>
                  <span className="text-[10px] font-semibold tabular-nums text-destructive">
                    {timeLabel(task.dueAt)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {center.topManager && (
            <section className="rounded-2xl border border-success/25 bg-success/[0.045] p-4 sm:col-span-2 xl:col-span-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-success">
                <UserRoundCheck className="h-4 w-4" />
                Лидер команды
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">{center.topManager.member.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {center.topManager.paid} оплат · CR {center.topManager.conversion.toFixed(0)}%
                  </div>
                </div>
                <div className="text-base font-bold tabular-nums text-success">
                  {reportFmt.fmtTenge(center.topManager.revenue)}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
