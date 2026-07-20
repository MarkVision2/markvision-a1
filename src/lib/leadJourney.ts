/**
 * Путь лида по Launch Funnel — чеклист + прогресс %.
 * Считается из текущего этапа / флагов (без отдельной таблицы).
 */
import { STAGE_ROLE_ORDER, stageRoleOf, type StageRole } from "@/lib/stageRoles";
import type { Lead, UtmTags } from "@/types/crm";

export type JourneyStepKey =
  | "registered"
  | "bot_activated"
  | "joined_group"
  | "confirmed"
  | "attended"
  | "deposit"
  | "call_scheduled"
  | "call_done"
  | "offer"
  | "paid"
  | "student"
  | "graduate";

export interface JourneyStepDef {
  key: JourneyStepKey;
  label: string;
  /** Min stage_role order that marks step done */
  minOrder: number;
}

/** Основной путь до покупки/обучения (без Отказ). */
export const JOURNEY_STEPS: JourneyStepDef[] = [
  { key: "registered", label: "Оставил заявку", minOrder: STAGE_ROLE_ORDER.new },
  { key: "bot_activated", label: "Получил сообщение бота", minOrder: STAGE_ROLE_ORDER.bot_activated },
  { key: "joined_group", label: "Вступил в группу", minOrder: STAGE_ROLE_ORDER.joined_group },
  { key: "confirmed", label: "Подтвердил участие", minOrder: STAGE_ROLE_ORDER.confirmed },
  { key: "attended", label: "Посетил вебинар", minOrder: STAGE_ROLE_ORDER.attended },
  { key: "deposit", label: "Бронь 10 000 ₸", minOrder: STAGE_ROLE_ORDER.deposit },
  { key: "call_scheduled", label: "Созвон назначен", minOrder: STAGE_ROLE_ORDER.call_scheduled },
  { key: "call_done", label: "Созвон проведён", minOrder: STAGE_ROLE_ORDER.call_done },
  { key: "offer", label: "Счёт / договор отправлен", minOrder: STAGE_ROLE_ORDER.offer },
  { key: "paid", label: "Полная оплата", minOrder: STAGE_ROLE_ORDER.paid },
  { key: "student", label: "Студент", minOrder: STAGE_ROLE_ORDER.student },
  { key: "graduate", label: "Выпускник", minOrder: STAGE_ROLE_ORDER.graduate },
];

export interface JourneyStepState extends JourneyStepDef {
  done: boolean;
}

export interface LeadJourney {
  depth: number;
  progressPct: number;
  doneCount: number;
  total: number;
  steps: JourneyStepState[];
  droppedAt: JourneyStepKey | null;
  isRejected: boolean;
}

function depthOfLead(lead: Pick<Lead, "stageId" | "paid" | "paidAt" | "depositAmount" | "webinarStatus"> & {
  stageRole?: StageRole | null;
}): number {
  const role = stageRoleOf({ stageRole: lead.stageRole, id: lead.stageId });
  if (role === "rejected") {
    // depth before reject unknown from stage alone — use flags
    let d = STAGE_ROLE_ORDER.new;
    if (lead.webinarStatus === "attended" || lead.webinarStatus === "late") {
      d = Math.max(d, STAGE_ROLE_ORDER.attended);
    }
    if ((lead.depositAmount ?? 0) > 0) d = Math.max(d, STAGE_ROLE_ORDER.deposit);
    if (lead.paid || lead.paidAt) d = Math.max(d, STAGE_ROLE_ORDER.paid);
    return d;
  }
  let d = STAGE_ROLE_ORDER[role] || 0;
  if ((lead.depositAmount ?? 0) > 0) d = Math.max(d, STAGE_ROLE_ORDER.deposit);
  if (lead.paid || lead.paidAt) d = Math.max(d, STAGE_ROLE_ORDER.paid);
  if (lead.webinarStatus === "attended" || lead.webinarStatus === "late") {
    d = Math.max(d, STAGE_ROLE_ORDER.attended);
  }
  return d;
}

export function buildLeadJourney(
  lead: Pick<Lead, "stageId" | "paid" | "paidAt" | "depositAmount" | "webinarStatus"> & {
    stageRole?: StageRole | null;
  },
): LeadJourney {
  const role = stageRoleOf({ stageRole: lead.stageRole, id: lead.stageId });
  const isRejected = role === "rejected";
  const depth = depthOfLead(lead);
  const steps = JOURNEY_STEPS.map((s) => ({
    ...s,
    done: depth >= s.minOrder,
  }));
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const progressPct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const droppedAt = isRejected
    ? (steps.find((s) => !s.done)?.key ?? null)
    : null;
  return { depth, progressPct, doneCount, total, steps, droppedAt, isRejected };
}

export function formatLeadRegDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function utmCampaignLine(utm?: UtmTags | null): string | null {
  if (!utm) return null;
  return utm.campaign || utm.content || utm.source || null;
}

/** Ссылка вебинара с уникальным lead id (для трекинга посещения). */
export function webinarLeadUrl(baseUrl: string, leadId: string): string {
  try {
    const u = new URL(baseUrl);
    u.searchParams.set("lead", leadId);
    return u.toString();
  } catch {
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${sep}lead=${encodeURIComponent(leadId)}`;
  }
}
