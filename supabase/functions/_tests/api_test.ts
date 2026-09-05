/**
 * Публичный API насквозь, без сети и базы: ключ → права → границы проекта →
 * что именно уходит в соседние функции. Запуск:
 *   cd supabase/functions && deno test --allow-env _tests/api_test.ts
 *
 * Каталог `_tests` начинается с подчёркивания — CI-деплой такие пропускает.
 */
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { handle, type Deps } from "../api/handler.ts";
import { hashApiKey, RATE_LIMIT_PER_MINUTE, type RateBucket } from "../_lib/apiKeys.ts";

type Row = Record<string, unknown>;
interface Write { table: string; op: string; payload: unknown }

/** Заглушка supabase-js: фильтры eq/in/is по строкам таблицы, запись — в журнал. */
function fakeAdmin(tables: Record<string, Row[]>, writes: Write[]): SupabaseClient {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      // deno-lint-ignore no-explicit-any
      const b: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve({ data: rows, error: null }).then(res, rej);
          if (prop === "maybeSingle") return () => Promise.resolve({ data: rows[0] ?? null, error: null });
          if (prop === "eq" || prop === "is") return (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return b; };
          if (prop === "in") return (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return b; };
          if (prop === "update" || prop === "insert") return (payload: unknown) => { writes.push({ table, op: prop, payload }); return b; };
          return () => b; // select, order, limit
        },
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

interface Call { url: string; headers: Record<string, string>; body: Row }

function fakeFetch(calls: Call[], reply: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true } })) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const r = reply(url);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
}

const KEY = "mv_live_TESTKEYTESTKEYTESTKEYTESTKEYTESTKEY";
const READ_KEY = "mv_live_READONLYREADONLYREADONLYREADONLYREAD";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACC = "33333333-3333-4333-8333-333333333333";
const ALIEN_ACC = "44444444-4444-4444-8444-444444444444";
const GROUP = "55555555-5555-4555-8555-555555555555";
const VIDEO = "66666666-6666-4666-8666-666666666666";
const NOW = Date.parse("2026-09-05T12:00:00Z");
const URL_BASE = "https://x.supabase.co";

async function setup(overrides: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    api_keys: [
      { id: "k1", project_id: PROJECT, name: "full", scopes: ["read", "publish", "manage"], expires_at: null, revoked_at: null, key_hash: await hashApiKey(KEY) },
      { id: "k2", project_id: PROJECT, name: "ro", scopes: ["read"], expires_at: null, revoked_at: null, key_hash: await hashApiKey(READ_KEY) },
    ],
    projects: [{ id: PROJECT, name: "Стоматология" }],
    automation_settings: [{ id: true, cron_secret: "cron-secret" }],
    cf_settings: [{ key: "client_pub_key", value: "app-key" }],
    publish_accounts: [{ id: ACC, project_id: PROJECT, platform: "instagram", account_name: "@a" }, { id: ALIEN_ACC, project_id: OTHER }],
    publish_account_groups: [{ id: GROUP, project_id: PROJECT, name: "Группа", account_ids: [ACC] }],
    publish_videos: [{ id: VIDEO, project_id: PROJECT, title: "Ролик" }],
    publish_jobs: [
      { id: "j1", video_id: VIDEO, project_id: PROJECT, status: "published" },
      { id: "j2", video_id: VIDEO, project_id: PROJECT, status: "pending" },
    ],
    ...overrides,
  };
  const writes: Write[] = [];
  const calls: Call[] = [];
  const deps: Deps = {
    admin: fakeAdmin(tables, writes),
    supabaseUrl: URL_BASE,
    anonKey: "anon-jwt",
    fetchFn: fakeFetch(calls),
    rateStore: new Map<string, RateBucket>(),
    now: () => NOW,
  };
  return { deps, writes, calls };
}

function req(method: string, path: string, opts: { key?: string | null; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.key !== null) headers.Authorization = `Bearer ${opts.key ?? KEY}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`${URL_BASE}/functions/v1/api/v1${path}`, {
    method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function json(res: Response): Promise<Row> {
  return (await res.json()) as Row;
}

Deno.test("без ключа, с JWT, с чужим ключом — 401", async () => {
  const { deps } = await setup();
  assertEquals((await handle(req("GET", "/me", { key: null }), deps)).status, 401);
  assertEquals((await handle(req("GET", "/me", { key: "eyJhbGciOiJIUzI1NiJ9.e30.sig-jwt-looking" }), deps)).status, 401);
  assertEquals((await handle(req("GET", "/me", { key: "mv_live_UNKNOWNUNKNOWNUNKNOWNUNKNOWNUNKN" }), deps)).status, 401);
});

Deno.test("отозванный и истёкший ключ — 401 с причиной", async () => {
  const revoked = await setup({ api_keys: [{ id: "k", project_id: PROJECT, name: "r", scopes: ["read"], expires_at: null, revoked_at: "2026-09-01T00:00:00Z", key_hash: await hashApiKey(KEY) }] });
  const r1 = await handle(req("GET", "/me"), revoked.deps);
  assertEquals(r1.status, 401);
  assertMatch(String((await json(r1)).error), /отозван/);

  const expired = await setup({ api_keys: [{ id: "k", project_id: PROJECT, name: "e", scopes: ["read"], expires_at: "2026-09-04T00:00:00Z", revoked_at: null, key_hash: await hashApiKey(KEY) }] });
  const r2 = await handle(req("GET", "/me"), expired.deps);
  assertEquals(r2.status, 401);
  assertMatch(String((await json(r2)).error), /истёк/);
});

Deno.test("x-api-key работает наравне с Bearer; /me отдаёт проект и права", async () => {
  const { deps, writes } = await setup();
  const res = await handle(req("GET", "/me", { key: null, headers: { "x-api-key": KEY } }), deps);
  assertEquals(res.status, 200);
  const body = await json(res);
  assertEquals((body.project as Row).name, "Стоматология");
  assertEquals((body.key as Row).scopes, ["read", "publish", "manage"]);
  // last_used_at обновляется
  assertEquals(writes.some((w) => w.table === "api_keys" && w.op === "update"), true);
});

Deno.test("права: read-ключ не публикует и не управляет, но читает", async () => {
  const { deps, calls } = await setup();
  const denied = await handle(req("POST", "/publications", { key: READ_KEY, body: { file_url: "https://v/x.mp4" } }), deps);
  assertEquals(denied.status, 403);
  assertMatch(String((await json(denied)).error), /publish/);
  const denied2 = await handle(req("POST", "/settings", { key: READ_KEY, body: { paused: true } }), deps);
  assertEquals(denied2.status, 403);
  assertEquals(calls.length, 0);
  const ok = await handle(req("GET", "/accounts", { key: READ_KEY }), deps);
  assertEquals(ok.status, 200);
});

Deno.test("неизвестный маршрут — 404 до проверки ключа", async () => {
  const { deps } = await setup();
  assertEquals((await handle(req("DELETE", "/me", { key: null }), deps)).status, 404);
});

Deno.test("лимит запросов: после 120 в минуту — 429 с Retry-After", async () => {
  const { deps } = await setup();
  for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) assertEquals((await handle(req("GET", "/me"), deps)).status, 200);
  const res = await handle(req("GET", "/me"), deps);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("Retry-After"), "60");
});

Deno.test("публикация: project_id из ключа, source=api, цель и ключ автоматизации уходят в publish-intake", async () => {
  const { deps, calls } = await setup();
  const res = await handle(req("POST", "/publications", {
    body: { file_url: "https://cdn/x.mp4", title: "T", caption: "C", hashtags: ["#a", "b"], group_id: GROUP, mode: "now", project_id: OTHER },
  }), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, `${URL_BASE}/functions/v1/publish-intake`);
  assertEquals(calls[0].headers["x-automation-key"], "cron-secret");
  assertEquals(calls[0].headers.Authorization, "Bearer anon-jwt");
  assertEquals(calls[0].body.action, "video_ready");
  assertEquals(calls[0].body.project_id, PROJECT);
  assertEquals(calls[0].body.source, "api");
  assertEquals(calls[0].body.source_ref, "api_key:k1");
  assertEquals(calls[0].body.base_caption, "C");
  assertEquals(calls[0].body.hashtags, ["a", "b"]);
  assertEquals(calls[0].body.target, { mode: "now", group_id: GROUP });
});

Deno.test("публикация: чужая группа или аккаунт — 404 без похода в intake", async () => {
  const { deps, calls } = await setup();
  const g = await handle(req("POST", "/publications", { body: { file_url: "https://cdn/x.mp4", group_id: "99999999-9999-4999-8999-999999999999" } }), deps);
  assertEquals(g.status, 404);
  assertMatch(String((await json(g)).error), /группа/);
  const a = await handle(req("POST", "/publications", { body: { file_url: "https://cdn/x.mp4", account_ids: [ACC, ALIEN_ACC] } }), deps);
  assertEquals(a.status, 404);
  assertMatch(String((await json(a)).error), new RegExp(ALIEN_ACC));
  const j = await handle(req("POST", `/publications/${VIDEO}/jobs`, { body: { account_ids: [ALIEN_ACC] } }), deps);
  assertEquals(j.status, 404);
  assertEquals(calls.length, 0);
  const ok = await handle(req("POST", `/publications/${VIDEO}/jobs`, { body: { account_ids: [ACC], mode: "now" } }), deps);
  assertEquals(ok.status, 200);
  assertEquals(calls[0].body, { action: "create_jobs", video_id: VIDEO, target: { mode: "now", account_ids: [ACC] } });
});

Deno.test("публикация: плохой вход — 400 без похода в соседние функции; ошибка intake — сквозной статус", async () => {
  const { deps, calls } = await setup();
  const bad = await handle(req("POST", "/publications", { body: { file_url: "ftp://x" } }), deps);
  assertEquals(bad.status, 400);
  assertEquals(calls.length, 0);

  const failing = await setup();
  failing.deps.fetchFn = fakeFetch(failing.calls, () => ({ status: 422, body: { error: "по ссылке лежит не видео" } }));
  const res = await handle(req("POST", "/publications", { body: { file_url: "https://cdn/x.txt" } }), failing.deps);
  assertEquals(res.status, 422);
  assertMatch(String((await json(res)).error), /не видео/);
});

Deno.test("ссылка на загрузку: presign с x-app-key, ответ переименован", async () => {
  const { deps, calls } = await setup();
  deps.fetchFn = fakeFetch(calls, () => ({ status: 200, body: { ok: true, uploadUrl: "https://r2/put", publicUrl: "https://cdn/posts/a.mp4" } }));
  const res = await handle(req("POST", "/media/upload-url", { body: { filename: "a.mp4", size: 10, content_type: "video/mp4" } }), deps);
  assertEquals(res.status, 200);
  const body = await json(res);
  assertEquals(body.upload_url, "https://r2/put");
  assertEquals(body.file_url, "https://cdn/posts/a.mp4");
  assertEquals(calls[0].url, `${URL_BASE}/functions/v1/r2-presign-upload`);
  assertEquals(calls[0].headers["x-app-key"], "app-key");
  assertEquals(calls[0].body.contentType, "video/mp4");
});

Deno.test("статус публикации: своя — сводка по статусам, чужая — 404", async () => {
  const { deps } = await setup();
  const res = await handle(req("GET", `/publications/${VIDEO}`), deps);
  assertEquals(res.status, 200);
  const pub = (await json(res)).publication as Row;
  assertEquals(pub.summary, { published: 1, pending: 1 });
  assertEquals((pub.jobs as Row[]).length, 2);

  const alien = await setup({ publish_videos: [{ id: VIDEO, project_id: OTHER }] });
  assertEquals((await handle(req("GET", `/publications/${VIDEO}`), alien.deps)).status, 404);
});

Deno.test("аккаунт: чужой — 404 без вызова; свой — только известные поля уходят в update", async () => {
  const { deps, calls } = await setup();
  const alien = await handle(req("POST", `/accounts/${ALIEN_ACC}`, { body: { publish_enabled: false } }), deps);
  assertEquals(alien.status, 404);
  assertEquals(calls.length, 0);

  const res = await handle(req("POST", `/accounts/${ACC}`, { body: { publish_enabled: false, daily_limit: 1, project_id: OTHER, evil: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals(calls[0].url, `${URL_BASE}/functions/v1/publish-accounts`);
  assertEquals(calls[0].body, { action: "update", project_id: PROJECT, account_id: ACC, publish_enabled: false, daily_limit: 1 });

  const empty = await handle(req("POST", `/accounts/${ACC}`, { body: { evil: 1 } }), deps);
  assertEquals(empty.status, 400);
});

Deno.test("группа: частичная правка подставляет текущие name/account_ids; удаление и создание", async () => {
  const { deps, calls } = await setup();
  const upd = await handle(req("POST", `/groups/${GROUP}`, { body: { per_hour: 3 } }), deps);
  assertEquals(upd.status, 200);
  assertEquals(calls[0].body, { action: "group_upsert", project_id: PROJECT, id: GROUP, name: "Группа", account_ids: [ACC], per_hour: 3 });

  const del = await handle(req("POST", `/groups/${GROUP}/delete`), deps);
  assertEquals(del.status, 200);
  assertEquals(calls[1].body, { action: "group_delete", project_id: PROJECT, group_id: GROUP });

  const noName = await handle(req("POST", "/groups", { body: { per_hour: 2 } }), deps);
  assertEquals(noName.status, 400);
  const created = await handle(req("POST", "/groups", { body: { name: "Новая", account_ids: [ACC] } }), deps);
  assertEquals(created.status, 200);
  assertEquals(calls[2].body, { action: "group_upsert", project_id: PROJECT, account_ids: [ACC], name: "Новая" });
});

Deno.test("настройки, задания, метрики, проверка здоровья — от имени проекта ключа", async () => {
  const { deps, calls } = await setup();
  assertEquals((await handle(req("POST", "/settings", { body: { paused: true, daily_usd: 5, junk: 1 } }), deps)).status, 200);
  assertEquals(calls[0].body, { action: "settings_upsert", project_id: PROJECT, paused: true, daily_usd: 5 });
  // publish-accounts стоит за verify_jwt — Bearer обязателен наряду с ключом автоматизации.
  assertEquals(calls[0].headers.Authorization, "Bearer anon-jwt");
  assertEquals(calls[0].headers["x-automation-key"], "cron-secret");

  assertEquals((await handle(req("GET", "/jobs?status=failed&limit=7"), deps)).status, 200);
  assertEquals(calls[1].body, { action: "jobs_list", project_id: PROJECT, limit: 7, status: "failed" });

  assertEquals((await handle(req("GET", "/metrics"), deps)).status, 200);
  assertEquals(calls[2].body.action, "metrics");

  assertEquals((await handle(req("POST", "/accounts/health-check", { body: { account_ids: [ACC] } }), deps)).status, 200);
  assertEquals(calls[3].url, `${URL_BASE}/functions/v1/publish-monitor`);
  assertEquals(calls[3].body, { mode: "health", project_id: PROJECT, account_ids: [ACC] });
});

Deno.test("задание: чужое — 404, своё — отмена через publish-accounts", async () => {
  const { deps, calls } = await setup({ publish_jobs: [{ id: "77777777-7777-4777-8777-777777777777", project_id: OTHER }, { id: "88888888-8888-4888-8888-888888888888", project_id: PROJECT }] });
  assertEquals((await handle(req("POST", "/jobs/77777777-7777-4777-8777-777777777777/cancel"), deps)).status, 404);
  assertEquals(calls.length, 0);
  assertEquals((await handle(req("POST", "/jobs/88888888-8888-4888-8888-888888888888/cancel"), deps)).status, 200);
  assertEquals(calls[0].body, { action: "job_cancel", project_id: PROJECT, job_id: "88888888-8888-4888-8888-888888888888" });
});
