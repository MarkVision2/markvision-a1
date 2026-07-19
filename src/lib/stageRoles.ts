/**
 * Semantic stage roles for CRM pipelines.
 * Dialogs and automations should use stage_role, not hardcoded keys.
 */

export type StageRole =
  | "new"
  | "whatsapp"
  | "warming"
  | "confirmed"
  | "attended"
  | "interest"
  | "call_scheduled"
  | "call_done"
  | "offer"
  | "deposit"
  | "paid"
  | "student"
  | "rejected"
  | "other";

export type LeadTemperature = "hot" | "warm" | "cold";

export type WebinarStatus = "attended" | "late" | "no_show";

/** Automation events accepted by crm-stage-update edge function. */
export type CrmAutomationEvent =
  | "whatsapp_messaged"
  | "warming_started"
  | "attendance_confirmed"
  | "webinar_attended"
  | "webinar_late"
  | "webinar_no_show"
  | "interest_detected"
  | "call_scheduled"
  | "call_completed"
  | "offer_sent"
  | "deposit_received"
  | "payment_received"
  | "student_created"
  | "rejected";

export const AUTOMATION_EVENT_TO_ROLE: Record<CrmAutomationEvent, StageRole> = {
  whatsapp_messaged: "whatsapp",
  warming_started: "warming",
  attendance_confirmed: "confirmed",
  webinar_attended: "attended",
  webinar_late: "attended",
  webinar_no_show: "rejected",
  interest_detected: "interest",
  call_scheduled: "call_scheduled",
  call_completed: "call_done",
  offer_sent: "offer",
  deposit_received: "deposit",
  payment_received: "paid",
  student_created: "student",
  rejected: "rejected",
};

/** Forward-only order for launch funnel (higher = further in funnel). */
export const STAGE_ROLE_ORDER: Record<StageRole, number> = {
  new: 1,
  whatsapp: 2,
  warming: 3,
  confirmed: 4,
  attended: 5,
  interest: 6,
  call_scheduled: 7,
  call_done: 8,
  offer: 9,
  deposit: 10,
  paid: 11,
  student: 12,
  rejected: 99,
  other: 0,
};

export function stageRoleOf(stage: { stageRole?: StageRole | null; id?: string } | null | undefined): StageRole {
  if (stage?.stageRole) return stage.stageRole;
  // Fallback for clinic pipelines that still rely on keys as LeadStage.id
  const key = (stage?.id ?? "").toLowerCase();
  if (key === "new") return "new";
  if (key === "no_answer" || key === "whatsapp") return "whatsapp";
  if (key === "warming") return "warming";
  if (key === "confirmed") return "confirmed";
  if (key === "visit" || key === "attended") return "attended";
  if (key === "interest" || key === "in_progress") return "interest";
  if (key === "scheduled") return "call_scheduled";
  if (key === "call_done") return "call_done";
  if (key === "invoice" || key === "offer") return "offer";
  if (key === "deposit") return "deposit";
  if (key === "paid") return "paid";
  if (key === "student") return "student";
  if (key === "rejected") return "rejected";
  return "other";
}

export function requiresPaymentDialog(role: StageRole): boolean {
  return role === "paid";
}

export function requiresRejectDialog(role: StageRole): boolean {
  return role === "rejected";
}

/** Clinic-only: diagnostic amount when moving to scheduled + is_diagnostic. */
export function requiresDiagnosticDialog(
  role: StageRole,
  opts?: { isDiagnostic?: boolean; templateKey?: string | null },
): boolean {
  if (opts?.templateKey === "launch") return false;
  return role === "call_scheduled" && opts?.isDiagnostic === true;
}

export function canAutoAdvance(from: StageRole, to: StageRole): boolean {
  if (from === to) return false;
  if (to === "rejected") return true;
  if (from === "rejected" || from === "paid" || from === "student") return false;
  return STAGE_ROLE_ORDER[to] >= STAGE_ROLE_ORDER[from];
}

export const TEMPERATURE_LABEL: Record<LeadTemperature, string> = {
  hot: "Горячий",
  warm: "Тёплый",
  cold: "Холодный",
};

export const WEBINAR_STATUS_LABEL: Record<WebinarStatus, string> = {
  attended: "Пришёл",
  late: "Опоздал",
  no_show: "Не пришёл",
};
