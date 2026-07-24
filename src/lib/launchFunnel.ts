/**
 * Launch funnel helpers — stage metrics and conversion math for CRM / Analytics.
 *
 * Hero funnel (7 steps) matches the product path managers care about.
 * Full 12-step list stays for the extended view.
 */
import type { LeadLite } from "@/hooks/useLeadsLite";
import {
  STAGE_ROLE_ORDER,
  stageRoleOf,
  type StageRole,
} from "@/lib/stageRoles";

export interface LaunchStageRow {
  role: StageRole;
  label: string;
  leads: number;
  /** % from previous step (null on first step) */
  conversionFromPrev: number | null;
  /** % from top of funnel (лиды) */
  conversionFromTop: number | null;
}

/** Full launch pipeline (kanban / extended analytics). */
export const LAUNCH_FUNNEL_STEPS: { role: StageRole; label: string }[] = [
  { role: "new", label: "Новый лид" },
  { role: "bot_activated", label: "Бот активирован" },
  { role: "joined_group", label: "В группе" },
  { role: "confirmed", label: "Подтвердил" },
  { role: "attended", label: "На вебинаре" },
  { role: "deposit", label: "Бронь" },
  { role: "call_scheduled", label: "Созвон" },
  { role: "call_done", label: "Созвон ✓" },
  { role: "offer", label: "Счёт / договор" },
  { role: "paid", label: "Оплата" },
  { role: "student", label: "Студент" },
  { role: "graduate", label: "Выпускник" },
];

/**
 * Core conversion funnel shown in CRM — exactly the path the team tracks.
 * Cumulative depth: a lead who paid also counts on every earlier step.
 */
export const LAUNCH_CONVERSION_STEPS: { role: StageRole; label: string; hint: string }[] = [
  { role: "new", label: "Лид", hint: "заявка в CRM" },
  { role: "bot_activated", label: "Активировал бота", hint: "старт / доставка бота" },
  { role: "joined_group", label: "Вступил в группу", hint: "группа / прогрев" },
  { role: "confirmed", label: "Подтвердил участие", hint: "сказал «буду»" },
  { role: "attended", label: "Посетил вебинар", hint: "был на эфире" },
  { role: "deposit", label: "Внёс предоплату", hint: "бронь / депозит" },
  { role: "paid", label: "Оплатил курс", hint: "полная оплата" },
];

type DepthLead = Pick<
  LeadLite,
  "stageKey" | "stageRole" | "paid" | "paidAt" | "depositAmount" | "webinarStatus"
>;

function roleFromLead(lead: DepthLead): StageRole {
  return stageRoleOf({
    stageRole: (lead.stageRole as StageRole | null | undefined) ?? undefined,
    id: lead.stageKey ?? undefined,
  });
}

/**
 * Max funnel depth a lead reached.
 * Prefers stage_role, then stage key, then flags (webinar / deposit / paid)
 * so a lead with webinar_status=attended still on «confirmed» counts as attended.
 */
export function launchDepthReached(lead: DepthLead): number {
  const role = roleFromLead(lead);
  if (role === "rejected") {
    let d = STAGE_ROLE_ORDER.new;
    if (lead.webinarStatus === "attended" || lead.webinarStatus === "late") {
      d = Math.max(d, STAGE_ROLE_ORDER.attended);
    }
    if ((lead.depositAmount ?? 0) > 0) d = Math.max(d, STAGE_ROLE_ORDER.deposit);
    if (lead.paid || lead.paidAt) d = Math.max(d, STAGE_ROLE_ORDER.paid);
    return d;
  }

  let d = STAGE_ROLE_ORDER[role] || STAGE_ROLE_ORDER.new;
  if (lead.webinarStatus === "attended" || lead.webinarStatus === "late") {
    d = Math.max(d, STAGE_ROLE_ORDER.attended);
  }
  if ((lead.depositAmount ?? 0) > 0) {
    d = Math.max(d, STAGE_ROLE_ORDER.deposit);
  }
  if (lead.paid || lead.paidAt) {
    d = Math.max(d, STAGE_ROLE_ORDER.paid);
  }
  return d;
}

function buildRows(
  leads: DepthLead[],
  steps: { role: StageRole; label: string }[],
): LaunchStageRow[] {
  const top = leads.length;
  let prev = top;
  return steps.map((step, idx) => {
    const count = leads.filter((l) => launchDepthReached(l) >= STAGE_ROLE_ORDER[step.role]).length;
    const row: LaunchStageRow = {
      role: step.role,
      label: step.label,
      leads: count,
      conversionFromPrev: idx === 0 || prev === 0 ? null : (count / prev) * 100,
      conversionFromTop: top === 0 ? null : (count / top) * 100,
    };
    prev = count;
    return row;
  });
}

export function buildLaunchFunnel(leads: DepthLead[]): LaunchStageRow[] {
  return buildRows(leads, LAUNCH_FUNNEL_STEPS);
}

export function buildLaunchConversionFunnel(leads: DepthLead[]): LaunchStageRow[] {
  return buildRows(leads, LAUNCH_CONVERSION_STEPS);
}

export interface LaunchKpis {
  leads: number;
  botActivated: number;
  joinedGroup: number;
  confirmed: number;
  attended: number;
  deposits: number;
  depositRevenue: number;
  calls: number;
  paid: number;
  revenue: number;
  students: number;
  graduates: number;
  hot: number;
  /** Lead → paid end-to-end conversion % */
  e2eConversion: number | null;
  /** @deprecated use botActivated */
  whatsapp: number;
  /** @deprecated */
  interest: number;
}

export function buildLaunchKpis(leads: (DepthLead & Pick<LeadLite, "amount" | "temperature">)[]): LaunchKpis {
  const rows = buildLaunchFunnel(leads);
  const byRole = Object.fromEntries(rows.map((r) => [r.role, r.leads])) as Partial<Record<StageRole, number>>;
  const leadsN = byRole.new ?? leads.length;
  const paidN = byRole.paid ?? 0;
  return {
    leads: leadsN,
    botActivated: byRole.bot_activated ?? 0,
    joinedGroup: byRole.joined_group ?? 0,
    confirmed: byRole.confirmed ?? 0,
    attended: byRole.attended ?? 0,
    deposits: byRole.deposit ?? 0,
    depositRevenue: leads.reduce((s, l) => s + Number(l.depositAmount ?? 0), 0),
    calls: byRole.call_scheduled ?? 0,
    paid: paidN,
    revenue: leads.filter((l) => l.paid || l.paidAt).reduce((s, l) => s + Number(l.amount ?? 0), 0),
    students: byRole.student ?? 0,
    graduates: byRole.graduate ?? 0,
    hot: leads.filter((l) => l.temperature === "hot").length,
    e2eConversion: leadsN === 0 ? null : (paidN / leadsN) * 100,
    whatsapp: byRole.bot_activated ?? 0,
    interest: byRole.call_scheduled ?? 0,
  };
}
