import type { Page, Route } from "@playwright/test";

/**
 * Прогон внутренних страниц без реального Supabase.
 *
 * Сеть до *.supabase.co в CI и в контейнере закрыта, а рабочие учётные данные в
 * тесты класть нельзя. Поэтому подкладываем фиктивную сессию в localStorage и
 * отвечаем на запросы фикстурами: RequireAuth и RequireModule пропускают, и каждая
 * страница реально монтируется. Проверяем именно рендер — что раздел не падает и
 * не белеет, — а не бизнес-логику на живых данных.
 */

export const PROJECT_REF = "szfgdruhlebfvcmlvxdk";
const USER_ID = "00000000-0000-4000-8000-0000000000e2";
/** Совпадает с подстановкой :id в спеках — тогда страницы вида /:id/... находят проект. */
export const PROJECT_ID = "00000000-0000-4000-8000-0000000000f1";

/** Все модули из MODULES (src/hooks/useTeamStore.ts) — чтобы не упереться в RequireModule. */
const ALL_MODULES = [
  "dashboard", "ads", "factory", "content_center", "content_plan", "strategy",
  "crm", "sales_ai", "ai_agents", "broadcasts", "leadgen",
  "metrics", "analytics", "creative_funnel", "content_analytics",
  "finance", "reports", "settings",
];

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Подпись не проверяется на клиенте — supabase-js читает из токена только exp и sub. */
function fakeJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  return [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ sub: USER_ID, exp, aud: "authenticated", role: "authenticated", email: "e2e@markvision.app" }),
    "e2e-signature-not-verified-client-side",
  ].join(".");
}

const USER = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "e2e@markvision.app",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  phone: "",
  confirmed_at: "2026-01-01T00:00:00Z",
  last_sign_in_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { name: "E2E" },
  identities: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
};

function session() {
  return {
    access_token: fakeJwt(),
    refresh_token: "e2e-refresh",
    token_type: "bearer",
    expires_in: 86_400,
    expires_at: Math.floor(Date.now() / 1000) + 86_400,
    user: USER,
  };
}

/** Ответы REST по таблицам. Всё, чего здесь нет, отдаёт пустой список. */
function restFixture(table: string): unknown[] {
  switch (table) {
    case "user_roles":
      return [{ user_id: USER_ID, role: "admin" }];
    case "team_member_modules":
      return ALL_MODULES.map((module_key) => ({ user_id: USER_ID, module_key }));
    case "projects":
    case "projects_public":
      return [{
        id: PROJECT_ID,
        name: "E2E проект",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }];
    case "project_members":
      return [{ project_id: PROJECT_ID, user_id: USER_ID }];
    case "user_active_project":
      return [{ user_id: USER_ID, project_id: PROJECT_ID }];
    case "profiles":
      return [{ id: USER_ID, name: "E2E", email: "e2e@markvision.app" }];
    default:
      return [];
  }
}

async function handle(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", ...headers },
      body: JSON.stringify(body),
    });

  if (request.method() === "OPTIONS") {
    return route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      },
    });
  }

  if (path.startsWith("/auth/v1/user")) return json(USER);
  if (path.startsWith("/auth/v1/token") || path.startsWith("/auth/v1/session")) return json(session());
  if (path.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
  if (path.startsWith("/auth/v1/")) return json({});

  // Edge-функции: страницы должны переживать «интеграция не настроена».
  if (path.startsWith("/functions/v1/")) return json({});

  if (path.startsWith("/rest/v1/")) {
    const table = path.replace("/rest/v1/", "").split("/")[0];
    const rows = restFixture(table);
    // .single()/.maybeSingle() просят один объект, а не массив
    const wantsObject = (request.headers()["accept"] ?? "").includes("pgrst.object");
    if (wantsObject) return json(rows[0] ?? null);
    // count: 'exact' читает Content-Range
    return json(rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
  }

  if (path.startsWith("/storage/v1/")) return json({ data: [], signedURL: "", publicUrl: "" });

  return json({});
}

export async function installSupabaseMock(page: Page): Promise<void> {
  // Сессия должна лежать в localStorage ДО загрузки бандла, иначе AuthProvider
  // увидит гостя и RequireAuth уведёт на /login.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session())] as const,
  );
  await page.route("**://*.supabase.co/**", handle);
}
