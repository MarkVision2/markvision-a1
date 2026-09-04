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
 *   { action: "publish_video", project_id, file_url | video_id, group_id?, account_ids?, mode?, title?, caption?, hashtags? }
 *   { action: "metrics", project_id } → { publish, radar, videos, groups, accounts } — accounts из publish_account_metrics
 *   { action: "metrics", project_id } — витрины publish_metrics / radar_metrics
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireProjectAccess, requireUser } from "../_lib/auth.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
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

  // Скриптовый онбординг ходит с ключом автоматизации, интерфейс — под пользователем.
  const viaAutomation = await automationKeyValid(req, admin);
  if (!viaAutomation) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);

    // Действия по аккаунту проверяем через проект, которому он принадлежит.
    let scopeProject = projectId;
    if (!scopeProject && body?.group_id) {
      const { data } = await admin
        .from("publish_account_groups").select("project_id").eq("id", String(body.group_id)).maybeSingle();
      scopeProject = (data as { project_id?: string } | null)?.project_id ?? null;
    }
    if (!scopeProject && body?.account_id) {
      const { data } = await admin
        .from("publish_accounts").select("project_id").eq("id", String(body.account_id)).maybeSingle();
      scopeProject = (data as { project_id?: string } | null)?.project_id ?? null;
    }
    if (!scopeProject) return json({ error: "project_id обязателен" }, 400);
    const access = await requireProjectAccess(auth.authHeader, scopeProject);
    if (!access.ok) return access.response;
  }

  try {
    if (action === "list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const { data, error } = await admin.from("publish_accounts")
        .select(
          "id, platform, account_name, handle, external_account_id, fb_page_id, status, publish_enabled, daily_limit, last_post_at, consecutive_errors, last_error, token_expires_at, group_id, persona_id, timezone, window_start, window_end, ramp_enabled, ramp_started_at, health_score, published_today, published_day, token_refreshed_at, followers, oauth_scope",
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

      return json({
        ok: true,
        pages: pages.map((p) => ({
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
      if (typeof body?.daily_limit === "number") patch.daily_limit = Math.min(Math.max(body.daily_limit, 0), 200);
      if (typeof body?.account_name === "string") patch.account_name = body.account_name;
      if (typeof body?.notes === "string") patch.notes = body.notes;
      if (body?.group_id === null || typeof body?.group_id === "string") patch.group_id = body.group_id;
      if (body?.persona_id === null || typeof body?.persona_id === "string") patch.persona_id = body.persona_id;
      if (body?.timezone === null || typeof body?.timezone === "string") patch.timezone = body.timezone;
      if (body?.window_start === null || typeof body?.window_start === "string") patch.window_start = body.window_start;
      if (body?.window_end === null || typeof body?.window_end === "string") patch.window_end = body.window_end;
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
        .update(patch).eq("id", accountId)
        .select("id, account_name, status, publish_enabled, daily_limit").maybeSingle();
      if (error) return json({ error: error.message }, 500);
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
      if (typeof body?.per_hour === "number") row.per_hour = Math.min(Math.max(body.per_hour, 1), 120);
      if (body?.persona_id === null || typeof body?.persona_id === "string") row.persona_id = body.persona_id;
      if (typeof body?.review_mode === "string") {
        if (!["review_required", "auto_publish", "paused"].includes(body.review_mode)) {
          return json({ error: `недопустимый режим согласования: ${body.review_mode}` }, 400);
        }
        row.review_mode = body.review_mode;
      }
      if (typeof body?.timezone === "string") row.timezone = body.timezone;
      if (typeof body?.window_start === "string") row.window_start = body.window_start;
      if (typeof body?.window_end === "string") row.window_end = body.window_end;
      if (typeof body?.min_gap_minutes === "number") row.min_gap_minutes = Math.min(Math.max(body.min_gap_minutes, 0), 1440);
      if (typeof body?.jitter_minutes === "number") row.jitter_minutes = Math.min(Math.max(body.jitter_minutes, 0), 180);
      if (typeof body?.id === "string") row.id = body.id;

      const { data, error } = await admin.from("publish_account_groups")
        .upsert(row).select("*").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, group: data });
    }

    if (action === "group_delete") {
      const groupId = String(body?.group_id ?? "");
      if (!groupId) return json({ error: "group_id обязателен" }, 400);
      const { error } = await admin.from("publish_account_groups").delete().eq("id", groupId);
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
      const probe = await fetch(`https://graph.threads.net/v1.0/${userId}?fields=id,username,name&access_token=${token}`);
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
        group_id: typeof body?.group_id === "string" ? body.group_id : null,
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
      if (typeof body?.id === "string") row.id = body.id;
      const { data, error } = await admin.from("personas").upsert(row, { onConflict: "id" }).select("*").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, persona: data });
    }
    if (action === "persona_delete") {
      const id = String(body?.persona_id ?? "");
      if (!id) return json({ error: "persona_id обязателен" }, 400);
      const { error } = await admin.from("personas").delete().eq("id", id).eq("project_id", projectId ?? "");
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
        settings: s ?? { project_id: projectId, notify_mode: "digest", digest_chat_id: null, max_parallel_workers: 3, paused: false },
        budget: b ?? { project_id: projectId, daily_usd: 20, monthly_usd: 300 },
        spend: { today_usd: Number(sp?.spent_today_usd ?? 0), month_usd: Number(sp?.spent_month_usd ?? 0) },
      });
    }
    if (action === "settings_upsert") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      if (typeof body?.notify_mode === "string" || typeof body?.digest_chat_id === "string" || body?.digest_chat_id === null || typeof body?.paused === "boolean") {
        const row: Record<string, unknown> = { project_id: projectId };
        if (typeof body?.notify_mode === "string") {
          if (!["digest", "each", "silent"].includes(body.notify_mode)) return json({ error: "недопустимый notify_mode" }, 400);
          row.notify_mode = body.notify_mode;
        }
        if (body?.digest_chat_id === null || typeof body?.digest_chat_id === "string") row.digest_chat_id = body.digest_chat_id;
        // Аварийная пауза: claim_publish_jobs и plan_publish_slots читают этот флаг напрямую.
        if (typeof body?.paused === "boolean") row.paused = body.paused;
        const { error } = await admin.from("publish_project_settings").upsert(row, { onConflict: "project_id" });
        if (error) return json({ error: error.message }, 500);
      }
      if (typeof body?.daily_usd === "number" || typeof body?.monthly_usd === "number") {
        const row: Record<string, unknown> = { project_id: projectId };
        if (typeof body?.daily_usd === "number") row.daily_usd = Math.max(0, body.daily_usd);
        if (typeof body?.monthly_usd === "number") row.monthly_usd = Math.max(0, body.monthly_usd);
        const { error } = await admin.from("project_budgets").upsert(row, { onConflict: "project_id" });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true });
    }

    /* ── задания и метрики для интерфейса ── */
    if (action === "jobs_list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      let q = admin.from("publish_jobs")
        .select("id, video_id, account_id, platform, status, scheduled_at, attempts, next_attempt_at, external_post_url, error_code, error_message, published_at, created_at, publish_accounts(account_name, handle), publish_videos(title, file_url)")
        .eq("project_id", projectId)
        .order("scheduled_at", { ascending: false })
        .limit(Math.min(Math.max(Number(body?.limit ?? 100), 1), 500));
      if (typeof body?.status === "string") q = q.eq("status", body.status);
      if (typeof body?.video_id === "string") q = q.eq("video_id", body.video_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, jobs: data ?? [] });
    }
    if (action === "metrics") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const [{ data: pm }, { data: rm }, { data: videos }, { data: gm }, { data: am }] = await Promise.all([
        admin.from("publish_metrics").select("*").eq("project_id", projectId).maybeSingle(),
        admin.from("radar_metrics").select("*").eq("project_id", projectId).maybeSingle(),
        admin.from("publish_videos").select("id, title, status, file_url, created_at, source").eq("project_id", projectId).order("created_at", { ascending: false }).limit(50),
        admin.from("publish_group_metrics").select("*").eq("project_id", projectId).order("name"),
        // Витрина по каждому аккаунту для вкладки «Подключённые».
        admin.from("publish_account_metrics").select("*").eq("project_id", projectId).order("account_name"),
      ]);
      return json({ ok: true, publish: pm ?? null, radar: rm ?? null, videos: videos ?? [], groups: gm ?? [], accounts: am ?? [] });
    }

    /* ── «Залить видео в группу»: библиотека + планировщик слотов ── */
    if (action === "publish_video") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      let videoId = typeof body?.video_id === "string" ? body.video_id : null;
      if (!videoId) {
        const fileUrl = String(body?.file_url ?? "").trim();
        if (!/^https:\/\/.+\.(mp4|mov|m4v)(\?|$)/i.test(fileUrl)) return json({ error: "file_url — https-ссылка на .mp4/.mov" }, 400);
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
        videoId = (data as { id: string }).id;
      }
      const mode = ["now", "drip", "daily"].includes(String(body?.mode)) ? String(body.mode) : "drip";
      const accountIds = Array.isArray(body?.account_ids) && body.account_ids.length ? body.account_ids.map(String) : null;
      const { data: planned, error: planErr } = await admin.rpc("plan_publish_slots", {
        p_video_id: videoId,
        p_group_id: typeof body?.group_id === "string" ? body.group_id : null,
        p_account_ids: accountIds,
        p_start: body?.start_at ? String(body.start_at) : new Date().toISOString(),
        p_mode: mode,
      });
      if (planErr) return json({ error: planErr.message }, 500);
      const rows = (planned ?? []) as { job_id: string; account_id: string; scheduled_at: string; created: boolean }[];
      return json({ ok: true, video_id: videoId, created: rows.filter((r) => r.created).length, skipped: rows.filter((r) => !r.created).length, jobs: rows });
    }

    if (action === "disconnect") {
      const accountId = String(body?.account_id ?? "");
      if (!accountId) return json({ error: "account_id обязателен" }, 400);
      const { error } = await admin.from("publish_accounts").delete().eq("id", accountId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: `неизвестное действие: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
