/**
 * Подключение и обслуживание аккаунтов площадок для очереди публикаций.
 *
 * Онбординг Instagram по ТЗ: аккаунт переведён в Business/Creator и привязан к
 * Facebook-странице → пользователь один раз проходит Meta OAuth (существующие
 * facebook-oauth-*) → здесь он выбирает пачку страниц, и мы сохраняем
 * ig_user_id + page-токен (шифротекстом). Дальше руками не трогаем ничего.
 *
 *   { action: "available",  project_id, meta_token? }        — что можно подключить (перебирает токены проекта)
 *   { action: "connect",    project_id, page_ids: [...], meta_token?, group_id? } — подключить пачкой
 *   { action: "list",       project_id }                     — что подключено
 *   { action: "update",     account_id, ... }                — вкл/выкл, лимит, статус
 *   { action: "disconnect", account_id }                     — отключить
 *
 * Группы («залить во все клиники») — тот же endpoint:
 *   { action: "group_list",   project_id }
 *   { action: "group_upsert", project_id, id?, name, account_ids, platform?, publish_strategy?, per_hour?,
 *                             persona_id?, review_mode?, timezone?, window_start?, window_end?, min_gap_minutes?, jitter_minutes? }
 *   { action: "group_delete", group_id }
 *
 * Дистрибуция 100+ (docs/AUTOPOSTING-PLATFORM-PLAN.md):
 *   { action: "connect_threads", project_id, threads_user_id, access_token, account_name?, expires_at? }
 *   { action: "persona_list" | "persona_upsert" | "persona_delete", project_id, ... }
 *   { action: "settings_get" | "settings_upsert", project_id,  notify_mode?, digest_chat_id?, paused?, daily_usd?, monthly_usd? }
 *   { action: "jobs_list", project_id, status?, limit? }
 *   { action: "campaign_list" | "campaign_get" | "campaign_upsert" | "campaign_items_add" | "campaign_items_remove"
 *             | "campaign_status" | "campaign_plan_now", project_id, campaign_id?, ... } — кампании (docs/JOBS.md)
 *   { action: "webhook_list" | "webhook_upsert" | "webhook_delete" | "webhook_deliveries", project_id, webhook_id?, ... }
 *   { action: "job_get", job_id }                                — задание + трасса шагов (publish_job_events)
 *   { action: "notifications_list", project_id, unread_only?, limit? } — центр уведомлений
 *   { action: "notification_read", project_id, notification_id? | all: true }
 *   { action: "job_retry" | "job_cancel", project_id, job_id }   — повтор остановленного / отмена не ушедшего
 *   { action: "publish_video", project_id, file_url | video_id, group_id?, account_ids?, mode?, title?, caption?, hashtags? }
 *   { action: "metrics", project_id } → { publish, radar, videos, groups, accounts } — accounts из publish_account_metrics
 *   { action: "metrics", project_id } — витрины publish_metrics / radar_metrics
 *   { action: "api_key_list" | "api_key_create" | "api_key_revoke", project_id, name?, scopes?, expires_days?, key_id? }
 *       — API-ключи проекта для edge-функции api (docs/PUBLIC-API.md); ключ отдаётся один раз при создании
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireProjectAccess, requireUser } from "../_lib/auth.ts";
import { generateApiKey, hashApiKey, normalizeScopes } from "../_lib/apiKeys.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
import { resolveCapabilities, tokenKindOf } from "../_lib/publishCapabilities.ts";
import { generateWebhookSecret, isWebhookEvent } from "../_lib/webhooks.ts";
import {
  automationKeyValid,
  CORS_HEADERS,
  encryptSecret,
  isPlatform as isPlatformName,
  json,
  tokenKeyConfigured,
} from "../_lib/publishing.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

interface IgBusinessAccount {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
}

interface MetaPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: IgBusinessAccount;
}

async function metaPages(token: string): Promise<{ pages: MetaPage[]; error?: string }> {
  // Токен кодируется: символы вроде «|» или пробел в сыром виде ломают разбор
  // на стороне Graph («Cannot parse access token»).
  const res = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count}&limit=200&access_token=${encodeURIComponent(token)}`,
  );
  const body = await res.json().catch(() => ({}));
  if (body?.error) return { pages: [], error: body.error.message as string };
  return { pages: (body?.data ?? []) as MetaPage[] };
}

/**
 * Все Meta-токены, которыми проект может открыть /me/accounts, по убыванию
 * доверия: вставленный пользователем → meta_tokens проекта (активный, затем
 * прошлые) → свежие OAuth-сессии Facebook (meta_oauth_pending_selections, сутки)
 * → OAuth-токены рекламных кабинетов проекта → общий токен automation_settings /
 * env. resolveMetaAccessToken отдаёт только первый непустой — если он протух
 * или записан с мусором, подключение падало, хотя рядом лежал рабочий.
 */
async function metaTokenCandidates(admin: SupabaseClient, projectId: string, bodyToken: string | null): Promise<{ source: string; token: string }[]> {
  const out: { source: string; token: string }[] = [];
  const push = (source: string, t: unknown) => {
    const v = typeof t === "string" ? t.trim().replace(/^Bearer\s+/i, "") : "";
    if (v && !out.some((c) => c.token === v)) out.push({ source, token: v });
  };
  push("вставленный токен", bodyToken);
  const { data: tokens } = await admin.from("meta_tokens")
    .select("access_token, is_active, updated_at").eq("project_id", projectId)
    .order("is_active", { ascending: false }).order("updated_at", { ascending: false }).limit(5);
  for (const t of (tokens ?? []) as { access_token: string | null; is_active: boolean }[]) push(t.is_active ? "Meta-токен проекта" : "прошлый Meta-токен проекта", t.access_token);
  const { data: pending } = await admin.from("meta_oauth_pending_selections")
    .select("user_token").eq("project_id", projectId)
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
    .order("created_at", { ascending: false }).limit(3);
  for (const p of (pending ?? []) as { user_token: string | null }[]) push("OAuth-сессия Facebook", p.user_token);
  const { data: cabinets } = await admin.from("ad_cabinets")
    .select("access_token").eq("project_id", projectId).not("access_token", "is", null).limit(5);
  for (const c of (cabinets ?? []) as { access_token: string | null }[]) push("токен рекламного кабинета", c.access_token);
  push("общий токен automation_settings/env", await resolveMetaAccessToken({ admin, projectId: null, bodyToken: null }));
  return out;
}

/**
 * Страницы Facebook первым токеном, который принимает Graph; иначе — отказ
 * по каждому источнику (без самих токенов), чтобы по тексту ошибки было
 * видно, какой именно токен протух.
 */
async function metaPagesForProject(
  admin: SupabaseClient, projectId: string, bodyToken: string | null,
): Promise<{ token: string; pages: MetaPage[] } | { error: string; tried: number; failures: { source: string; error: string }[] }> {
  const candidates = await metaTokenCandidates(admin, projectId, bodyToken);
  if (!candidates.length) {
    return { error: "Meta-токен не найден. Подключите Facebook в Настройках → Meta или вставьте User Access Token.", tried: 0, failures: [] };
  }
  const failures: { source: string; error: string }[] = [];
  for (const c of candidates) {
    const { pages, error } = await metaPages(c.token);
    if (!error) return { token: c.token, pages };
    failures.push({ source: c.source, error });
  }
  const detail = failures.map((f) => `${f.source}: ${f.error}`).join("; ");
  return {
    error: `Meta отклонила все токены проекта (${detail}). Подключите Facebook заново (Настройки → Meta) или вставьте свежий User Access Token.`,
    tried: candidates.length,
    failures,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "list");
  const projectId = body?.project_id ? String(body.project_id) : null;

  // Проект, в границах которого работает действие: явный project_id либо проект
  // сущности из тела. Все id из тела (аккаунт, группа, видео, задание) обязаны
  // принадлежать ему — иначе, назвав свой проект и чужой account_id, можно было
  // править, отключать и удалять чужие аккаунты и группы.
  const projectOf = async (table: string, id: unknown): Promise<string | null> => {
    if (typeof id !== "string" || !id) return null;
    const { data } = await admin.from(table).select("project_id").eq("id", id).maybeSingle();
    return (data as { project_id?: string } | null)?.project_id ?? null;
  };
  let scopeProject = projectId;
  const owned: { table: string; key: string; label: string }[] = [
    { table: "publish_accounts", key: "account_id", label: "аккаунт" },
    { table: "publish_account_groups", key: "group_id", label: "группа" },
    { table: "publish_videos", key: "video_id", label: "видео" },
    { table: "publish_jobs", key: "job_id", label: "задание" },
    { table: "publish_campaigns", key: "campaign_id", label: "кампания" },
    { table: "publish_webhooks", key: "webhook_id", label: "вебхук" },
  ];
  for (const o of owned) {
    if (typeof body?.[o.key] !== "string" || !body[o.key]) continue;
    const owner = await projectOf(o.table, body[o.key]);
    if (!owner) return json({ error: `${o.label} не найден(а)` }, 404);
    if (!scopeProject) scopeProject = owner;
    else if (owner !== scopeProject) return json({ error: `${o.label} не из этого проекта` }, 404);
  }
  if (!scopeProject) return json({ error: "project_id обязателен" }, 400);
  const pid: string = scopeProject;

  // Скриптовый онбординг ходит с ключом автоматизации, интерфейс — под пользователем.
  const viaAutomation = await automationKeyValid(req, admin);
  let userId: string | null = null;
  if (!viaAutomation) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    userId = auth.userId;
    const access = await requireProjectAccess(auth.authHeader, pid);
    if (!access.ok) return access.response;
  }

  /** Группа/персона из тела должна быть из этого же проекта; null — снять. */
  const ownedRef = async (table: "publish_account_groups" | "personas", id: unknown): Promise<{ ok: true; value: string | null } | { ok: false }> => {
    if (id === null) return { ok: true, value: null };
    if (typeof id !== "string" || !id) return { ok: true, value: undefined as unknown as null };
    const owner = await projectOf(table, id);
    return owner === pid ? { ok: true, value: id } : { ok: false };
  };

  try {
    if (action === "list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const { data, error } = await admin.from("publish_accounts")
        .select(
          "id, platform, account_name, handle, external_account_id, fb_page_id, status, publish_enabled, daily_limit, last_post_at, consecutive_errors, last_error, token_expires_at, group_id, persona_id, timezone, window_start, window_end, ramp_enabled, ramp_started_at, health_score, health_reasons, last_checked_at, published_today, published_day, token_refreshed_at, followers, oauth_scope, capabilities, connection_type, auth_status",
        )
        .eq("project_id", projectId).order("platform").order("account_name");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, accounts: data ?? [] });
    }

    if (action === "available") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const found = await metaPagesForProject(admin, projectId, typeof body?.meta_token === "string" ? body.meta_token : null);
      if ("error" in found) return json({ error: found.error, tried: found.tried, failures: found.failures }, 400);
      const { pages } = found;

      // Уже подключённые помечаем, чтобы интерфейс не предлагал их снова.
      const { data: existing } = await admin.from("publish_accounts")
        .select("external_account_id").eq("project_id", projectId).eq("platform", "instagram");
      const connected = new Set(((existing ?? []) as { external_account_id: string }[]).map((r) => r.external_account_id));

      // Тот же Instagram в другом проекте — дневной лимит удвоится, площадка это
      // видит как один аккаунт. Не запрещаем, но говорим, где он уже подключён.
      const igIds = pages.map((p) => p.instagram_business_account?.id).filter((x): x is string => Boolean(x));
      const elsewhere = new Map<string, string>();
      if (igIds.length) {
        const { data: other } = await admin.from("publish_accounts")
          .select("external_account_id, projects(name)")
          .eq("platform", "instagram").neq("project_id", projectId).in("external_account_id", igIds);
        // Связь через FK клиент типизирует то объектом, то массивом — принимаем оба вида.
        type Rel = { name?: string } | { name?: string }[] | null;
        for (const r of (other ?? []) as unknown as { external_account_id: string; projects: Rel }[]) {
          const rel = Array.isArray(r.projects) ? r.projects[0] : r.projects;
          elsewhere.set(r.external_account_id, rel?.name ?? "другом проекте");
        }
      }

      return json({
        ok: true,
        pages: pages.map((p) => ({
          connected_elsewhere: elsewhere.get(p.instagram_business_account?.id ?? "") ?? null,
          page_id: p.id,
          page_name: p.name ?? null,
          ig_user_id: p.instagram_business_account?.id ?? null,
          ig_username: p.instagram_business_account?.username ?? null,
          ig_name: p.instagram_business_account?.name ?? null,
          ig_avatar_url: p.instagram_business_account?.profile_picture_url ?? null,
          ig_followers: p.instagram_business_account?.followers_count ?? null,
          // Страница без Business/Creator-аккаунта публиковать не может.
          connectable: Boolean(p.instagram_business_account?.id),
          already_connected: connected.has(p.instagram_business_account?.id ?? ""),
        })),
      });
    }

    if (action === "connect") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      if (!tokenKeyConfigured()) {
        return json({ error: "PUBLISH_TOKEN_KEY не задан в секретах Supabase — токены сохранять некуда" }, 500);
      }
      const pageIds = (Array.isArray(body?.page_ids) ? body.page_ids : []).map(String);
      if (!pageIds.length) return json({ error: "page_ids обязателен" }, 400);
      // Сразу в группу аккаунтов — чужую группу не примем.
      let groupId: string | null = null;
      if (typeof body?.group_id === "string" && body.group_id) {
        const { data: g } = await admin.from("publish_account_groups").select("id").eq("id", body.group_id).eq("project_id", projectId).maybeSingle();
        if (!g) return json({ error: "Группа не найдена в проекте" }, 400);
        groupId = body.group_id;
      }

      const found = await metaPagesForProject(admin, projectId, typeof body?.meta_token === "string" ? body.meta_token : null);
      if ("error" in found) return json({ error: found.error, tried: found.tried, failures: found.failures }, 400);
      const { pages } = found;

      const connected: unknown[] = [];
      const skipped: unknown[] = [];

      for (const pageId of pageIds) {
        const page = pages.find((p) => p.id === pageId);
        if (!page) { skipped.push({ page_id: pageId, reason: "страница вне охвата токена" }); continue; }
        const ig = page.instagram_business_account;
        if (!ig?.id) { skipped.push({ page_id: pageId, reason: "к странице не привязан Instagram Business/Creator" }); continue; }
        if (!page.access_token) { skipped.push({ page_id: pageId, reason: "Meta не отдала page-токен" }); continue; }

        const { data, error: upsertError } = await admin.from("publish_accounts").upsert({
          project_id: projectId,
          platform: "instagram",
          account_name: ig.name ?? ig.username ?? page.name ?? "Instagram",
          handle: ig.username ?? null,
          external_account_id: ig.id,
          fb_page_id: page.id,
          access_token_encrypted: await encryptSecret(page.access_token),
          status: "active",
          publish_enabled: true,
          consecutive_errors: 0,
          last_error: null,
          followers: ig.followers_count ?? null,
          auth_status: "connected",
          capabilities: resolveCapabilities({ platform: "instagram", tokenKind: tokenKindOf(page.access_token) }),
          ...(groupId ? { group_id: groupId } : {}),
        }, { onConflict: "project_id,platform,external_account_id" })
          .select("id, account_name, handle").maybeSingle();

        if (upsertError) skipped.push({ page_id: pageId, reason: upsertError.message });
        else connected.push(data);
      }

      return json({ ok: true, connected, skipped });
    }

    if (action === "update") {
      const accountId = String(body?.account_id ?? "");
      if (!accountId) return json({ error: "account_id обязателен" }, 400);

      const patch: Record<string, unknown> = {};
      if (typeof body?.publish_enabled === "boolean") patch.publish_enabled = body.publish_enabled;
      // 0 в claim_publish_jobs значит «не публиковать» — из интерфейса такого не задать, для этого есть выключатель.
      if (typeof body?.daily_limit === "number") patch.daily_limit = Math.min(Math.max(Math.round(body.daily_limit), 1), 200);
      if (typeof body?.account_name === "string" && body.account_name.trim()) patch.account_name = body.account_name.trim();
      if (typeof body?.notes === "string") patch.notes = body.notes;
      if (body?.group_id === null || typeof body?.group_id === "string") {
        const g = await ownedRef("publish_account_groups", body.group_id);
        if (!g.ok) return json({ error: "группа не из этого проекта" }, 400);
        patch.group_id = g.value;
      }
      if (body?.persona_id === null || typeof body?.persona_id === "string") {
        const p = await ownedRef("personas", body.persona_id);
        if (!p.ok) return json({ error: "персона не из этого проекта" }, 400);
        patch.persona_id = p.value;
      }
      if (body?.timezone === null || typeof body?.timezone === "string") patch.timezone = body.timezone?.trim() || null;
      if (body?.window_start === null || typeof body?.window_start === "string") patch.window_start = body.window_start || null;
      if (body?.window_end === null || typeof body?.window_end === "string") patch.window_end = body.window_end || null;
      if (typeof body?.ramp_enabled === "boolean") patch.ramp_enabled = body.ramp_enabled;
      if (body?.ramp_restart === true) patch.ramp_started_at = new Date().toISOString();
      if (typeof body?.status === "string") {
        const allowed = ["active", "token_expired", "limited", "error", "disabled"];
        if (!allowed.includes(body.status)) return json({ error: `недопустимый статус: ${body.status}` }, 400);
        patch.status = body.status;
        // Возврат в строй — обнуляем серию ошибок, иначе монитор погасит снова.
        if (body.status === "active") { patch.consecutive_errors = 0; patch.last_error = null; }
      }
      if (!Object.keys(patch).length) return json({ error: "нечего менять" }, 400);

      const { data, error } = await admin.from("publish_accounts")
        .update(patch).eq("id", accountId).eq("project_id", pid)
        .select("id, account_name, status, publish_enabled, daily_limit").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "аккаунт не найден" }, 404);
      return json({ ok: true, account: data });
    }

    /* ── группы аккаунтов ── */

    if (action === "group_list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const { data, error } = await admin.from("publish_account_groups")
        .select("*").eq("project_id", projectId).order("name");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, groups: data ?? [] });
    }

    if (action === "group_upsert") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) return json({ error: "name обязателен" }, 400);
      const accountIds = (Array.isArray(body?.account_ids) ? body.account_ids : []).map(String);

      // Группа не должна тянуть чужие аккаунты: сверяем принадлежность проекту.
      if (accountIds.length) {
        const { data: own } = await admin.from("publish_accounts")
          .select("id").eq("project_id", projectId).in("id", accountIds);
        const known = new Set(((own ?? []) as { id: string }[]).map((r) => r.id));
        const alien = accountIds.filter((id: string) => !known.has(id));
        if (alien.length) return json({ error: `аккаунты не из этого проекта: ${alien.join(", ")}` }, 400);
      }

      const row: Record<string, unknown> = {
        project_id: projectId,
        name,
        account_ids: accountIds,
        platform: isPlatformName(body?.platform) ? body.platform : null,
      };
      if (typeof body?.publish_strategy === "string") {
        const allowed = ["all_at_once", "drip", "daily"];
        if (!allowed.includes(body.publish_strategy)) {
          return json({ error: `недопустимая стратегия: ${body.publish_strategy}` }, 400);
        }
        row.publish_strategy = body.publish_strategy;
      }
      // null сбрасывает к значению по умолчанию (per_hour 10) — раньше пустое поле молча оставляло старое.
      if (typeof body?.per_hour === "number") row.per_hour = Math.min(Math.max(Math.round(body.per_hour), 1), 120);
      else if (body?.per_hour === null) row.per_hour = 10;
      if (body?.persona_id === null || typeof body?.persona_id === "string") {
        const p = await ownedRef("personas", body.persona_id);
        if (!p.ok) return json({ error: "персона не из этого проекта" }, 400);
        row.persona_id = p.value;
      }
      if (typeof body?.review_mode === "string") {
        if (!["review_required", "auto_publish", "paused"].includes(body.review_mode)) {
          return json({ error: `недопустимый режим согласования: ${body.review_mode}` }, 400);
        }
        row.review_mode = body.review_mode;
      }
      // Пустое значение — «стереть»: часовой пояс и окно возвращаются к умолчаниям колонки.
      if (typeof body?.timezone === "string") row.timezone = body.timezone.trim() || "Asia/Almaty";
      else if (body?.timezone === null) row.timezone = "Asia/Almaty";
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
      for (const k of ["window_start", "window_end"] as const) {
        if (typeof body?.[k] === "string" && body[k]) {
          if (!timeRe.test(body[k])) return json({ error: `${k}: время в формате ЧЧ:ММ` }, 400);
          row[k] = body[k];
        } else if (body?.[k] === null || body?.[k] === "") {
          row[k] = k === "window_start" ? "09:00" : "21:00";
        }
      }
      if (typeof body?.min_gap_minutes === "number") row.min_gap_minutes = Math.min(Math.max(Math.round(body.min_gap_minutes), 0), 1440);
      else if (body?.min_gap_minutes === null) row.min_gap_minutes = 120;
      if (typeof body?.jitter_minutes === "number") row.jitter_minutes = Math.min(Math.max(Math.round(body.jitter_minutes), 0), 180);
      else if (body?.jitter_minutes === null) row.jitter_minutes = 20;

      // Окно проверяем до записи: CHECK в базе отвечал бы сырым текстом Postgres и 500.
      type WindowRow = { window_start: string; window_end: string };
      let existing: WindowRow | null = null;
      if (typeof body?.id === "string") {
        const { data: ex } = await admin.from("publish_account_groups")
          .select("window_start, window_end").eq("id", body.id).eq("project_id", pid).maybeSingle();
        existing = (ex as WindowRow | null) ?? null;
        if (!existing) return json({ error: "группа не найдена в проекте" }, 404);
      }
      const ws = String(row.window_start ?? existing?.window_start ?? "09:00");
      const we = String(row.window_end ?? existing?.window_end ?? "21:00");
      if (ws >= we) return json({ error: "начало окна публикаций должно быть раньше конца (окно группы не переходит через полночь — задайте его аккаунтам)" }, 400);

      const saved = typeof body?.id === "string"
        ? await admin.from("publish_account_groups").update(row).eq("id", body.id).eq("project_id", pid).select("*").maybeSingle()
        : await admin.from("publish_account_groups").insert(row).select("*").maybeSingle();
      const { data, error } = saved;
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "группа не найдена в проекте" }, 404);
      const group = data as { id: string } | null;

      // Членство живёт в двух местах: publish_accounts.group_id (селект во
      // вкладке «Аккаунты») и group.account_ids (галочки в форме группы).
      // Планировщик и витрины берут объединение, поэтому форма группы —
      // источник истины: выставляем group_id отмеченным и снимаем с тех, кто
      // был в этой группе, но галочку потерял. Иначе карточка группы показывает
      // «0 акк.», хотя пять аккаунтов назначены в неё через таблицу.
      if (group?.id) {
        const { data: members } = await admin.from("publish_accounts")
          .select("id").eq("project_id", projectId).eq("group_id", group.id);
        const current = new Set(((members ?? []) as { id: string }[]).map((r) => r.id));
        const wanted = new Set(accountIds);
        const toSet = accountIds.filter((id: string) => !current.has(id));
        const toClear = [...current].filter((id) => !wanted.has(id));
        if (toSet.length) await admin.from("publish_accounts").update({ group_id: group.id }).in("id", toSet);
        if (toClear.length) await admin.from("publish_accounts").update({ group_id: null }).in("id", toClear);
      }
      return json({ ok: true, group: data });
    }

    if (action === "group_delete") {
      const groupId = String(body?.group_id ?? "");
      if (!groupId) return json({ error: "group_id обязателен" }, 400);
      const { error } = await admin.from("publish_account_groups").delete().eq("id", groupId).eq("project_id", pid);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    /* ── Threads: токен площадки вводится вручную (Threads OAuth — отдельное приложение Meta) ── */
    if (action === "connect_threads") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      if (!tokenKeyConfigured()) return json({ error: "PUBLISH_TOKEN_KEY не задан в секретах Supabase" }, 500);
      const userId = String(body?.threads_user_id ?? "").trim();
      const token = String(body?.access_token ?? "").trim();
      if (!/^\d{5,}$/.test(userId)) return json({ error: "threads_user_id — числовой id пользователя Threads" }, 400);
      if (token.length < 20) return json({ error: "access_token обязателен" }, 400);
      // Проверяем токен и подтягиваем username до сохранения.
      const threadsGroup = await ownedRef("publish_account_groups", body?.group_id ?? null);
      if (!threadsGroup.ok) return json({ error: "группа не из этого проекта" }, 400);
      const probe = await fetch(`https://graph.threads.net/v1.0/${userId}?fields=id,username,name&access_token=${encodeURIComponent(token)}`);
      const info = await probe.json().catch(() => ({}));
      if (info?.error || !info?.id) return json({ error: `токен Threads не принят: ${info?.error?.message ?? "нет id"}` }, 400);
      const { data, error } = await admin.from("publish_accounts").upsert({
        project_id: projectId,
        platform: "threads",
        account_name: String(body?.account_name ?? info.name ?? info.username ?? "Threads"),
        handle: info.username ?? null,
        external_account_id: String(info.id),
        access_token_encrypted: await encryptSecret(token),
        token_expires_at: body?.expires_at ? String(body.expires_at) : new Date(Date.now() + 60 * 86_400_000).toISOString(),
        status: "active",
        publish_enabled: true,
        consecutive_errors: 0,
        last_error: null,
        auth_status: "connected",
        capabilities: resolveCapabilities({ platform: "threads", tokenKind: "oauth" }),
        group_id: threadsGroup.value ?? null,
      }, { onConflict: "project_id,platform,external_account_id" })
        .select("id, account_name, handle").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, account: data });
    }

    /* ── персоны ── */
    if (action === "persona_list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const { data, error } = await admin.from("personas").select("*").eq("project_id", projectId).order("name");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, personas: data ?? [] });
    }
    if (action === "persona_upsert") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) return json({ error: "name обязателен" }, 400);
      const row: Record<string, unknown> = { project_id: projectId, name };
      for (const k of ["description", "niche", "tone_of_voice", "language", "heygen_avatar_id", "heygen_voice_id", "eleven_voice_id", "reels_theme", "caption_style"]) {
        if (body?.[k] === null || typeof body?.[k] === "string") row[k] = body[k];
      }
      if (Array.isArray(body?.forbidden_phrases)) row.forbidden_phrases = body.forbidden_phrases.map(String).filter(Boolean);
      if (typeof body?.engine_default === "string") {
        if (!["heygen", "reels_faceless", "montage"].includes(body.engine_default)) return json({ error: "недопустимый engine_default" }, 400);
        row.engine_default = body.engine_default;
      }
      const savedPersona = typeof body?.id === "string"
        ? await admin.from("personas").update(row).eq("id", body.id).eq("project_id", pid).select("*").maybeSingle()
        : await admin.from("personas").insert(row).select("*").maybeSingle();
      const { data, error } = savedPersona;
      if (error) {
        if (error.code === "23505") return json({ error: `персона «${name}» уже есть в проекте` }, 400);
        return json({ error: error.message }, 500);
      }
      if (!data) return json({ error: "персона не найдена в проекте" }, 404);
      return json({ ok: true, persona: data });
    }
    if (action === "persona_delete") {
      const id = String(body?.persona_id ?? "");
      if (!id) return json({ error: "persona_id обязателен" }, 400);
      const { error } = await admin.from("personas").delete().eq("id", id).eq("project_id", pid);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    /* ── настройки проекта: уведомления и бюджеты ── */
    if (action === "settings_get") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const [{ data: s }, { data: b }, { data: spend }] = await Promise.all([
        admin.from("publish_project_settings").select("*").eq("project_id", projectId).maybeSingle(),
        admin.from("project_budgets").select("*").eq("project_id", projectId).maybeSingle(),
        admin.rpc("project_spend", { p_project_id: projectId }),
      ]);
      const sp = (Array.isArray(spend) ? spend[0] : spend) as { spent_today_usd?: number; spent_month_usd?: number } | null;
      return json({
        ok: true,
        settings: s ?? { project_id: projectId, notify_mode: "digest", digest_chat_id: null, max_parallel_workers: 3, paused: false, features: {} },
        budget: b ?? { project_id: projectId, daily_usd: 20, monthly_usd: 300 },
        spend: { today_usd: Number(sp?.spent_today_usd ?? 0), month_usd: Number(sp?.spent_month_usd ?? 0) },
      });
    }
    if (action === "settings_upsert") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      if (typeof body?.notify_mode === "string" || typeof body?.digest_chat_id === "string" || body?.digest_chat_id === null || typeof body?.paused === "boolean" || (body?.features && typeof body.features === "object")) {
        const row: Record<string, unknown> = { project_id: projectId };
        if (typeof body?.notify_mode === "string") {
          if (!["digest", "each", "silent"].includes(body.notify_mode)) return json({ error: "недопустимый notify_mode" }, 400);
          row.notify_mode = body.notify_mode;
        }
        if (body?.digest_chat_id === null || typeof body?.digest_chat_id === "string") row.digest_chat_id = body.digest_chat_id;
        // Аварийная пауза: claim_publish_jobs и plan_publish_slots читают этот флаг напрямую.
        if (typeof body?.paused === "boolean") row.paused = body.paused;
        if (body?.features && typeof body.features === "object" && !Array.isArray(body.features)) {
          // Флаги — только булевы по известным ключам; остальное отбрасываем.
          const allowed = ["ai_autopublish_enabled", "winner_replication_enabled", "tiktok_direct_publish_enabled", "phonegrid_enabled"];
          const { data: cur } = await admin.from("publish_project_settings").select("features").eq("project_id", projectId).maybeSingle();
          const features: Record<string, boolean> = { ...(((cur as { features?: Record<string, boolean> } | null)?.features) ?? {}) };
          for (const k of allowed) if (typeof (body.features as Record<string, unknown>)[k] === "boolean") features[k] = (body.features as Record<string, boolean>)[k];
          row.features = features;
        }
        const { error } = await admin.from("publish_project_settings").upsert(row, { onConflict: "project_id" });
        if (error) return json({ error: error.message }, 500);
      }
      if (typeof body?.daily_usd === "number" || typeof body?.monthly_usd === "number" || body?.daily_usd === null || body?.monthly_usd === null) {
        const row: Record<string, unknown> = { project_id: projectId };
        // null — вернуть умолчание (20 / 300): пустое поле в форме иначе молча ничего не меняло.
        if (typeof body?.daily_usd === "number") row.daily_usd = Math.max(0, body.daily_usd);
        else if (body?.daily_usd === null) row.daily_usd = 20;
        if (typeof body?.monthly_usd === "number") row.monthly_usd = Math.max(0, body.monthly_usd);
        else if (body?.monthly_usd === null) row.monthly_usd = 300;
        const { error } = await admin.from("project_budgets").upsert(row, { onConflict: "project_id" });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true });
    }

    /* ── API-ключи проекта: список, выдача (ключ показывается один раз), отзыв ── */
    if (action === "api_key_list") {
      const { data, error } = await admin.from("api_keys")
        .select("id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at")
        .eq("project_id", pid).order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, keys: data ?? [] });
    }
    if (action === "api_key_create") {
      const name = String(body?.name ?? "").trim().slice(0, 80);
      if (!name) return json({ error: "name обязателен — как называется клиент (например, «Claude MCP»)" }, 400);
      const scopes = normalizeScopes(body?.scopes);
      const expiresDays = body?.expires_days == null ? null : Number(body.expires_days);
      if (expiresDays != null && (!Number.isFinite(expiresDays) || expiresDays <= 0)) {
        return json({ error: "expires_days — число дней больше нуля" }, 400);
      }
      const generated = generateApiKey();
      const { data, error } = await admin.from("api_keys").insert({
        project_id: pid,
        name,
        key_prefix: generated.prefix,
        key_hash: await hashApiKey(generated.key),
        scopes,
        created_by: userId,
        expires_at: expiresDays ? new Date(Date.now() + expiresDays * 86_400_000).toISOString() : null,
      }).select("id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, key: generated.key, api_key: data });
    }
    if (action === "api_key_revoke") {
      const keyId = String(body?.key_id ?? "");
      if (!keyId) return json({ error: "key_id обязателен" }, 400);
      const { data, error } = await admin.from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", keyId).eq("project_id", pid).is("revoked_at", null)
        .select("id").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "ключ не найден или уже отозван" }, 404);
      return json({ ok: true });
    }

    /* ── кампании: период × аккаунты × очередь контента × правило публикации ── */
    const CAMPAIGN_SELECT = "id, project_id, name, objective, status, start_date, end_date, timezone, group_id, account_ids, posts_per_day, slot_times, weekdays, mode, distribution, planned_until, completed_at, created_at, updated_at";
    if (action === "campaign_list") {
      const [{ data, error }, { data: metrics }] = await Promise.all([
        admin.from("publish_campaigns").select(CAMPAIGN_SELECT).eq("project_id", pid).neq("status", "archived").order("created_at", { ascending: false }),
        admin.from("publish_campaign_metrics").select("*").eq("project_id", pid),
      ]);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, campaigns: data ?? [], metrics: metrics ?? [] });
    }
    if (action === "campaign_get") {
      const campaignId = String(body?.campaign_id ?? "");
      if (!campaignId) return json({ error: "campaign_id обязателен" }, 400);
      const [{ data: campaign, error }, { data: metrics }, { data: items }, { data: jobs }] = await Promise.all([
        admin.from("publish_campaigns").select(CAMPAIGN_SELECT).eq("id", campaignId).eq("project_id", pid).maybeSingle(),
        admin.from("publish_campaign_metrics").select("*").eq("campaign_id", campaignId).maybeSingle(),
        admin.from("publish_campaign_items").select("id, video_id, position, status, planned_at, jobs_count, note, created_at, publish_videos(title, file_url, thumbnail_url)")
          .eq("campaign_id", campaignId).order("position").order("created_at"),
        admin.from("publish_jobs").select("id, video_id, account_id, platform, status, scheduled_at, published_at, external_post_url, error_class, verification_status, publish_accounts(account_name, handle)")
          .eq("campaign_id", campaignId).order("scheduled_at", { ascending: false }).limit(300),
      ]);
      if (error) return json({ error: error.message }, 500);
      if (!campaign) return json({ error: "кампания не найдена" }, 404);
      return json({ ok: true, campaign, metrics: metrics ?? null, items: items ?? [], jobs: jobs ?? [] });
    }
    if (action === "campaign_upsert") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const campaignId = typeof body?.campaign_id === "string" ? body.campaign_id : null;
      const row: Record<string, unknown> = {};
      if (body?.name !== undefined) {
        const name = String(body.name ?? "").trim().slice(0, 120);
        if (!name) return json({ error: "name обязателен" }, 400);
        row.name = name;
      }
      if (body?.objective !== undefined) row.objective = body.objective == null ? null : String(body.objective).slice(0, 1000);
      if (body?.start_date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date))) return json({ error: "start_date — дата YYYY-MM-DD" }, 400);
        row.start_date = body.start_date;
      }
      if (body?.end_date !== undefined) {
        if (body.end_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.end_date))) return json({ error: "end_date — дата YYYY-MM-DD или null" }, 400);
        row.end_date = body.end_date ?? null;
      }
      if (body?.timezone !== undefined) row.timezone = body.timezone ? String(body.timezone).slice(0, 64) : null;
      if (body?.group_id !== undefined) {
        const g = await ownedRef("publish_account_groups", body.group_id);
        if (!g.ok) return json({ error: "группа не из этого проекта" }, 400);
        row.group_id = g.value ?? null;
      }
      if (body?.account_ids !== undefined) {
        const ids = Array.isArray(body.account_ids) ? body.account_ids.map(String) : [];
        if (ids.length) {
          const { data: known } = await admin.from("publish_accounts").select("id").eq("project_id", pid).in("id", ids);
          if ((known ?? []).length !== ids.length) return json({ error: "часть аккаунтов не из этого проекта" }, 400);
        }
        row.account_ids = ids;
      }
      if (body?.posts_per_day !== undefined) {
        const n = Number(body.posts_per_day);
        if (!Number.isInteger(n) || n < 1 || n > 24) return json({ error: "posts_per_day — целое 1..24" }, 400);
        row.posts_per_day = n;
      }
      if (body?.slot_times !== undefined) {
        const times = Array.isArray(body.slot_times) ? body.slot_times.map(String) : [];
        if (times.some((t: string) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return json({ error: "slot_times — список времён HH:MM" }, 400);
        row.slot_times = times;
      }
      if (body?.weekdays !== undefined) {
        const days = Array.isArray(body.weekdays) ? body.weekdays.map(Number) : [];
        if (!days.length || days.some((d: number) => !Number.isInteger(d) || d < 1 || d > 7)) return json({ error: "weekdays — дни недели 1..7 (пн..вс)" }, 400);
        row.weekdays = [...new Set(days)].sort();
      }
      if (body?.mode !== undefined) {
        if (!["drip", "now"].includes(String(body.mode))) return json({ error: "mode — drip или now" }, 400);
        row.mode = body.mode;
      }
      if (body?.distribution !== undefined) {
        if (!["fanout", "spread"].includes(String(body.distribution))) return json({ error: "distribution — fanout или spread" }, 400);
        row.distribution = body.distribution;
      }
      if (!campaignId && !row.name) return json({ error: "name обязателен" }, 400);
      const q = campaignId
        ? admin.from("publish_campaigns").update(row).eq("id", campaignId).eq("project_id", pid).select(CAMPAIGN_SELECT).maybeSingle()
        : admin.from("publish_campaigns").insert({ ...row, project_id: pid, created_by: userId }).select(CAMPAIGN_SELECT).maybeSingle();
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "кампания не найдена" }, 404);
      return json({ ok: true, campaign: data });
    }
    if (action === "campaign_items_add" || action === "campaign_items_remove") {
      const campaignId = String(body?.campaign_id ?? "");
      if (!campaignId) return json({ error: "campaign_id обязателен" }, 400);
      const videoIds: string[] = Array.isArray(body?.video_ids) ? body.video_ids.map(String).filter(Boolean) : [];
      if (!videoIds.length) return json({ error: "video_ids — список id видео" }, 400);
      const { data: known } = await admin.from("publish_videos").select("id").eq("project_id", pid).in("id", videoIds);
      if ((known ?? []).length !== videoIds.length) return json({ error: "часть видео не из этого проекта" }, 400);
      if (action === "campaign_items_remove") {
        // Снимаем только то, что ещё не запланировано: задания уже созданных слотов не трогаем.
        const { error, count } = await admin.from("publish_campaign_items").delete({ count: "exact" })
          .eq("campaign_id", campaignId).eq("status", "queued").in("video_id", videoIds);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, removed: count ?? 0 });
      }
      const { data: maxRow } = await admin.from("publish_campaign_items").select("position").eq("campaign_id", campaignId).order("position", { ascending: false }).limit(1).maybeSingle();
      let pos = ((maxRow as { position?: number } | null)?.position ?? 0) + 1;
      const rows = videoIds.map((video_id) => ({ campaign_id: campaignId, project_id: pid, video_id, position: pos++ }));
      const { data, error } = await admin.from("publish_campaign_items").upsert(rows, { onConflict: "campaign_id,video_id", ignoreDuplicates: true }).select("id");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, added: (data ?? []).length, skipped: videoIds.length - (data ?? []).length });
    }
    if (action === "campaign_status") {
      const campaignId = String(body?.campaign_id ?? "");
      const status = String(body?.status ?? "");
      if (!campaignId) return json({ error: "campaign_id обязателен" }, 400);
      if (!["active", "paused", "completed", "archived", "draft"].includes(status)) return json({ error: "status — active | paused | completed | archived | draft" }, 400);
      const { data: cur } = await admin.from("publish_campaigns").select("status").eq("id", campaignId).eq("project_id", pid).maybeSingle();
      if (!cur) return json({ error: "кампания не найдена" }, 404);
      const from = (cur as { status: string }).status;
      const allowed: Record<string, string[]> = {
        draft: ["active", "archived"], active: ["paused", "completed", "archived"], paused: ["active", "completed", "archived"],
        completed: ["archived", "active"], archived: ["draft"],
      };
      if (!(allowed[from] ?? []).includes(status)) return json({ error: `переход ${from} → ${status} невозможен` }, 400);
      const patch: Record<string, unknown> = { status };
      if (status === "completed") patch.completed_at = new Date().toISOString();
      if (status === "active" && from === "completed") patch.completed_at = null;
      const { data, error } = await admin.from("publish_campaigns").update(patch).eq("id", campaignId).select(CAMPAIGN_SELECT).maybeSingle();
      if (error) return json({ error: error.message }, 500);
      // Запуск — сразу планируем сегодня и завтра, не дожидаясь часового крона.
      let planned: unknown = null;
      if (status === "active") {
        const { data: p } = await admin.rpc("plan_publish_campaigns", { p_days_ahead: 1 });
        planned = ((p ?? []) as { campaign_id: string }[]).find((r) => r.campaign_id === campaignId) ?? null;
      }
      return json({ ok: true, campaign: data, planned });
    }
    if (action === "campaign_plan_now") {
      const campaignId = String(body?.campaign_id ?? "");
      if (!campaignId) return json({ error: "campaign_id обязателен" }, 400);
      const { data, error } = await admin.rpc("plan_publish_campaigns", { p_days_ahead: Math.min(Math.max(Number(body?.days_ahead ?? 1), 0), 7) });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, result: ((data ?? []) as { campaign_id: string }[]).find((r) => r.campaign_id === campaignId) ?? { campaign_id: campaignId, planned: 0, jobs_created: 0, completed: false } });
    }

    /* ── исходящие вебхуки ── */
    const WEBHOOK_SELECT = "id, project_id, name, url, events, enabled, created_at, last_delivery_at, last_status";
    if (action === "webhook_list") {
      const { data, error } = await admin.from("publish_webhooks").select(WEBHOOK_SELECT).eq("project_id", pid).order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, webhooks: data ?? [] });
    }
    if (action === "webhook_upsert") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const webhookId = typeof body?.webhook_id === "string" ? body.webhook_id : null;
      const row: Record<string, unknown> = {};
      if (body?.name !== undefined) {
        const name = String(body.name ?? "").trim().slice(0, 80);
        if (!name) return json({ error: "name обязателен" }, 400);
        row.name = name;
      }
      if (body?.url !== undefined) {
        const url = String(body.url ?? "").trim();
        if (!/^https:\/\/\S+$/i.test(url)) return json({ error: "url — https-адрес" }, 400);
        row.url = url;
      }
      if (body?.events !== undefined) {
        const events = Array.isArray(body.events) ? body.events.map(String) : [];
        if (!events.length || !events.every(isWebhookEvent)) return json({ error: "events — список событий (docs/JOBS.md) или [\"*\"]" }, 400);
        row.events = events;
      }
      if (typeof body?.enabled === "boolean") row.enabled = body.enabled;
      let secret: string | null = null;
      if (!webhookId || body?.rotate_secret === true) {
        if (!tokenKeyConfigured()) return json({ error: "PUBLISH_TOKEN_KEY не задан — секрет вебхука сохранить некуда" }, 500);
        secret = generateWebhookSecret();
        row.secret_encrypted = await encryptSecret(secret);
      }
      if (!webhookId && (!row.name || !row.url)) return json({ error: "name и url обязательны" }, 400);
      const q = webhookId
        ? admin.from("publish_webhooks").update(row).eq("id", webhookId).eq("project_id", pid).select(WEBHOOK_SELECT).maybeSingle()
        : admin.from("publish_webhooks").insert({ ...row, project_id: pid, created_by: userId, events: row.events ?? ["*"] }).select(WEBHOOK_SELECT).maybeSingle();
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "вебхук не найден" }, 404);
      // Секрет отдаётся один раз — дальше в базе только шифротекст.
      return json({ ok: true, webhook: data, ...(secret ? { secret } : {}) });
    }
    if (action === "webhook_delete") {
      const webhookId = String(body?.webhook_id ?? "");
      if (!webhookId) return json({ error: "webhook_id обязателен" }, 400);
      const { error } = await admin.from("publish_webhooks").delete().eq("id", webhookId).eq("project_id", pid);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === "webhook_deliveries") {
      const webhookId = String(body?.webhook_id ?? "");
      if (!webhookId) return json({ error: "webhook_id обязателен" }, 400);
      const { data, error } = await admin.from("publish_webhook_deliveries")
        .select("id, event, status, attempts, next_attempt_at, response_status, last_error, delivered_at, created_at")
        .eq("webhook_id", webhookId).order("created_at", { ascending: false }).limit(Math.min(Math.max(Number(body?.limit ?? 50), 1), 200));
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, deliveries: data ?? [] });
    }

    /* ── трасса одного задания: шаги воркера и сырые ответы площадки ── */
    if (action === "job_get") {
      const jobId = String(body?.job_id ?? "");
      if (!jobId) return json({ error: "job_id обязателен" }, 400);
      const [{ data: job, error }, { data: events }, { data: logs }] = await Promise.all([
        admin.from("publish_jobs")
          .select("id, project_id, video_id, account_id, platform, status, scheduled_at, attempts, poll_count, next_attempt_at, locked_at, container_id, external_post_id, external_post_url, error_code, error_class, error_message, published_at, verification_status, verified_at, verify_attempts, trace_id, metrics_unavailable_reason, created_at, updated_at, publish_accounts(account_name, handle, platform), publish_videos(title, file_url)")
          .eq("id", jobId).eq("project_id", pid).maybeSingle(),
        admin.from("publish_job_events").select("id, step, level, message, data, created_at").eq("job_id", jobId).order("created_at").limit(200),
        admin.from("publish_logs").select("id, level, message, created_at").eq("job_id", jobId).order("created_at").limit(100),
      ]);
      if (error) return json({ error: error.message }, 500);
      if (!job) return json({ error: "задание не найдено" }, 404);
      const { data: metrics } = await admin.from("post_metrics")
        .select("checkpoint, captured_at, views, reach, likes, comments, shares, saves, followers").eq("job_id", jobId).order("captured_at");
      return json({ ok: true, job, events: events ?? [], logs: logs ?? [], metrics: metrics ?? [] });
    }

    /* ── центр уведомлений ── */
    if (action === "notifications_list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      let q = admin.from("publish_notifications")
        .select("id, kind, severity, title, body, entity_type, entity_id, read_at, created_at")
        .eq("project_id", projectId).order("created_at", { ascending: false })
        .limit(Math.min(Math.max(Number(body?.limit ?? 50), 1), 200));
      if (body?.unread_only) q = q.is("read_at", null);
      const [{ data, error }, { count }] = await Promise.all([
        q,
        admin.from("publish_notifications").select("id", { count: "exact", head: true }).eq("project_id", projectId).is("read_at", null),
      ]);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, notifications: data ?? [], unread: count ?? 0 });
    }
    if (action === "notification_read") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const now = new Date().toISOString();
      let q = admin.from("publish_notifications").update({ read_at: now }).eq("project_id", projectId).is("read_at", null);
      if (body?.all !== true) {
        const id = String(body?.notification_id ?? "");
        if (!id) return json({ error: "notification_id или all: true" }, 400);
        q = q.eq("id", id);
      }
      const { error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    /* ── задания и метрики для интерфейса ── */
    if (action === "jobs_list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      let q = admin.from("publish_jobs")
        .select("id, video_id, account_id, platform, status, scheduled_at, attempts, next_attempt_at, locked_at, external_post_id, external_post_url, error_code, error_class, error_message, published_at, verification_status, verified_at, verify_attempts, trace_id, metrics_unavailable_reason, created_at, publish_accounts(account_name, handle), publish_videos(title, file_url)")
        .eq("project_id", projectId)
        // DESC в Postgres по умолчанию NULLS FIRST — задания без времени всплывали бы наверх.
        .order("scheduled_at", { ascending: false, nullsFirst: false })
        .limit(Math.min(Math.max(Number(body?.limit ?? 100), 1), 500));
      if (typeof body?.status === "string") q = q.eq("status", body.status);
      if (typeof body?.video_id === "string") q = q.eq("video_id", body.video_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, jobs: data ?? [] });
    }
    if (action === "metrics") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const results = await Promise.all([
        admin.from("publish_metrics").select("*").eq("project_id", projectId).maybeSingle(),
        admin.from("radar_metrics").select("*").eq("project_id", projectId).maybeSingle(),
        admin.from("publish_videos").select("id, title, status, file_url, created_at, source").eq("project_id", projectId).order("created_at", { ascending: false }).limit(50),
        admin.from("publish_group_metrics").select("*").eq("project_id", projectId).order("name"),
        // Витрина по каждому аккаунту — вид «Статистика» во вкладке «Аккаунты».
        admin.from("publish_account_metrics").select("*").eq("project_id", projectId).order("account_name"),
      ]);
      const [{ data: pm }, { data: rm }, { data: videos }, { data: gm }, { data: am }] = results;
      // Ошибка витрины (нет миграции, нет гранта) не должна выглядеть как пустой проект.
      const errors = results.map((r, i) => (r.error ? `${["publish_metrics", "radar_metrics", "publish_videos", "publish_group_metrics", "publish_account_metrics"][i]}: ${r.error.message}` : null)).filter(Boolean);
      if (errors.length) return json({ error: errors.join("; ") }, 500);
      return json({ ok: true, publish: pm ?? null, radar: rm ?? null, videos: videos ?? [], groups: gm ?? [], accounts: am ?? [] });
    }

    /* ── «Залить видео в группу»: библиотека + планировщик слотов ── */
    if (action === "publish_video") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      // video_id из тела уже проверен на принадлежность проекту при входе (owned).
      let videoId = typeof body?.video_id === "string" ? body.video_id : null;
      if (!videoId) {
        const fileUrl = String(body?.file_url ?? "").trim();
        if (!/^https:\/\/.+\.(mp4|mov|m4v)(\?|$)/i.test(fileUrl)) return json({ error: "file_url — https-ссылка на .mp4, .mov или .m4v" }, 400);
        const { data, error } = await admin.from("publish_videos").insert({
          project_id: projectId,
          file_url: fileUrl,
          title: body?.title ? String(body.title) : null,
          base_caption: body?.caption ? String(body.caption) : null,
          caption_variants: Array.isArray(body?.caption_variants) ? body.caption_variants.map(String) : [],
          hashtags: Array.isArray(body?.hashtags) ? body.hashtags.map(String) : [],
          source: "manual",
        }).select("id").maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: "видео не сохранилось" }, 500);
        videoId = (data as { id: string }).id;
      }
      const mode = ["now", "drip", "daily"].includes(String(body?.mode)) ? String(body.mode) : "drip";
      const accountIds = Array.isArray(body?.account_ids) && body.account_ids.length ? body.account_ids.map(String) : null;
      // Старт в прошлом бессмысленен: планировщик считал бы слоты от вчерашнего дня.
      const startAt = body?.start_at && !Number.isNaN(Date.parse(String(body.start_at)))
        ? new Date(Math.max(Date.parse(String(body.start_at)), Date.now())).toISOString()
        : new Date().toISOString();
      const { data: planned, error: planErr } = await admin.rpc("plan_publish_slots", {
        p_video_id: videoId,
        p_group_id: typeof body?.group_id === "string" ? body.group_id : null,
        p_account_ids: accountIds,
        p_start: startAt,
        p_mode: mode,
      });
      if (planErr) return json({ error: planErr.message }, 500);
      const rows = (planned ?? []) as { job_id: string; account_id: string; scheduled_at: string; created: boolean }[];
      // Почему заданий меньше, чем выбрано: пауза проекта / группы — иначе «создано 0» без объяснения.
      let reason: string | null = null;
      if (!rows.length) {
        const { data: st } = await admin.from("publish_project_settings").select("paused").eq("project_id", projectId).maybeSingle();
        if ((st as { paused?: boolean } | null)?.paused) reason = "публикации проекта на паузе (Настройки)";
        else if (typeof body?.group_id === "string") {
          const { data: g } = await admin.from("publish_account_groups").select("review_mode").eq("id", body.group_id).maybeSingle();
          if ((g as { review_mode?: string } | null)?.review_mode === "paused") reason = "группа на паузе";
        }
        if (!reason) reason = "ни один из выбранных аккаунтов не годен: выключен, не активен, здоровье ниже 20, группа на паузе или площадка не совпадает с группой";
      }
      return json({ ok: true, video_id: videoId, created: rows.filter((r) => r.created).length, skipped: rows.filter((r) => !r.created).length, jobs: rows, reason });
    }

    /* ── задания: повтор и отмена из интерфейса ── */
    if (action === "job_retry" || action === "job_cancel") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const jobId = String(body?.job_id ?? "");
      if (!jobId) return json({ error: "job_id обязателен" }, 400);
      const { data: job } = await admin.from("publish_jobs")
        .select("id, status, account_id, locked_at").eq("id", jobId).eq("project_id", projectId).maybeSingle();
      if (!job) return json({ error: "задание не найдено" }, 404);
      const j = job as { id: string; status: string; account_id: string; locked_at: string | null };
      // processing без живой аренды — воркер умер; claim освободит его через 10 минут,
      // а оператору нечего было нажать. Считаем такое зависшим и даём повтор/отмену.
      const stale = j.status === "processing" && (!j.locked_at || Date.now() - Date.parse(j.locked_at) > 10 * 60_000);

      if (action === "job_retry") {
        // Повторить можно то, что остановилось: отказ, отмена, ручной разбор, зависший retry/processing.
        if (!["failed", "cancelled", "manual_review", "retry"].includes(j.status) && !stale) {
          return json({ error: `задание в статусе «${j.status}» повторять нечего` }, 400);
        }
        const now = new Date().toISOString();
        const { error } = await admin.from("publish_jobs").update({
          status: "pending",
          // Новый заход с чистого листа: счётчик попыток и контейнер площадки
          // (мёртвый контейнер повторно опрашивать бессмысленно), слот — сейчас,
          // иначе claim ждал бы старого scheduled_at.
          attempts: 0,
          container_id: null,
          scheduled_at: now,
          next_attempt_at: now,
          locked_at: null,
          error_code: null,
          error_message: null,
        }).eq("id", j.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, job_id: j.id, status: "pending" });
      }

      // Отмена — только того, что ещё не ушло на площадку (или зависло в processing).
      if (!["pending", "retry", "manual_review"].includes(j.status) && !stale) {
        return json({ error: `задание в статусе «${j.status}» уже не отменить` }, 400);
      }
      const { error } = await admin.from("publish_jobs").update({ status: "cancelled", locked_at: null }).eq("id", j.id);
      if (error) return json({ error: error.message }, 500);
      // Слот освобождаем, иначе планировщик считает окно занятым.
      await admin.from("publish_slots").delete().eq("job_id", j.id);
      return json({ ok: true, job_id: j.id, status: "cancelled" });
    }

    if (action === "disconnect") {
      const accountId = String(body?.account_id ?? "");
      if (!accountId) return json({ error: "account_id обязателен" }, 400);
      const { error } = await admin.from("publish_accounts").delete().eq("id", accountId).eq("project_id", pid);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: `неизвестное действие: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
