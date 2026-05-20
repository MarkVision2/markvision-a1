export interface QualityFunnelLeadLike {
  stageId?: string | null;
  stageKey?: string | null;
  stageTitle?: string | null;
  stageIsDiagnostic?: boolean | null;
  isDiagnostic?: boolean | null;
  paid?: boolean | null;
  paidAt?: string | null;
  amount?: number | null;
}

export interface QualityFunnelTotals {
  totalLeads: number;
  scheduled: number;
  paid: number;
  pctScheduled: number;
  pctPaid: number;
  pctPaidOfAll: number;
}

const DIAGNOSTIC_STAGE_KEYS = new Set([
  "scheduled",
  "visit",
  "invoice",
  "diagnosed",
  "diagnostic",
  "diagnostics",
  "completed",
  "paid",
]);

const PAID_STAGE_KEYS = new Set(["paid", "completed", "purchase", "sold"]);

function normalizedStageToken(lead: QualityFunnelLeadLike) {
  return `${lead.stageKey ?? ""} ${lead.stageId ?? ""} ${lead.stageTitle ?? ""}`.trim().toLowerCase();
}

export function isLeadDiagnostic(lead: QualityFunnelLeadLike) {
  if (lead.stageIsDiagnostic || lead.isDiagnostic || isLeadPaid(lead)) return true;
  const key = (lead.stageKey ?? lead.stageId ?? "").toLowerCase();
  if (DIAGNOSTIC_STAGE_KEYS.has(key)) return true;
  const token = normalizedStageToken(lead);
  return /диагност|визит|запис|сч[её]т|invoice|visit|scheduled|diagnos/.test(token);
}

export function isLeadPaid(lead: QualityFunnelLeadLike) {
  if (lead.paid || lead.paidAt) return true;
  const key = (lead.stageKey ?? lead.stageId ?? "").toLowerCase();
  if (PAID_STAGE_KEYS.has(key)) return true;
  const token = normalizedStageToken(lead);
  return /опла|paid|purchase|продаж|sold/.test(token);
}

export function calculateQualityFunnel(leads: readonly QualityFunnelLeadLike[]): QualityFunnelTotals {
  const totalLeads = leads.length;
  const scheduled = leads.filter(isLeadDiagnostic).length;
  const paid = leads.filter(isLeadPaid).length;
  const pctScheduled = totalLeads > 0 ? Math.round((scheduled / totalLeads) * 100) : 0;
  const pctPaid = scheduled > 0 ? Math.round((paid / scheduled) * 100) : 0;
  const pctPaidOfAll = totalLeads > 0 ? Math.round((paid / totalLeads) * 100) : 0;

  return { totalLeads, scheduled, paid, pctScheduled, pctPaid, pctPaidOfAll };
}
