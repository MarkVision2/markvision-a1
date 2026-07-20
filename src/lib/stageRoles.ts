/**
 * Semantic stage roles for CRM pipelines.
 * Dialogs and automations should use stage_role, not hardcoded keys.
 */

export type StageRole =
  | "new"
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
  | "graduate"
  | "rejected"
  /** @deprecated launch v1 */
  | "whatsapp"
  /** @deprecated launch v1 */
  | "warming"
  /** @deprecated launch v1 — бронь уже = интерес */
  | "interest"
  | "other";

export type LeadTemperature = "hot" | "warm" | "cold";

export type WebinarStatus = "attended" | "late" | "no_show";

/** Automation events accepted by crm-stage-update edge function. */
export type CrmAutomationEvent =
  | "bot_activated"
  | "whatsapp_messaged" // alias → bot_activated
  | "joined_group"
  | "warming_started" // alias → joined_group
  | "attendance_confirmed"
  | "webinar_attended"
  | "webinar_late"
  | "webinar_no_show"
  | "call_scheduled"
  | "call_completed"
  | "offer_sent"
  | "deposit_received"
  | "payment_received"
  | "student_created"
  | "graduated"
  | "rejected"
  /** @deprecated */
  | "interest_detected";

export const AUTOMATION_EVENT_TO_ROLE: Record<CrmAutomationEvent, StageRole> = {
  bot_activated: "bot_activated",
  whatsapp_messaged: "bot_activated",
  joined_group: "joined_group",
  warming_started: "joined_group",
  attendance_confirmed: "confirmed",
  webinar_attended: "attended",
  webinar_late: "attended",
  webinar_no_show: "rejected",
  interest_detected: "call_scheduled",
  call_scheduled: "call_scheduled",
  call_completed: "call_done",
  offer_sent: "offer",
  deposit_received: "deposit",
  payment_received: "paid",
  student_created: "student",
  graduated: "graduate",
  rejected: "rejected",
};

/** Forward-only order for launch funnel (higher = further in funnel). */
export const STAGE_ROLE_ORDER: Record<StageRole, number> = {
  new: 1,
  bot_activated: 2,
  whatsapp: 2, // legacy alias
  joined_group: 3,
  warming: 3, // legacy
  confirmed: 4,
  attended: 5,
  deposit: 6,
  interest: 7, // legacy → treat near call
  call_scheduled: 7,
  call_done: 8,
  offer: 9,
  paid: 10,
  student: 11,
  graduate: 12,
  rejected: 99,
  other: 0,
};

export function stageRoleOf(stage: { stageRole?: StageRole | null; id?: string } | null | undefined): StageRole {
  if (stage?.stageRole) {
    // normalize legacy roles
    if (stage.stageRole === "whatsapp") return "bot_activated";
    if (stage.stageRole === "warming") return "joined_group";
    if (stage.stageRole === "interest") return "call_scheduled";
    return stage.stageRole;
  }
  const key = (stage?.id ?? "").toLowerCase();
  if (key === "new") return "new";
  if (key === "bot_activated" || key === "whatsapp" || key === "no_answer") return "bot_activated";
  if (key === "joined_group" || key === "warming") return "joined_group";
  if (key === "confirmed") return "confirmed";
  if (key === "visit" || key === "attended") return "attended";
  if (key === "deposit") return "deposit";
  if (key === "interest" || key === "in_progress" || key === "scheduled") return "call_scheduled";
  if (key === "call_done") return "call_done";
  if (key === "invoice" || key === "offer") return "offer";
  if (key === "paid") return "paid";
  if (key === "student") return "student";
  if (key === "graduate") return "graduate";
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
  const fromN = stageRoleOf({ stageRole: from });
  const toN = stageRoleOf({ stageRole: to });
  if (fromN === toN) return false;
  if (toN === "rejected") return true;
  if (fromN === "rejected" || fromN === "graduate") return false;
  if (fromN === "paid" && toN !== "student" && toN !== "graduate") return false;
  if (fromN === "student" && toN !== "graduate") return false;
  return STAGE_ROLE_ORDER[toN] >= STAGE_ROLE_ORDER[fromN];
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
