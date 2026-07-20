/**
 * Launch funnel helpers — stage metrics and conversion math for Analytics.
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
  conversionFromPrev: number | null;
  conversionFromTop: number | null;
}

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

function roleFromStageKey(key: string | null | undefined): StageRole {
  return stageRoleOf({ id: key ?? undefined });
}

/** Max funnel depth a lead reached (from current stage key / paid flags). */
export function launchDepthReached(lead: LeadLite): number {
  const role = roleFromStageKey(lead.stageKey);
  if (role === "graduate") return STAGE_ROLE_ORDER.graduate;
  if (role === "student") return STAGE_ROLE_ORDER.student;
  if (lead.paid || lead.paidAt) {
    return Math.max(STAGE_ROLE_ORDER.paid, STAGE_ROLE_ORDER[role] || 0);
  }
  if ((lead.depositAmount ?? 0) > 0) {
    return Math.max(STAGE_ROLE_ORDER.deposit, STAGE_ROLE_ORDER[role] || 0);
  }
  return STAGE_ROLE_ORDER[role] || 0;
}

export function buildLaunchFunnel(leads: LeadLite[]): LaunchStageRow[] {
  const top = leads.length;
  let prev = top;
  return LAUNCH_FUNNEL_STEPS.map((step, idx) => {
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
  /** @deprecated use botActivated */
  whatsapp: number;
  /** @deprecated */
  interest: number;
}

export function buildLaunchKpis(leads: LeadLite[]): LaunchKpis {
  const rows = buildLaunchFunnel(leads);
  const byRole = Object.fromEntries(rows.map((r) => [r.role, r.leads])) as Record<StageRole, number>;
  return {
    leads: byRole.new ?? leads.length,
    botActivated: byRole.bot_activated ?? 0,
    joinedGroup: byRole.joined_group ?? 0,
    confirmed: byRole.confirmed ?? 0,
    attended: byRole.attended ?? 0,
    deposits: byRole.deposit ?? 0,
    depositRevenue: leads.reduce((s, l) => s + Number(l.depositAmount ?? 0), 0),
    calls: byRole.call_scheduled ?? 0,
    paid: byRole.paid ?? 0,
    revenue: leads.filter((l) => l.paid || l.paidAt).reduce((s, l) => s + Number(l.amount ?? 0), 0),
    students: byRole.student ?? 0,
    graduates: byRole.graduate ?? 0,
    hot: leads.filter((l) => l.temperature === "hot").length,
    whatsapp: byRole.bot_activated ?? 0,
    interest: byRole.call_scheduled ?? 0,
  };
}
