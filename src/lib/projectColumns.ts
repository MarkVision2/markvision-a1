/** Columns readable by authenticated (intake_token is revoked at DB level). */
export const PROJECTS_LIST_COLUMNS =
  "id, name, domain, initials, is_primary, created_by, created_at, updated_at" as const;
