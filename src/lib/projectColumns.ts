/** Базовые колонки projects — всегда есть в БД. */
export const PROJECTS_BASE_COLUMNS =
  "id, name, domain, initials, is_primary, created_by, created_at, updated_at" as const;

/** Опциональная колонка (миграция 20260609190000). Без неё список проектов не должен ломаться. */
export const PROJECTS_CREATIVE_USERNAME_COLUMN = "creative_username" as const;

export const PROJECTS_LIST_COLUMNS =
  `${PROJECTS_BASE_COLUMNS}, ${PROJECTS_CREATIVE_USERNAME_COLUMN}` as const;

/** PostgREST: колонка ещё не применена в Supabase. */
export function isMissingCreativeUsernameColumn(message: string): boolean {
  return /creative_username/i.test(message) && /(does not exist|Could not find)/i.test(message);
}
