/**
 * Launch funnel helpers — stage metrics and conversion math for Analytics.
 */
import type { LeadLite } from "@/hooks/useLeadsLite";
import {
  STAGE_ROLE_ORDER,
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
  { role: "whatsapp", label: "WhatsApp" },
  { role: "warming", label: "Прогрев" },
  { role: "confirmed", label: "Подтвердил" },
  { role: "attended", label: "На вебинаре" },
  { role: "interest", label: "Интерес" },
  { role: "call_scheduled", label: "Созвон" },
  { role: "call_done", label: "Созвон проведён" },
  { role: "offer", label: "КП" },
  { role: "deposit", label: "Бронь" },
  { role: "paid", label: "Оплата" },
  { role: "student", label: "Студент" },
];

function roleFromStageKey(key: string | null | undefined): StageRole {
  const k = (key ?? "").toLowerCase();
  if (k === "new") return "new";
  if (k === "whatsapp" || k === "no_answer") return "whatsapp";
  if (k === "warming") return "warming";
  if (k === "confirmed") return "confirmed";
  if (k === "visit" || k === "attended") return "attended";
  if (k === "interest" || k === "in_progress") return "interest";
  if (k === "scheduled") return "call_scheduled";
  if (k === "call_done") return "call_done";
  if (k === "invoice" || k === "offer") return "offer";
  if (k === "deposit") return "deposit";
  if (k === "paid") return "paid";
  if (k === "student") return "student";
  if (k === "rejected") return "rejected";
  return "other";
}

/** Max funnel depth a lead reached (from current stage key / paid flags). */
export function launchDepthReached(lead: LeadLite): number {
  const role = roleFromStageKey(lead.stageKey);
  if (role === "student") return STAGE_ROLE_ORDER.student;
  if (lead.paid || lead.paidAt) {
    return Math.max(STAGE_ROLE_ORDER.paid, STAGE_ROLE_ORDER[role] || 0);
  }
  if ((lead.depositAmount ?? 0) > 0) {
    return Math.max(STAGE_ROLE_ORDER.deposit, STAGE_ROLE_ORDER[role] || 0);
  }
  return STAGE_ROLE_ORDER[role] || 0;
}

export function buildLaunchFunnel(
  leads: LeadLite[],
): LaunchStageRow[] {
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
  whatsapp: number;
  confirmed: number;
  attended: number;
  interest: number;
  deposits: number;
  depositRevenue: number;
  paid: number;
  revenue: number;
  students: number;
  hot: number;
}

export function buildLaunchKpis(leads: LeadLite[]): LaunchKpis {
  const rows = buildLaunchFunnel(leads);
  const byRole = Object.fromEntries(rows.map((r) => [r.role, r.leads])) as Record<StageRole, number>;
  return {
    leads: byRole.new ?? leads.length,
    whatsapp: byRole.whatsapp ?? 0,
    confirmed: byRole.confirmed ?? 0,
    attended: byRole.attended ?? 0,
    interest: byRole.interest ?? 0,
    deposits: byRole.deposit ?? 0,
    depositRevenue: leads.reduce((s, l) => s + Number(l.depositAmount ?? 0), 0),
    paid: byRole.paid ?? 0,
    revenue: leads.filter((l) => l.paid || l.paidAt).reduce((s, l) => s + Number(l.amount ?? 0), 0),
    students: byRole.student ?? 0,
    hot: leads.filter((l) => l.temperature === "hot").length,
  };
}
