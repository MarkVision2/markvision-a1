/**
 * Публичный API проекта для внешних клиентов (MCP-сервер, агенты, скрипты).
 * Авторизация — API-ключ проекта (Authorization: Bearer mv_live_… или x-api-key),
 * выдаётся в «Публикации → Настройки → API-ключи». Ключ привязан к проекту:
 * project_id нигде не передаётся, он берётся из ключа.
 *
 *   GET  /api/v1/me                          — проект и права ключа
 *   GET  /api/v1/accounts                    — подключённые аккаунты площадок
 *   POST /api/v1/accounts/:id                — правка аккаунта (вкл/выкл, лимит, группа, окно…)
 *   POST /api/v1/accounts/health-check       — живая проверка токенов у площадок
 *   GET  /api/v1/groups                      — группы аккаунтов
 *   POST /api/v1/groups | /groups/:id        — создать / изменить группу
 *   POST /api/v1/groups/:id/delete           — удалить группу
 *   GET|POST /api/v1/settings                — настройки проекта (пауза, уведомления, бюджет)
 *   GET  /api/v1/jobs?status=&limit=         — задания очереди
 *   GET  /api/v1/metrics                     — витрины публикаций/радара/аккаунтов
 *   POST /api/v1/media/upload-url            — ссылка для прямой загрузки файла (R2)
 *   POST /api/v1/publications                — принять видео (+ поставить задания)
 *   GET  /api/v1/publications                — последние видео и сводка по заданиям
 *   GET  /api/v1/publications/:id            — видео и задания по аккаунтам
 *   POST /api/v1/publications/:id/jobs       — задания на уже принятое видео
 *   POST /api/v1/jobs/:id/cancel | /retry    — отмена и повтор задания
 *   GET  /api/v1/jobs/:id                    — задание с трассой шагов, журналом и метриками
 *   GET  /api/v1/analytics/content           — аналитика по видео (витрина publish_content_metrics, победители)
 *   GET  /api/v1/analytics/content/:id       — одно видео: сводка и публикации по аккаунтам
 *   GET  /api/v1/analytics/accounts/:id      — аккаунт: витрина publish_account_metrics и последние публикации
 *   GET  /api/v1/notifications?unread=1      — центр уведомлений проекта
 *   POST /api/v1/notifications/:id/read      — отметить прочитанным
 *
 * Сама функция тонкая: проверяет ключ и границы проекта, а работу делают
 * существующие функции (publish-intake, r2-presign-upload, publish-accounts),
 * которые она зовёт внутренним ключом автоматизации. Контракт — docs/PUBLIC-API.md.
 *
 * index.ts — только Deno.serve; здесь обработчик с зависимостями наружу
 * (api_test.ts гоняет его с подменённой базой и сетью).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { checkRateLimit, hasScope, type ApiKeyContext, type RateBucket } from "../_lib/apiKeys.ts";
import { resolveApiKey } from "../_lib/apiKeysDb.ts";
import { matchRoute, parsePublicationInput, parseTarget, requiredScope, type ApiRoute } from "../_lib/publicApi.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
};

/** Всё внешнее — через deps, чтобы обработчик гонялся в deno test без сети и базы. */
export interface Deps {
  admin: SupabaseClient;
  supabaseUrl: string;
  /** anon-ключ проекта: шлюз функций с verify_jwt требует Authorization даже при x-automation-key. */
  anonKey: string;
  fetchFn: typeof fetch;
  rateStore: Map<string, RateBucket>;
  now: () => number;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extra, "Content-Type": "application/json" },
  });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/* ───────────── внутренние вызовы соседних функций ───────────── */

async function automationKey(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from("automation_settings").select("cron_secret").eq("id", true).maybeSingle();
  const key = (data as { cron_secret?: string | null } | null)?.cron_secret;
  if (!key) throw new Error("ключ автоматизации не настроен (automation_settings.cron_secret)");
  return key;
}

async function callInternal(
  deps: Deps, fn: string, body: unknown, headers: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await deps.fetchFn(`${deps.supabaseUrl}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // publish-accounts и publish-monitor стоят за verify_jwt: без Bearer шлюз
      // отвечает UNAUTHORIZED_NO_AUTH_HEADER, не доходя до x-automation-key.
      Authorization: `Bearer ${deps.anonKey}`,
      apikey: deps.anonKey,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({ error: `${fn}: ответ не JSON (HTTP ${res.status})` }));
  return { status: res.status, body: (parsed ?? {}) as Record<string, unknown> };
}

function passthrough(r: { status: number; body: Record<string, unknown> }): Response {
  return json(r.body, r.status >= 400 ? r.status : 200);
}

/* ───────────── обработчики ───────────── */

async function me(deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const { data } = await admin.from("projects").select("id, name").eq("id", ctx.projectId).maybeSingle();
  return json({
    ok: true,
    project: data ?? { id: ctx.projectId, name: null },
    key: { id: ctx.keyId, name: ctx.name, scopes: ctx.scopes },
  });
}

async function accounts(deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const { data, error } = await admin.from("publish_accounts")
    .select("id, platform, account_name, handle, status, publish_enabled, health_score, daily_limit, group_id, persona_id, timezone, window_start, window_end, last_checked_at, notes")
    .eq("project_id", ctx.projectId).order("platform").order("account_name");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, accounts: data ?? [] });
}

async function groups(deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const { data, error } = await admin.from("publish_account_groups")
    .select("id, name, platform, account_ids, publish_strategy, per_hour, persona_id, review_mode, timezone, window_start, window_end, min_gap_minutes, jitter_minutes")
    .eq("project_id", ctx.projectId).order("name");
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, groups: data ?? [] });
}

/* ───────────── управление: аккаунты, группы, настройки ───────────── */

const ACCOUNT_FIELDS = [
  "publish_enabled", "daily_limit", "account_name", "notes", "group_id", "persona_id",
  "timezone", "window_start", "window_end", "ramp_enabled", "ramp_restart", "status",
] as const;
const GROUP_FIELDS = [
  "name", "account_ids", "platform", "publish_strategy", "per_hour", "persona_id", "review_mode",
  "timezone", "window_start", "window_end", "min_gap_minutes", "jitter_minutes",
] as const;
const SETTINGS_FIELDS = ["notify_mode", "digest_chat_id", "paused", "daily_usd", "monthly_usd"] as const;

/** Только известные поля — чужие ключи тела в соседнюю функцию не утекают. */
function pick(body: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((acc, f) => (f in body ? { ...acc, [f]: body[f] } : acc), {});
}

/** Вызов publish-accounts от имени проекта ключа. */
async function accountsAction(deps: Deps, ctx: ApiKeyContext, action: string, body: Record<string, unknown>) {
  return callInternal(deps, "publish-accounts", { action, project_id: ctx.projectId, ...body }, {
    "x-automation-key": await automationKey(deps.admin),
  });
}

async function ownsRow(admin: SupabaseClient, table: string, id: string, projectId: string): Promise<boolean> {
  const { data } = await admin.from(table).select("id").eq("id", id).eq("project_id", projectId).maybeSingle();
  return Boolean(data);
}

async function accountUpdate(req: Request, deps: Deps, ctx: ApiKeyContext, id: string): Promise<Response> {
  const admin = deps.admin;
  if (!(await ownsRow(admin, "publish_accounts", id, ctx.projectId))) return json({ error: "аккаунт не найден" }, 404);
  const patch = pick(await readJson(req), ACCOUNT_FIELDS);
  if (!Object.keys(patch).length) return json({ error: `нечего менять — поля: ${ACCOUNT_FIELDS.join(", ")}` }, 400);
  if (typeof patch.group_id === "string" && !(await ownsRow(admin, "publish_account_groups", patch.group_id, ctx.projectId))) {
    return json({ error: "группа не найдена" }, 404);
  }
  return passthrough(await accountsAction(deps, ctx, "update", { account_id: id, ...patch }));
}

async function accountsHealthCheck(req: Request, deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const body = await readJson(req);
  const ids = Array.isArray(body.account_ids) ? body.account_ids.map(String) : [];
  const r = await callInternal(deps, "publish-monitor", {
    mode: "health", project_id: ctx.projectId, ...(ids.length ? { account_ids: ids } : {}),
  }, { "x-automation-key": await automationKey(admin) });
  return passthrough(r);
}

async function groupUpsert(req: Request, deps: Deps, ctx: ApiKeyContext, id: string | null): Promise<Response> {
  const admin = deps.admin;
  if (id && !(await ownsRow(admin, "publish_account_groups", id, ctx.projectId))) return json({ error: "группа не найдена" }, 404);
  const body = pick(await readJson(req), GROUP_FIELDS);
  if (id) {
    // Частичная правка: недостающие поля берём из текущей группы.
    const { data } = await admin.from("publish_account_groups").select("name, account_ids").eq("id", id).maybeSingle();
    const cur = (data ?? {}) as { name?: string; account_ids?: string[] };
    return passthrough(await accountsAction(deps, ctx, "group_upsert", {
      id, name: cur.name, account_ids: cur.account_ids ?? [], ...body,
    }));
  }
  if (typeof body.name !== "string" || !body.name.trim()) return json({ error: "name обязателен" }, 400);
  return passthrough(await accountsAction(deps, ctx, "group_upsert", { account_ids: [], ...body }));
}

async function groupDelete(deps: Deps, ctx: ApiKeyContext, id: string): Promise<Response> {
  const admin = deps.admin;
  if (!(await ownsRow(admin, "publish_account_groups", id, ctx.projectId))) return json({ error: "группа не найдена" }, 404);
  return passthrough(await accountsAction(deps, ctx, "group_delete", { group_id: id }));
}

async function settingsGet(deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  return passthrough(await accountsAction(deps, ctx, "settings_get", {}));
}

async function settingsUpdate(req: Request, deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const patch = pick(await readJson(req), SETTINGS_FIELDS);
  if (!Object.keys(patch).length) return json({ error: `нечего менять — поля: ${SETTINGS_FIELDS.join(", ")}` }, 400);
  return passthrough(await accountsAction(deps, ctx, "settings_upsert", patch));
}

async function jobsList(req: Request, deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const q = new URL(req.url).searchParams;
  const limit = Math.min(500, Math.max(1, Number(q.get("limit") ?? 100)));
  const status = q.get("status");
  return passthrough(await accountsAction(deps, ctx, "jobs_list", { limit, ...(status ? { status } : {}) }));
}

async function metrics(deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  return passthrough(await accountsAction(deps, ctx, "metrics", {}));
}

async function uploadUrl(req: Request, deps: Deps): Promise<Response> {
  const admin = deps.admin;
  const body = await readJson(req);
  const filename = String(body.filename ?? "").trim();
  const size = Number(body.size ?? 0);
  if (!filename) return json({ error: "filename обязателен" }, 400);
  if (!Number.isFinite(size) || size <= 0) return json({ error: "size — размер файла в байтах" }, 400);

  const { data } = await admin.from("cf_settings").select("value").eq("key", "client_pub_key").maybeSingle();
  const appKey = (data as { value?: string } | null)?.value;
  if (!appKey) return json({ error: "загрузка в хранилище не настроена (cf_settings.client_pub_key)" }, 500);

  const r = await callInternal(deps, "r2-presign-upload", {
    filename, size, contentType: String(body.content_type ?? body.contentType ?? "application/octet-stream"),
  }, { "x-app-key": appKey });
  if (r.status >= 400 || r.body.error) return json({ error: r.body.error ?? "presign failed" }, r.status >= 400 ? r.status : 500);
  return json({
    ok: true,
    method: "PUT",
    upload_url: r.body.uploadUrl,
    file_url: r.body.publicUrl,
    note: "Отправьте байты PUT-запросом на upload_url с тем же Content-Type, затем передайте file_url в POST /publications.",
  });
}

/** Цель публикации должна быть из проекта ключа: intake чужую группу молча пропустит с created=0. */
async function targetError(admin: SupabaseClient, ctx: ApiKeyContext, target: { group_id?: string; account_ids?: string[] } | null): Promise<string | null> {
  if (!target) return null;
  if (target.group_id && !(await ownsRow(admin, "publish_account_groups", target.group_id, ctx.projectId))) return "группа не найдена";
  if (target.account_ids?.length) {
    const { data } = await admin.from("publish_accounts").select("id").eq("project_id", ctx.projectId).in("id", target.account_ids);
    const known = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    const alien = target.account_ids.filter((id) => !known.has(id));
    if (alien.length) return `аккаунты не найдены: ${alien.join(", ")}`;
  }
  return null;
}

async function publicationCreate(req: Request, deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const parsed = parsePublicationInput(await readJson(req));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { input } = parsed;
  const bad = await targetError(admin, ctx, input.target);
  if (bad) return json({ error: bad }, 404);
  const r = await callInternal(deps, "publish-intake", {
    action: "video_ready",
    project_id: ctx.projectId,
    file_url: input.file_url,
    title: input.title,
    base_caption: input.caption,
    caption_variants: input.caption_variants,
    hashtags: input.hashtags,
    duration_sec: input.duration_sec,
    ...(input.client_ref ? { client_ref: input.client_ref } : {}),
    source: "api",
    source_ref: `api_key:${ctx.keyId}`,
    ...(input.target ? { target: input.target } : {}),
  }, { "x-automation-key": await automationKey(admin) });
  return passthrough(r);
}

interface JobRow {
  id: string; video_id: string; account_id: string; platform: string; status: string;
  scheduled_at: string | null; published_at: string | null; external_post_url: string | null;
  error_code: string | null; error_message: string | null; attempts: number;
  publish_accounts: { account_name: string; handle: string | null } | null;
}

const JOB_FIELDS =
  "id, video_id, account_id, platform, status, scheduled_at, published_at, external_post_url, error_code, error_message, attempts, publish_accounts(account_name, handle)";

function summarize(jobs: JobRow[]): Record<string, number> {
  return jobs.reduce<Record<string, number>>((acc, j) => ({ ...acc, [j.status]: (acc[j.status] ?? 0) + 1 }), {});
}

async function publicationsList(req: Request, deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 20)));
  const { data: videos, error } = await admin.from("publish_videos")
    .select("id, title, file_url, duration_sec, source, created_at")
    .eq("project_id", ctx.projectId).order("created_at", { ascending: false }).limit(limit);
  if (error) return json({ error: error.message }, 500);
  const ids = (videos ?? []).map((v) => (v as { id: string }).id);
  const { data: jobs } = ids.length
    ? await admin.from("publish_jobs").select("video_id, status").in("video_id", ids)
    : { data: [] };
  const byVideo = ((jobs ?? []) as { video_id: string; status: string }[]).reduce<Record<string, Record<string, number>>>(
    (acc, j) => ({ ...acc, [j.video_id]: { ...(acc[j.video_id] ?? {}), [j.status]: (acc[j.video_id]?.[j.status] ?? 0) + 1 } }),
    {},
  );
  return json({
    ok: true,
    publications: (videos ?? []).map((v) => ({ ...(v as object), jobs: byVideo[(v as { id: string }).id] ?? {} })),
  });
}

async function videoOfProject(admin: SupabaseClient, ctx: ApiKeyContext, id: string) {
  const { data } = await admin.from("publish_videos")
    .select("id, title, file_url, base_caption, caption_variants, hashtags, duration_sec, source, created_at")
    .eq("id", id).eq("project_id", ctx.projectId).maybeSingle();
  return data as Record<string, unknown> | null;
}

async function publicationGet(deps: Deps, ctx: ApiKeyContext, id: string): Promise<Response> {
  const admin = deps.admin;
  const video = await videoOfProject(admin, ctx, id);
  if (!video) return json({ error: "публикация не найдена" }, 404);
  const { data: jobs, error } = await admin.from("publish_jobs").select(JOB_FIELDS)
    .eq("video_id", id).order("scheduled_at");
  if (error) return json({ error: error.message }, 500);
  const rows = (jobs ?? []) as unknown as JobRow[];
  return json({ ok: true, publication: { ...video, summary: summarize(rows), jobs: rows } });
}

async function publicationJobsCreate(req: Request, deps: Deps, ctx: ApiKeyContext, id: string): Promise<Response> {
  const admin = deps.admin;
  if (!(await videoOfProject(admin, ctx, id))) return json({ error: "публикация не найдена" }, 404);
  const body = await readJson(req);
  const parsed = parseTarget((body.target as Record<string, unknown> | undefined) ?? body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const bad = await targetError(admin, ctx, parsed.target);
  if (bad) return json({ error: bad }, 404);
  const r = await callInternal(deps, "publish-intake", {
    action: "create_jobs", video_id: id, target: parsed.target,
  }, { "x-automation-key": await automationKey(admin) });
  return passthrough(r);
}

async function jobAction(deps: Deps, ctx: ApiKeyContext, id: string, action: "job_cancel" | "job_retry"): Promise<Response> {
  const admin = deps.admin;
  const { data } = await admin.from("publish_jobs").select("id, project_id").eq("id", id).maybeSingle();
  const job = data as { id: string; project_id: string } | null;
  if (!job || job.project_id !== ctx.projectId) return json({ error: "задание не найдено" }, 404);
  return passthrough(await accountsAction(deps, ctx, action, { job_id: id }));
}

/* ───────────── трасса задания, аналитика, уведомления ───────────── */

async function jobGet(deps: Deps, ctx: ApiKeyContext, id: string): Promise<Response> {
  const admin = deps.admin;
  const { data } = await admin.from("publish_jobs").select("id, project_id").eq("id", id).maybeSingle();
  const job = data as { id: string; project_id: string } | null;
  if (!job || job.project_id !== ctx.projectId) return json({ error: "задание не найдено" }, 404);
  return passthrough(await accountsAction(deps, ctx, "job_get", { job_id: id }));
}

async function analyticsContent(req: Request, deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const admin = deps.admin;
  const q = new URL(req.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 50)));
  const winners = q.get("winners") === "1";
  let query = admin.from("publish_content_metrics").select("*").eq("project_id", ctx.projectId)
    .order("score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(limit);
  if (winners) query = query.eq("is_winner", true);
  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, content: data ?? [] });
}

async function analyticsContentItem(deps: Deps, ctx: ApiKeyContext, id: string): Promise<Response> {
  const admin = deps.admin;
  const { data: content, error } = await admin.from("publish_content_metrics").select("*")
    .eq("content_id", id).eq("project_id", ctx.projectId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!content) return json({ error: "видео не найдено" }, 404);
  const { data: publications } = await admin.from("publish_publications").select("*")
    .eq("content_id", id).eq("project_id", ctx.projectId).order("published_at", { ascending: false });
  return json({ ok: true, content, publications: publications ?? [] });
}

async function analyticsAccount(deps: Deps, ctx: ApiKeyContext, id: string): Promise<Response> {
  const admin = deps.admin;
  const { data: account, error } = await admin.from("publish_account_metrics").select("*")
    .eq("account_id", id).eq("project_id", ctx.projectId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!account) return json({ error: "аккаунт не найден" }, 404);
  const { data: publications } = await admin.from("publish_publications").select("*")
    .eq("account_id", id).eq("project_id", ctx.projectId).order("published_at", { ascending: false }).limit(50);
  return json({ ok: true, account, publications: publications ?? [] });
}

async function notificationsList(req: Request, deps: Deps, ctx: ApiKeyContext): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 50)));
  return passthrough(await accountsAction(deps, ctx, "notifications_list", { limit, unread_only: q.get("unread") === "1" }));
}

async function notificationRead(deps: Deps, ctx: ApiKeyContext, id: string): Promise<Response> {
  const admin = deps.admin;
  if (!(await ownsRow(admin, "publish_notifications", id, ctx.projectId))) return json({ error: "уведомление не найдено" }, 404);
  return passthrough(await accountsAction(deps, ctx, "notification_read", { notification_id: id }));
}

/** Аудит вызова (api_request_logs): ключ, маршрут, статус, хэш параметров — без содержимого и без ожидания. */
async function paramsHash(url: URL, bodyText: string | null): Promise<string | null> {
  const src = `${url.search}${bodyText ?? ""}`;
  if (!src) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function auditRequest(deps: Deps, ctx: ApiKeyContext, req: Request, route: ApiRoute, status: number, startedAt: number, bodyText: string | null): void {
  const url = new URL(req.url);
  void paramsHash(url, bodyText).then((hash) =>
    deps.admin.from("api_request_logs").insert({
      api_key_id: ctx.keyId,
      project_id: ctx.projectId,
      method: req.method.toUpperCase(),
      route: route.name,
      path: url.pathname.slice(0, 300),
      status,
      params_hash: hash,
      duration_ms: Math.max(0, deps.now() - startedAt),
    }),
  ).then(() => {}, () => {});
}

async function dispatch(req: Request, deps: Deps, ctx: ApiKeyContext, route: ApiRoute): Promise<Response> {
  switch (route.name) {
    case "me": return me(deps, ctx);
    case "accounts": return accounts(deps, ctx);
    case "account_update": return accountUpdate(req, deps, ctx, route.id);
    case "accounts_health_check": return accountsHealthCheck(req, deps, ctx);
    case "groups": return groups(deps, ctx);
    case "group_create": return groupUpsert(req, deps, ctx, null);
    case "group_update": return groupUpsert(req, deps, ctx, route.id);
    case "group_delete": return groupDelete(deps, ctx, route.id);
    case "settings_get": return settingsGet(deps, ctx);
    case "settings_update": return settingsUpdate(req, deps, ctx);
    case "jobs_list": return jobsList(req, deps, ctx);
    case "metrics": return metrics(deps, ctx);
    case "upload_url": return uploadUrl(req, deps);
    case "publication_create": return publicationCreate(req, deps, ctx);
    case "publications_list": return publicationsList(req, deps, ctx);
    case "publication_get": return publicationGet(deps, ctx, route.id);
    case "publication_jobs_create": return publicationJobsCreate(req, deps, ctx, route.id);
    case "job_cancel": return jobAction(deps, ctx, route.id, "job_cancel");
    case "job_retry": return jobAction(deps, ctx, route.id, "job_retry");
    case "job_get": return jobGet(deps, ctx, route.id);
    case "analytics_content": return analyticsContent(req, deps, ctx);
    case "analytics_content_item": return analyticsContentItem(deps, ctx, route.id);
    case "analytics_account": return analyticsAccount(deps, ctx, route.id);
    case "notifications_list": return notificationsList(req, deps, ctx);
    case "notification_read": return notificationRead(deps, ctx, route.id);
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const route = matchRoute(req.method, new URL(req.url).pathname);
  if (!route) return json({ error: "маршрут не найден — см. docs/PUBLIC-API.md" }, 404);

  const auth = await resolveApiKey(req, deps.admin, deps.now());
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const need = requiredScope(route);
  if (!hasScope(auth.ctx.scopes, need)) return json({ error: `у ключа нет права ${need}` }, 403);

  const rate = checkRateLimit(deps.rateStore, auth.ctx.keyId, deps.now());
  if (!rate.allowed) {
    return json({ error: "слишком много запросов, подождите" }, 429, { "Retry-After": String(rate.retryAfterSec) });
  }

  // Тело читаем один раз здесь: обработчикам отдаём клон, хэш — в аудит.
  const startedAt = deps.now();
  let bodyText: string | null = null;
  let reqForHandler = req;
  if (req.method === "POST") {
    bodyText = await req.text().catch(() => "");
    reqForHandler = new Request(req.url, { method: req.method, headers: req.headers, body: bodyText || undefined });
  }
  try {
    const res = await dispatch(reqForHandler, deps, auth.ctx, route);
    auditRequest(deps, auth.ctx, req, route, res.status, startedAt, bodyText);
    return res;
  } catch (e) {
    auditRequest(deps, auth.ctx, req, route, 500, startedAt, bodyText);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
