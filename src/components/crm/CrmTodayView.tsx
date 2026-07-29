import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  ListTodo,
  MessageCircle,
  Users,
} from "lucide-react";
import type { ManagerStats } from "@/hooks/useCrmAnalytics";
import {
  buildSalesCommandCenter,
  type PriorityLead,
} from "@/lib/salesCommandCenter";
import type { Lead } from "@/types/crm";
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

const SECTION_META: Record<
  PriorityLead["reason"],
  { title: string; hint: string; tone: string }
> = {
  sla: {
    title: "Нужно ответить",
    hint: "новые лиды без ответа менеджера",
    tone: "border-destructive/30 bg-destructive/[0.04]",
  },
  overdue_task: {
    title: "Просроченные задачи",
    hint: "срок уже прошёл",
    tone: "border-warning/30 bg-warning/[0.04]",
  },
  stale: {
    title: "Давно без движения",
    hint: "нет активности больше 2 дней — верните в диалог",
    tone: "border-border/60 bg-card/40",
  },
  high_score: {
    title: "В работе",
    hint: "можно взять следующими",
    tone: "border-border/60 bg-card/40",
  },
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function stageLabel(stageId: string): string {
  const map: Record<string, string> = {
    new: "Новый",
    no_answer: "Недозвон",
    bot_activated: "Бот",
    whatsapp: "Бот",
    joined_group: "В группе",
    confirmed: "Подтвердил",
    attended: "Был на эфире",
    in_progress: "В работе",
    scheduled: "Запись",
    visit: "Визит",
    deposit: "Бронь",
    paid: "Оплата",
    rejected: "Отказ",
  };
  return map[stageId] ?? stageId;
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

  const focus = center.priorities[0];
  const newToday = leads.filter((l) => {
    const d = new Date(l.createdAt);
    const n = new Date(now);
    return (
      d.getFullYear() === n.getFullYear()
      && d.getMonth() === n.getMonth()
      && d.getDate() === n.getDate()
    );
  }).length;

  const visits = leads
    .filter((lead) => lead.nextVisitAt)
    .filter((lead) => {
      const date = new Date(lead.nextVisitAt as string);
      const current = new Date(now);
      return (
        date.getFullYear() === current.getFullYear()
        && date.getMonth() === current.getMonth()
        && date.getDate() === current.getDate()
      );
    })
    .sort(
      (a, b) =>
        new Date(a.nextVisitAt as string).getTime()
        - new Date(b.nextVisitAt as string).getTime(),
    );

  const byReason = (reason: PriorityLead["reason"]) =>
    center.priorityLeads.filter((item) => item.reason === reason);

  const sections: PriorityLead["reason"][] = ["sla", "overdue_task", "stale", "high_score"];
  const hasQueue = center.priorityLeads.length > 0;

  return (
    <div className="space-y-4">
      {/* One clear focus */}
      <section
        className={cn(
          "rounded-2xl border p-4 sm:p-5",
          focus?.tone === "danger" && "border-destructive/35 bg-destructive/[0.06]",
          focus?.tone === "warning" && "border-warning/35 bg-warning/[0.06]",
          focus?.tone === "success" && "border-success/30 bg-success/[0.06]",
          focus?.tone === "info" && "border-border/60 bg-card/50",
          !focus && "border-border/60 bg-card/50",
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Главное сейчас
            </p>
            <h2 className="mt-1 text-lg font-bold sm:text-xl">
              {focus?.title ?? "Сегодня без срочных дел"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {focus?.detail
                ?? "Откройте воронку или чаты, когда появятся новые лиды."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {focus?.count ? (
              <span className="inline-flex h-10 items-center rounded-xl border border-border/50 bg-background/50 px-3 text-sm font-bold tabular-nums">
                {focus.count}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onOpenFunnel}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-success px-4 text-xs font-bold text-success-foreground hover:opacity-90"
            >
              Воронка
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              label: "Новые сегодня",
              value: newToday,
              icon: Users,
            },
            {
              label: "Ждут ответа",
              value: center.urgentLeads,
              icon: MessageCircle,
              alert: center.urgentLeads > 0,
            },
            {
              label: "Просрочено задач",
              value: center.overdueTasks,
              icon: ListTodo,
              alert: center.overdueTasks > 0,
            },
            {
              label: "Тишина 2+ дня",
              value: center.staleLeads,
              icon: Clock3,
              alert: center.staleLeads > 0,
            },
          ].map(({ label, value, icon: Icon, alert }) => (
            <div
              key={label}
              className="rounded-xl border border-border/50 bg-background/40 px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
                <Icon
                  className={cn(
                    "h-3.5 w-3.5",
                    alert ? "text-destructive" : "text-muted-foreground",
                  )}
                />
              </div>
              <div
                className={cn(
                  "mt-1 text-xl font-bold tabular-nums",
                  alert ? "text-destructive" : "text-foreground",
                )}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className={cn("grid gap-4", visits.length > 0 ? "xl:grid-cols-[1.4fr_0.6fr]" : "")}>
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-bold">Кому писать сегодня</h3>
            <p className="text-xs text-muted-foreground">
              Сначала те, кто ждёт ответа. Нажмите строку — откроется карточка.
            </p>
          </div>

          {!hasQueue ? (
            <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-border/50 text-center text-sm text-muted-foreground">
              <div>
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-success" />
                Срочных лидов нет
              </div>
            </div>
          ) : (
            sections.map((reason) => {
              const rows = byReason(reason);
              if (rows.length === 0) return null;
              const meta = SECTION_META[reason];
              return (
                <div
                  key={reason}
                  className={cn("overflow-hidden rounded-2xl border", meta.tone)}
                >
                  <div className="flex items-baseline justify-between gap-2 border-b border-border/40 px-4 py-2.5">
                    <div>
                      <h4 className="text-sm font-bold">{meta.title}</h4>
                      <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
                    </div>
                    <span className="text-xs font-bold tabular-nums text-muted-foreground">
                      {rows.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-border/35">
                    {rows.map(({ lead, label, action }) => (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => onOpenLead(lead)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background/40"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{lead.name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                              <span className="font-medium text-foreground/80">{label}</span>
                              <span>·</span>
                              <span>{stageLabel(lead.stageId)}</span>
                              {lead.source ? (
                                <>
                                  <span>·</span>
                                  <span>{lead.source}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold",
                              reason === "sla" || reason === "overdue_task"
                                ? "bg-destructive/15 text-destructive"
                                : "bg-secondary text-foreground",
                            )}
                          >
                            {action}
                            <ArrowRight className="h-3 w-3" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>

        {visits.length > 0 && (
          <aside className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="h-4 w-4 text-success" />
              <h3 className="text-sm font-bold">Визиты сегодня</h3>
            </div>
            <div className="mt-3 space-y-2">
              {visits.slice(0, 6).map((lead) => (
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
                    <div className="truncate text-[10px] text-muted-foreground">
                      {lead.service || lead.phone}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
