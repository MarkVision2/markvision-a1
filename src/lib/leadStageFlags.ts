// Единые правила определения, что лид считается оплаченным/визитом.
// Раньше всюду было захардкожено `stageKey === "paid"` — это ломалось,
// если в проекте у стадии другой ключ (например "completed", "оплачено",
// "успех"). Теперь смотрим сначала на явные булевы `paid` / `paid_at`
// (выставляет CRM при переводе в терминальную оплаченную стадию),
// а stageKey используем как fallback.

export interface LeadFlagsInput {
  paid?: boolean | null;
  paidAt?: string | null;
  stageKey?: string | null;
  amount?: number | null;
}

const PAID_STAGE_KEYS = new Set(["paid", "completed", "done", "success", "won", "оплачено", "оплата", "продажа"]);
const VISIT_STAGE_KEYS = new Set(["visit", "diagnosed", "diagnostic", "арегистрация", "визит", "диагностика"]);

export function isLeadPaid(l: LeadFlagsInput): boolean {
  if (l.paid === true) return true;
  if (l.paidAt) return true;
  const k = (l.stageKey ?? "").toLowerCase().trim();
  return PAID_STAGE_KEYS.has(k);
}

export function isLeadVisit(l: LeadFlagsInput): boolean {
  if (isLeadPaid(l)) return true;
  const k = (l.stageKey ?? "").toLowerCase().trim();
  return VISIT_STAGE_KEYS.has(k);
}
