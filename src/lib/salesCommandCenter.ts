import type { ManagerStats } from "@/hooks/useCrmAnalytics";
import type { Lead } from "@/types/crm";

export type SalesPriorityKey =
  | "no_leads"
  | "urgent_sla"
  | "overdue_tasks"
  | "stale_leads"
  | "high_rejects"
  | "healthy";

export interface SalesPriority {
  key: SalesPriorityKey;
  title: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "info";
  count: number;
}

export interface PriorityLead {
  lead: Lead;
  reason: "overdue_task" | "sla" | "stale" | "high_score";
  label: string;
  /** Short next step shown in the Today queue */
  action: string;
  score: number;
}

export interface SalesCommandCenterInput {
  leads: Lead[];
  managerStats: ManagerStats[];
  paidPct: number;
  rejectedPct: number;
  avgResponseMin: number;
  now?: number;
}

export interface SalesCommandCenter {
  activeLeads: number;
  pipelineValue: number;
  weightedForecast: number;
  urgentLeads: number;
  overdueTasks: number;
  todayVisits: number;
  staleLeads: number;
  healthScore: number;
  priorities: SalesPriority[];
  priorityLeads: PriorityLead[];
  topManager: ManagerStats | null;
}

const TERMINAL_STAGE_KEYS = new Set([
  "paid",
  "rejected",
  "refused",
  "lost",
  "оплачен",
  "отказ",
  "потерян",
]);

function isTerminal(lead: Lead): boolean {
  return Boolean(lead.paid) || TERMINAL_STAGE_KEYS.has(lead.stageId.toLowerCase().trim());
}

function sameDay(iso: string, reference: Date): boolean {
  const value = new Date(iso);
  return value.getFullYear() === reference.getFullYear()
    && value.getMonth() === reference.getMonth()
    && value.getDate() === reference.getDate();
}

function minutesBetween(earlierIso: string, now: number): number {
  const value = new Date(earlierIso).getTime();
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, (now - value) / 60_000);
}

export function buildSalesCommandCenter({
  leads,
  managerStats,
  paidPct,
  rejectedPct,
  avgResponseMin,
  now = Date.now(),
}: SalesCommandCenterInput): SalesCommandCenter {
  const active = leads.filter((lead) => !isTerminal(lead));
  const urgent = active.filter((lead) => {
    if (lead.firstResponseAt) return false;
    const stage = lead.stageId.toLowerCase();
    const waitingStage =
      stage === "new"
      || stage === "no_answer"
      || stage === "bot_activated"
      || stage === "whatsapp";
    return waitingStage && minutesBetween(lead.createdAt, now) >= 15;
  });
  const overdueLeadIds = new Set<string>();
  let overdueTasks = 0;
  for (const lead of active) {
    for (const task of lead.tasks ?? []) {
      if (!task.doneAt && new Date(task.dueAt).getTime() < now) {
        overdueTasks += 1;
        overdueLeadIds.add(lead.id);
      }
    }
  }
  const stale = active.filter(
    (lead) => minutesBetween(lead.lastActivityAt, now) >= 48 * 60,
  );
  const reference = new Date(now);
  const todayVisits = active.filter(
    (lead) => lead.nextVisitAt && sameDay(lead.nextVisitAt, reference),
  ).length;

  const priorities: SalesPriority[] = [];
  if (leads.length === 0) {
    priorities.push({
      key: "no_leads",
      title: "Подключите входящий поток",
      detail: "Лидов пока нет — проверьте формы, WhatsApp и рекламные интеграции.",
      tone: "info",
      count: 0,
    });
  } else {
    if (urgent.length > 0) {
      priorities.push({
        key: "urgent_sla",
        title: "Срочно ответить новым лидам",
        detail: `${urgent.length} лидов ждут первого ответа больше 15 минут.`,
        tone: "danger",
        count: urgent.length,
      });
    }
    if (overdueTasks > 0) {
      priorities.push({
        key: "overdue_tasks",
        title: "Закрыть просроченные задачи",
        detail: `${overdueTasks} задач просрочено — они теряют сделки прямо сейчас.`,
        tone: "warning",
        count: overdueTasks,
      });
    }
    if (stale.length > 0) {
      priorities.push({
        key: "stale_leads",
        title: "Вернуть сделки без активности",
        detail: `${stale.length} активных лидов без движения больше 48 часов.`,
        tone: "warning",
        count: stale.length,
      });
    }
    if (rejectedPct >= 30) {
      priorities.push({
        key: "high_rejects",
        title: "Разобрать причины отказов",
        detail: `${rejectedPct.toFixed(0)}% лидов потеряно — обновите скрипт по главному возражению.`,
        tone: "danger",
        count: Math.round((leads.length * rejectedPct) / 100),
      });
    }
    if (priorities.length === 0) {
      priorities.push({
        key: "healthy",
        title: "Продажи под контролем",
        detail: `SLA и задачи в норме, конверсия в оплату ${paidPct.toFixed(0)}%.`,
        tone: "success",
        count: 0,
      });
    }
  }

  const urgentIds = new Set(urgent.map((lead) => lead.id));
  const staleIds = new Set(stale.map((lead) => lead.id));
  const priorityLeads = active
    .map((lead): PriorityLead => {
      if (overdueLeadIds.has(lead.id)) {
        return {
          lead,
          reason: "overdue_task",
          label: "Просрочена задача",
          action: "Закрыть задачу",
          score: 400 + lead.aiScore,
        };
      }
      if (urgentIds.has(lead.id)) {
        const waited = Math.round(minutesBetween(lead.createdAt, now));
        return {
          lead,
          reason: "sla",
          label: waited >= 60
            ? `Ждёт ответа ${Math.round(waited / 60)} ч`
            : `Ждёт ответа ${waited} мин`,
          action: "Ответить",
          score: 300 + lead.aiScore,
        };
      }
      if (staleIds.has(lead.id)) {
        return {
          lead,
          reason: "stale",
          label: "Тишина больше 2 дней",
          action: "Написать",
          score: 200 + lead.aiScore,
        };
      }
      return {
        lead,
        reason: "high_score",
        label: lead.stageId === "new" ? "Новый лид" : "В работе",
        action: "Открыть",
        score: lead.aiScore,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const activeCount = active.length || 1;
  const responsePenalty = Math.min(20, Math.max(0, avgResponseMin - 5));
  const healthScore = leads.length === 0
    ? 100
    : Math.max(
        0,
        Math.round(
          100
          - (urgent.length / activeCount) * 30
          - Math.min(25, (overdueTasks / activeCount) * 25)
          - rejectedPct * 0.25
          - responsePenalty,
        ),
      );
  const topManager = managerStats
    .filter((manager) => manager.assigned > 0 || manager.paid > 0 || manager.revenue > 0)
    .sort(
    (a, b) =>
      b.revenue - a.revenue
      || b.conversion - a.conversion
      || b.paid - a.paid,
  )[0] ?? null;

  return {
    activeLeads: active.length,
    pipelineValue: active.reduce((sum, lead) => sum + Math.max(0, lead.amount || 0), 0),
    weightedForecast: active.reduce(
      (sum, lead) => sum + Math.max(0, lead.amount || 0) * Math.min(100, Math.max(0, lead.aiScore || 0)) / 100,
      0,
    ),
    urgentLeads: urgent.length,
    overdueTasks,
    todayVisits,
    staleLeads: stale.length,
    healthScore,
    priorities: priorities.slice(0, 4),
    priorityLeads,
    topManager,
  };
}
