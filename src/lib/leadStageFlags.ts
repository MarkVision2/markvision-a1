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
  diagnosticAmount?: number | null;
}

const PAID_STAGE_KEYS = new Set([
  "paid", "completed", "done", "success", "won",
  "оплачено", "оплата", "продажа", "оплачен",
]);

// Стадии диагностики: все, что в БД помечены is_diagnostic=true в pipeline_stages.
// Включаем "scheduled" (запись на диагностику — момент, когда триггер CDI +1),
// "invoice" (счёт перед оплатой) и собственно "visit". Без "scheduled" orphan-лид,
// у которого нет cabinet_id, не считался как диагностика и фронт показывал на 1
// меньше, чем реально было в CRM.
const VISIT_STAGE_KEYS = new Set([
  "scheduled", "scheduled_diag", "записан", "запись",
  "invoice", "счёт", "счет",
  "visit", "diagnosed", "diagnostic",
  "арегистрация", "визит", "диагностика",
]);

export function isLeadPaid(l: LeadFlagsInput): boolean {
  if (l.paid === true) return true;
  if (l.paidAt) return true;
  const k = (l.stageKey ?? "").toLowerCase().trim();
  return PAID_STAGE_KEYS.has(k);
}

export function isLeadVisit(l: LeadFlagsInput): boolean {
  if (isLeadPaid(l)) return true;
  // diagnostic_amount > 0 — однозначный признак, что лид прошёл диагностику
  // (триггер БД устанавливает поле при переводе в is_diagnostic стадию).
  if ((l.diagnosticAmount ?? 0) > 0) return true;
  const k = (l.stageKey ?? "").toLowerCase().trim();
  return VISIT_STAGE_KEYS.has(k);
}

/**
 * Диагностика для отчётов / «Таблица показателей»: оплаченная продажа
 * не считается визитом. Раньше isLeadVisit включал paid → завышало диагностики
 * в начале месяца (например 4 оплаты = «4 диагностики» при факте 0 визитов).
 */
export function isLeadDiagnosticEvent(l: LeadFlagsInput): boolean {
  if ((l.diagnosticAmount ?? 0) > 0) return true;
  if (isLeadPaid(l)) return false;
  const k = (l.stageKey ?? "").toLowerCase().trim();
  return VISIT_STAGE_KEYS.has(k);
}
