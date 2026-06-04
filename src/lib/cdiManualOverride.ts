/**
 * Ручной факт в cabinet_daily_insights: NULL = «брать из CRM»,
 * число (включая 0) = явная корректировка только для этой даты и кабинета.
 */
export function isManualOverrideActive(
  manual: number | string | null | undefined,
): boolean {
  return manual !== null && manual !== undefined && !Number.isNaN(Number(manual));
}

export function resolveCdiMetric(
  manual: number | string | null | undefined,
  crm: number,
): number {
  if (isManualOverrideActive(manual)) {
    return Math.max(0, Number(manual) || 0);
  }
  return Math.max(0, Number(crm) || 0);
}

/** Значение для сохранения из UI: пусто / «сброс» → NULL (авто из CRM). */
export function manualValueForSave(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return Math.max(0, n);
}
