import type { ModuleKey } from "@/hooks/useTeamStore";

/**
 * Единый источник правды: какому модулю прав доступа принадлежит роут.
 * `null` (роут не в карте) = утилитарный/проектный путь, гейтингу не подлежит.
 * Меню фильтрует сам себя (useMyAccess), а это — защита прямых переходов по URL.
 */

const EXACT: Partial<Record<string, ModuleKey>> = {
  "/": "factory",
  "/dashboard": "dashboard",
  "/metrics": "metrics",
  "/ads": "ads",
  "/crm": "crm",
  "/calls": "crm",
  "/sales-ai": "crm",
  "/ai-agents": "crm",
  "/broadcasts": "crm",
  "/analytics": "analytics",
  "/marketing/content-center": "factory",
  "/marketing/content-plan": "factory",
  "/finance": "finance",
  "/reports": "reports",
  "/settings": "settings",
};

/** Префиксы для вложенных путей. Длинные — раньше коротких. */
const PREFIX: [string, ModuleKey][] = [
  ["/marketing/content-plan/", "factory"],
  ["/marketing/content-center/", "factory"],
  ["/analytics/", "analytics"],
  ["/broadcasts/", "crm"],
  ["/settings/", "settings"],
  ["/create/", "factory"],
];

/** Модуль, к которому относится путь. `null` — без ограничений. */
export function moduleForPath(pathname: string): ModuleKey | null {
  const exact = EXACT[pathname];
  if (exact) return exact;
  for (const [prefix, mod] of PREFIX) {
    if (pathname.startsWith(prefix)) return mod;
  }
  return null;
}

/** Порядок «посадочной» страницы для участника с ограниченным набором модулей. */
const LANDING_ORDER: { module: ModuleKey; url: string }[] = [
  { module: "dashboard", url: "/dashboard" },
  { module: "crm", url: "/crm" },
  { module: "factory", url: "/" },
  { module: "ads", url: "/ads" },
  { module: "analytics", url: "/analytics" },
  { module: "metrics", url: "/metrics" },
  { module: "finance", url: "/finance" },
  { module: "reports", url: "/reports" },
  { module: "settings", url: "/settings" },
];

/**
 * Первый доступный участнику роут (для редиректа с закрытого раздела).
 * `null`, если ни один модуль недоступен.
 */
export function firstAllowedRoute(has: (m: ModuleKey) => boolean): string | null {
  for (const { module, url } of LANDING_ORDER) {
    if (has(module)) return url;
  }
  return null;
}
