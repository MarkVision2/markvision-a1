/**
 * RBAC контура публикаций — чистый модуль (vitest: src/test/rbac.test.ts).
 *
 * Роль в проекте складывается из трёх источников (по убыванию приоритета):
 *   1. владелец проекта (projects.created_by) → owner;
 *   2. явная роль участника (project_members.role из набора ниже);
 *   3. глобальная роль команды (profiles.display_role / user_roles.role):
 *      admin | director → admin, manager → manager, marketer → content_manager, viewer → viewer.
 * Участник без явной и без глобальной роли — manager (так вели себя все участники до RBAC:
 * доступ был бинарным, и понижать их молча нельзя).
 *
 * Матрица: что может каждая роль в publish-accounts / публичном API.
 */

export type ProjectRole = "owner" | "admin" | "manager" | "content_manager" | "operator" | "viewer";

export const PROJECT_ROLES: ProjectRole[] = ["owner", "admin", "manager", "content_manager", "operator", "viewer"];

/** Роли, которые можно назначить участнику явно (owner — только владелец проекта). */
export const ASSIGNABLE_ROLES: ProjectRole[] = ["admin", "manager", "content_manager", "operator", "viewer"];

export const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  content_manager: "Контент-менеджер",
  operator: "Оператор",
  viewer: "Наблюдатель",
};

export function isProjectRole(v: unknown): v is ProjectRole {
  return typeof v === "string" && (PROJECT_ROLES as string[]).includes(v);
}

export interface RoleSources {
  isOwner: boolean;
  /** Глобальная роль команды: admin | director | manager | marketer | viewer | null. */
  globalRole: string | null;
  /** project_members.role: новая роль, legacy "member"/"owner" или null (не участник). */
  memberRole: string | null;
  /** Есть ли строка участия вообще (или доступ через глобального admin). */
  isMember: boolean;
}

export function globalToProjectRole(globalRole: string | null | undefined): ProjectRole | null {
  switch (globalRole) {
    case "admin":
    case "director":
      return "admin";
    case "manager":
      return "manager";
    case "marketer":
      return "content_manager";
    case "viewer":
      return "viewer";
    default:
      return null;
  }
}

/** Роль пользователя в проекте или null — нет доступа. */
export function resolveProjectRole(src: RoleSources): ProjectRole | null {
  if (src.isOwner) return "owner";
  if (src.memberRole === "owner") return "owner";
  if (isProjectRole(src.memberRole) && src.memberRole !== "owner") return src.memberRole;
  const fromGlobal = globalToProjectRole(src.globalRole);
  if (fromGlobal === "admin") return "admin"; // глобальный admin видит все проекты
  if (!src.isMember) return null;
  return fromGlobal ?? "manager";
}

/* ─────────────────────────── матрица действий ─────────────────────────── */

export type PermissionLevel = "read" | "operate" | "publish" | "manage" | "admin";

/** Минимальный уровень для роли: viewer < operator < content_manager < manager < admin < owner. */
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, operator: 1, content_manager: 2, manager: 3, admin: 4, owner: 5 };
const LEVEL_RANK: Record<PermissionLevel, number> = { read: 0, operate: 1, publish: 2, manage: 3, admin: 4 };

export function roleAllows(role: ProjectRole, level: PermissionLevel): boolean {
  return ROLE_RANK[role] >= LEVEL_RANK[level];
}

/** Уровень доступа для действий publish-accounts. Неизвестное действие — manage (безопаснее). */
export const ACTION_LEVELS: Record<string, PermissionLevel> = {
  // чтение
  list: "read", group_list: "read", persona_list: "read", settings_get: "read", jobs_list: "read", job_get: "read",
  metrics: "read", notifications_list: "read", campaign_list: "read", campaign_get: "read",
  webhook_list: "read", webhook_deliveries: "read", api_key_list: "read", member_list: "read",
  routine_list: "read", tasks_list: "read", calendar: "read",
  // облачные телефоны в карточке аккаунта: смотреть можно с правом чтения
  phones: "read", warmup_status: "read", accounts_free: "read",
  // оператор: разбор ошибок, проверка здоровья, уведомления
  notification_read: "operate", job_retry: "operate", job_cancel: "operate", health_check: "operate",
  // контент и расписание
  publish_video: "publish", campaign_upsert: "publish", campaign_items_add: "publish", campaign_items_remove: "publish",
  campaign_status: "publish", campaign_plan_now: "publish",
  // управление аккаунтами, группами, настройками, подключениями, ключами, вебхуками, рутинами
  available: "manage", connect: "manage", connect_threads: "manage", disconnect: "manage", update: "manage",
  accounts_bulk_update: "manage",
  group_upsert: "manage", group_delete: "manage", persona_upsert: "manage", persona_delete: "manage",
  settings_upsert: "manage", api_key_create: "manage", api_key_revoke: "manage",
  // ссылки-приглашения — тот же уровень, что и подключение руками
  connect_link_list: "manage", connect_link_create: "manage", connect_link_revoke: "manage", connect_link_delete: "manage",
  webhook_upsert: "manage", webhook_delete: "manage", routine_upsert: "manage", routine_delete: "manage", routine_assign: "manage",
  // привязка телефона, питание и запуск прогрева — уровень управления аккаунтами
  attach: "manage", detach: "manage", power: "manage", warmup: "manage",
  // роли участников — только администратор и владелец
  member_role_set: "admin",
};

export function levelForAction(action: string): PermissionLevel {
  return ACTION_LEVELS[action] ?? "manage";
}

export function canDo(role: ProjectRole | null, action: string): boolean {
  if (!role) return false;
  return roleAllows(role, levelForAction(action));
}
