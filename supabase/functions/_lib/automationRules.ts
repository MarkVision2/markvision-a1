/** Чистые правила CRM-автоматизаций. Держим отдельно, чтобы покрыть тестами. */

export type ReplyState = {
  last_inbound_at?: string | null;
  last_outbound_at?: string | null;
};

/**
 * «Мы написали последними и ответа нет» — условие дожимов 2ч и 24ч.
 *
 * Раньше это выражалось PostgREST-фильтром `last_inbound_at.lt.last_outbound_at`,
 * но PostgREST сравнивает колонку только со ЗНАЧЕНИЕМ: строка 'last_outbound_at'
 * уходила в Postgres как литерал timestamptz, запрос падал с 400, ошибка не
 * читалась — и дожимы не срабатывали ни разу. Сравнение колонок делаем здесь.
 */
export function awaitingReply(lead: ReplyState): boolean {
  if (!lead.last_outbound_at) return false;
  if (!lead.last_inbound_at) return true;
  return new Date(lead.last_inbound_at).getTime() < new Date(lead.last_outbound_at).getTime();
}

export type StageMapRow = {
  capi_event: string | null;
  is_paid: boolean | null;
  project_id: string | null;
};

/**
 * Выбор правила stage → CAPI: проектная строка приоритетнее глобальной
 * (project_id IS NULL). Тот же порядок, что и в useCapiStageMap на фронте.
 */
export function pickStageMapRow(
  rows: StageMapRow[],
  projectId: string | null,
): StageMapRow | null {
  if (!rows.length) return null;
  const scoped = projectId ? rows.find((r) => r.project_id === projectId) : undefined;
  return scoped ?? rows.find((r) => r.project_id === null) ?? null;
}
