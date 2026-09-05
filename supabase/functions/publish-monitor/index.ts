/**
 * Сторож контура публикаций: токены и аварийные аккаунты.
 *
 *   { mode: "tokens" } — крон раз в сутки. Проверяет живость токена каждого
 *     активного аккаунта, помечает мёртвые token_expired и присылает в
 *     Telegram список тех, кого надо переподключить.
 *   { mode: "errors" } — крон каждые 15 минут. Аккаунт с серией отказов
 *     гасится (status=error, publish_enabled=false), чтобы очередь не долбила
 *     площадку и не копила бан.
 *   { mode: "digest" } — крон раз в час. Один отчёт на проект вместо сообщения
 *     на каждый сбой: сколько опубликовано, сколько упало и почему, какие
 *     аккаунты требуют внимания.
 *   { mode: "health", project_id?, account_ids? } — крон раз в 6 часов и кнопка
 *     «Проверить» в интерфейсе (JWT с доступом к проекту). Живая проверка
 *     токена у площадки + пересчёт health_score формулой _lib/publishHealth.ts
 *     с причинами в health_reasons. Без project_id — вся сеть (только ops-ключ).
 *
 * В режиме tokens заодно обновляются long-lived токены Instagram Login (IG…)
 * и Threads за 10 дней до истечения — refresh_access_token соответствующего
 * графа. Page-токены Facebook не истекают, их не трогаем.
 *
 * Пороги здесь, а не в SQL: их меняют по опыту эксплуатации.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import {
  automationKeyValid,
  CORS_HEADERS,
  decryptSecret,
  encryptSecret,
  json,
  notifyProject,
  type PublishAccount,
} from "../_lib/publishing.ts";
import { ensureFreshToken } from "../_lib/publishRunner.ts";
import { identityRequest, isOAuthPlatform, parseIdentity, tokenNeedsRefresh } from "../_lib/publishOAuth.ts";
import { resolveCapabilities, tokenKindOf } from "../_lib/publishCapabilities.ts";
import { notifyCenter } from "../_lib/publishTrace.ts";
import { requireProjectAccess } from "../_lib/auth.ts";
import { computeHealth } from "../_lib/publishHealth.ts";

/** Сколько отказов подряд считаем поломкой аккаунта, а не невезением. */
const ERROR_STREAK_LIMIT = 3;
/** За сколько дней до истечения токена начинаем предупреждать. */
const TOKEN_WARN_DAYS = 7;
/** Сколько работаем за вызов: сеть на 100+ аккаунтов не влезает в лимит функции, остаток доберёт следующий тик. */
const WALL_CLOCK_BUDGET_MS = 45_000;

const GRAPH_IG = "https://graph.instagram.com/v21.0";
const GRAPH_FB = "https://graph.facebook.com/v21.0";
const GRAPH_THREADS = "https://graph.threads.net/v1.0";
/** За сколько дней до истечения обновляем long-lived токен. */
const TOKEN_REFRESH_DAYS = 10;

/**
 * Обновление long-lived токена. Instagram Login: graph.instagram.com/refresh_access_token
 * (ig_refresh_token), Threads: graph.threads.net/refresh_access_token (th_refresh_token).
 * Оба возвращают новый токен и expires_in (секунды). Page-токены Facebook — null.
 */
async function refreshLongLivedToken(
  platform: string,
  token: string,
): Promise<{ token: string; expiresAt: string } | { error: string } | null> {
  let url: string | null = null;
  if (platform === "threads") url = `${GRAPH_THREADS}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`;
  else if (platform === "instagram" && /^IG/i.test(token)) url = `${GRAPH_IG}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  if (!url) return null;
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (body?.error || !body?.access_token) return { error: String(body?.error?.message ?? "refresh failed") };
    const expiresIn = Number(body.expires_in ?? 60 * 86400);
    return { token: String(body.access_token), expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function threadsTokenAlive(userId: string, token: string): Promise<{ alive: boolean; reason?: string }> {
  try {
    const res = await fetch(`${GRAPH_THREADS}/${userId}?fields=id&access_token=${encodeURIComponent(token)}`);
    const body = await res.json().catch(() => ({}));
    if (body?.error) {
      const code = body.error.code;
      if (code === 190 || code === 102 || code === 10 || code === 200) return { alive: false, reason: body.error.message };
      return { alive: true };
    }
    return { alive: Boolean(body?.id) };
  } catch {
    return { alive: true };
  }
}

/** Живость токена: самый дешёвый вызов графа от имени аккаунта. */
async function instagramTokenAlive(
  externalId: string,
  token: string,
): Promise<{ alive: boolean; reason?: string }> {
  const graph = /^IG/i.test(token) ? GRAPH_IG : GRAPH_FB;
  try {
    const res = await fetch(`${graph}/${externalId}?fields=id&access_token=${encodeURIComponent(token)}`);
    const body = await res.json().catch(() => ({}));
    if (body?.error) {
      const code = body.error.code;
      // Мёртвым считаем только отказ авторизации: 4/17/32 — это лимиты, токен жив.
      if (code === 190 || code === 102 || code === 10 || code === 200) {
        return { alive: false, reason: body.error.message as string };
      }
      return { alive: true };
    }
    return { alive: Boolean(body?.id) };
  } catch {
    // Сеть не ответила — это не повод объявлять токен мёртвым.
    return { alive: true };
  }
}

/**
 * Живость токена одного аккаунта у площадки. TikTok/YouTube — через обновление
 * refresh_token'ом (у них нет дешёвого «кто я» без свежего access), остальные —
 * запрос id от имени аккаунта. Сетевая ошибка — не смерть токена (null).
 */
async function probeAccount(admin: SupabaseClient, account: PublishAccount): Promise<{ alive: boolean | null; reason: string | null }> {
  let token: string | null = null;
  try { token = await decryptSecret(account.access_token_encrypted); } catch { token = null; }
  if (!token) return { alive: false, reason: "токен не расшифрован — нужен reconnect" };

  if (account.platform === "tiktok" || account.platform === "youtube") {
    // Живость — запрос «кто я» текущим access-токеном; refresh только когда он
    // и правда истёк (иначе каждая проверка ротировала refresh_token TikTok).
    let live = token;
    if (tokenNeedsRefresh(account.token_expires_at, Date.now(), 600)) {
      const fresh = await ensureFreshToken(admin, account, token);
      if (fresh.error && /invalid_grant|invalid_token|access_token_invalid|revoked|reconnect/i.test(fresh.error)) return { alive: false, reason: fresh.error };
      if (fresh.error) return { alive: null, reason: fresh.error };
      live = fresh.token;
      if (fresh.expiresAt) account.token_expires_at = fresh.expiresAt;
    }
    try {
      const rq = identityRequest(account.platform, live);
      const res = await fetch(rq.url, rq.init);
      const body = await res.json().catch(() => ({}));
      if (parseIdentity(account.platform, body)) return { alive: true, reason: null };
      if (res.status === 401 || res.status === 403) return { alive: false, reason: `площадка отвергла токен (HTTP ${res.status})` };
      const code = String((body as { error?: { code?: string; message?: string } })?.error?.code ?? "");
      if (/access_token_invalid|invalid_token|scope_not_authorized|token_expired/i.test(code)) return { alive: false, reason: code };
      return { alive: null, reason: `площадка не ответила по существу (HTTP ${res.status})` };
    } catch (e) {
      return { alive: null, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  const r = account.platform === "threads"
    ? await threadsTokenAlive(account.external_account_id, token)
    : await instagramTokenAlive(account.external_account_id, token);
  return { alive: r.alive, reason: r.reason ?? null };
}

/** Исходы за 30 дней — вход для доли ошибок в формуле. */
async function outcomes30d(admin: SupabaseClient, accountIds: string[]): Promise<Map<string, { failed: number; published: number }>> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await admin.from("publish_jobs")
    .select("account_id, status").in("account_id", accountIds)
    .in("status", ["failed", "published"]).gte("updated_at", since);
  const m = new Map<string, { failed: number; published: number }>();
  for (const j of (data ?? []) as { account_id: string; status: string }[]) {
    const o = m.get(j.account_id) ?? { failed: 0, published: 0 };
    if (j.status === "failed") o.failed++; else o.published++;
    m.set(j.account_id, o);
  }
  return m;
}

/**
 * Проверка здоровья: живой запрос к площадке по каждому аккаунту, затем
 * health_score по формуле с причинами. Мёртвый токен переводит аккаунт в
 * token_expired (триггер в БД дополнительно уронит счётчик, формула его всё
 * равно перезапишет). Ожившему token_expired возвращаем active.
 */
async function checkHealth(admin: SupabaseClient, projectId: string | null, accountIds: string[] | null) {
  let q = admin.from("publish_accounts").select("*").neq("status", "disabled");
  if (projectId) q = q.eq("project_id", projectId);
  if (accountIds?.length) q = q.in("id", accountIds);
  const { data, error } = await q;
  if (error) return { checked: 0, token_expired: 0, accounts: [], error: error.message };
  const accounts = (data ?? []) as PublishAccount[];
  const stats = await outcomes30d(admin, accounts.map((a) => a.id));

  const out: { id: string; account_name: string; platform: string; alive: boolean | null; health_score: number; reasons: string[] }[] = [];
  const dead: PublishAccount[] = [];
  const now = new Date().toISOString();
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;
  let skipped = 0;

  for (const account of accounts) {
    if (Date.now() > deadline) { skipped++; continue; }
    const probe = await probeAccount(admin, account);
    const nextStatus = probe.alive === false
      ? "token_expired"
      : probe.alive === true && account.status === "token_expired" ? "active" : account.status;
    const o = stats.get(account.id) ?? { failed: 0, published: 0 };
    const h = computeHealth({
      platform: account.platform,
      status: nextStatus,
      tokenAlive: probe.alive,
      tokenExpiresAt: account.token_expires_at,
      lastCheckedAt: probe.alive == null ? account.last_checked_at ?? null : now,
      consecutiveErrors: account.consecutive_errors,
      failed30d: o.failed,
      published30d: o.published,
    });
    // auth_status и возможности — для реестра аккаунтов (Account Registry, docs/ARCHITECTURE.md).
    const authStatus = probe.alive === false
      ? "reconnect_required"
      : tokenNeedsRefresh(account.token_expires_at, Date.now(), 0) && !isOAuthPlatform(account.platform)
      ? "expired"
      : tokenNeedsRefresh(account.token_expires_at, Date.now(), TOKEN_WARN_DAYS * 86_400) && !isOAuthPlatform(account.platform)
      ? "expiring"
      : "connected";
    let tokenKind: ReturnType<typeof tokenKindOf> = "unknown";
    try { tokenKind = tokenKindOf(await decryptSecret(account.access_token_encrypted)); } catch { tokenKind = "unknown"; }
    const capabilities = resolveCapabilities({
      platform: account.platform, tokenKind, oauthScope: account.oauth_scope ?? null,
      hasRefreshToken: Boolean(account.refresh_token_encrypted),
    });
    await admin.from("publish_accounts").update({
      status: nextStatus,
      health_score: h.score,
      health_reasons: h.reasons,
      auth_status: authStatus,
      capabilities,
      // Не удалось достучаться до площадки — не считаем это проверкой.
      ...(probe.alive == null ? {} : { last_checked_at: now }),
      ...(probe.alive === false ? { last_error: probe.reason ?? "токен не проходит проверку — нужен reconnect" } : {}),
    }).eq("id", account.id);
    if (probe.alive === false && account.status !== "token_expired") dead.push(account);
    if (probe.alive === false) {
      await notifyCenter(admin, {
        projectId: account.project_id, kind: "account.reconnect_required", severity: "error",
        title: `Нужен reconnect: ${account.account_name} (${account.platform})`,
        body: probe.reason ?? "токен не проходит проверку у площадки",
        entityType: "publish_account", entityId: account.id, dedupeKey: `account:${account.id}:reconnect`,
      });
    } else if (probe.alive === true && account.status === "token_expired") {
      // Аккаунт ожил — снимаем уведомление, чтобы следующий отказ завёл новое.
      await admin.from("publish_notifications").update({ read_at: now })
        .eq("project_id", account.project_id).eq("dedupe_key", `account:${account.id}:reconnect`).is("read_at", null);
    }
    out.push({ id: account.id, account_name: account.account_name, platform: account.platform, alive: probe.alive, health_score: h.score, reasons: h.reasons });
  }

  // Об умерших токенах сообщаем один раз — при переходе, а не при каждой проверке.
  const byProject = new Map<string, string[]>();
  for (const a of dead) byProject.set(a.project_id, [...(byProject.get(a.project_id) ?? []), `${a.account_name} (${a.platform})`]);
  for (const [pid, names] of byProject) {
    await notifyProject(admin, pid, `🔑 Требуется переподключение аккаунтов (${names.length}):\n• ${names.join("\n• ")}`);
  }

  return { checked: accounts.length - skipped, token_expired: dead.length, skipped, accounts: out };
}

async function checkTokens(admin: SupabaseClient) {
  const { data, error } = await admin.from("publish_accounts")
    .select("*").in("status", ["active", "limited"]);
  // Ошибку БД возвращаем наружу, а не глотаем: пустой ответ и «таблицы нет» —
  // разные вещи, и диагностика готовности должна их различать.
  if (error) return { checked: 0, token_expired: 0, expiring_soon: 0, accounts: [], error: error.message };
  const accounts = (data ?? []) as PublishAccount[];

  const dead: PublishAccount[] = [];
  const expiring: PublishAccount[] = [];
  let refreshed = 0;
  const soon = Date.now() + TOKEN_WARN_DAYS * 86_400_000;
  const refreshBefore = Date.now() + TOKEN_REFRESH_DAYS * 86_400_000;

  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;
  const processed: PublishAccount[] = [];

  for (const account of accounts) {
    if (Date.now() > deadline) break;
    processed.push(account);
    let token: string | null = null;
    try { token = await decryptSecret(account.access_token_encrypted); } catch { token = null; }
    if (!token) { dead.push(account); continue; }

    // TikTok / YouTube: раз в сутки обновляем access-токен refresh_token'ом
    // (у TikTok он живёт 24 часа) и этим же подтверждаем живость.
    if (account.platform === "tiktok" || account.platform === "youtube") {
      const fresh = await ensureFreshToken(admin, { ...account, token_expires_at: new Date(0).toISOString() }, token);
      if (fresh.error && /invalid_grant|invalid_token|access_token_invalid|revoked|reconnect/i.test(fresh.error)) dead.push(account);
      else if (!fresh.error) {
        refreshed++;
        if (fresh.expiresAt) account.token_expires_at = fresh.expiresAt;
      }
      if (account.token_expires_at && new Date(account.token_expires_at).getTime() < soon) expiring.push(account);
      continue;
    }

    // Обновление long-lived токена до истечения — иначе через 60 дней вся сеть встанет.
    // Instagram Login (IG…) без записанного срока — тот же случай: срок неизвестен,
    // значит обновляем сейчас и запоминаем, когда истечёт. Page-токены (не IG…) вечные.
    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : null;
    const unknownIgExpiry = expiresAt == null && (account.platform === "threads" || /^IG/i.test(token));
    if (unknownIgExpiry || (expiresAt != null && expiresAt < refreshBefore)) {
      const r = await refreshLongLivedToken(account.platform, token);
      if (r && "token" in r) {
        try {
          await admin.from("publish_accounts").update({
            access_token_encrypted: await encryptSecret(r.token),
            token_expires_at: r.expiresAt,
            token_refreshed_at: new Date().toISOString(),
          }).eq("id", account.id);
          token = r.token;
          account.token_expires_at = r.expiresAt;
          refreshed++;
        } catch (e) {
          // Не смогли сохранить обновлённый токен (нет PUBLISH_TOKEN_KEY) — старый ещё жив, идём дальше.
          console.error("[publish-monitor] сохранение токена:", e instanceof Error ? e.message : String(e));
        }
      }
    }
    if (account.token_expires_at && new Date(account.token_expires_at).getTime() < soon && !(expiresAt != null && expiresAt < refreshBefore)) {
      expiring.push(account);
    }

    const alive = account.platform === "threads"
      ? await threadsTokenAlive(account.external_account_id, token)
      : await instagramTokenAlive(account.external_account_id, token);
    if (!alive.alive) dead.push(account);
  }

  const deadIds = new Set(dead.map((a) => a.id));
  const stats = await outcomes30d(admin, processed.map((a) => a.id));
  const now = new Date().toISOString();
  for (const account of processed) {
    const isDead = deadIds.has(account.id);
    const o = stats.get(account.id) ?? { failed: 0, published: 0 };
    const h = computeHealth({
      platform: account.platform,
      status: isDead ? "token_expired" : account.status,
      tokenAlive: !isDead,
      tokenExpiresAt: account.token_expires_at,
      lastCheckedAt: now,
      consecutiveErrors: account.consecutive_errors,
      failed30d: o.failed,
      published30d: o.published,
    });
    await admin.from("publish_accounts").update({
      health_score: h.score,
      health_reasons: h.reasons,
      last_checked_at: now,
      ...(isDead ? { status: "token_expired", last_error: "токен не проходит проверку — нужен reconnect" } : {}),
    }).eq("id", account.id);
  }

  // Одно сообщение на проект, а не на аккаунт: иначе при массовом протухании
  // токенов чат превращается в свалку.
  const byProject = new Map<string, string[]>();
  for (const account of dead) {
    const list = byProject.get(account.project_id) ?? [];
    list.push(`${account.account_name} (${account.platform})`);
    byProject.set(account.project_id, list);
  }
  for (const [projectId, names] of byProject) {
    await notifyProject(
      admin, projectId,
      `🔑 Требуется переподключение аккаунтов (${names.length}):\n• ${names.join("\n• ")}\n\nПубликации в них поставлены на паузу.`,
    );
  }

  return {
    checked: processed.length,
    skipped: accounts.length - processed.length,
    token_expired: dead.length,
    expiring_soon: expiring.length,
    refreshed,
    accounts: dead.map((a) => ({ id: a.id, account_name: a.account_name, platform: a.platform })),
  };
}

/** Часовой дайджест по проекту: что опубликовано, что упало, кому нужно внимание. */
async function sendDigests(admin: SupabaseClient) {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { data: jobs, error } = await admin.from("publish_jobs")
    .select("project_id, account_id, status, error_code, error_message, updated_at")
    .gte("updated_at", since)
    .in("status", ["published", "failed", "manual_review", "retry"]);
  if (error) return { projects: 0, sent: 0, error: error.message };

  const byProject = new Map<string, { published: number; failed: number; manual: number; retry: number; reasons: Map<string, number> }>();
  for (const j of (jobs ?? []) as { project_id: string; status: string; error_code: string | null }[]) {
    const p = byProject.get(j.project_id) ?? { published: 0, failed: 0, manual: 0, retry: 0, reasons: new Map() };
    if (j.status === "published") p.published++;
    else if (j.status === "failed") { p.failed++; p.reasons.set(j.error_code ?? "unknown", (p.reasons.get(j.error_code ?? "unknown") ?? 0) + 1); }
    else if (j.status === "manual_review") p.manual++;
    else if (j.status === "retry" && j.error_code) p.retry++;
    byProject.set(j.project_id, p);
  }

  let sent = 0;
  for (const [projectId, p] of byProject) {
    if (!p.failed && !p.manual && !p.retry) continue; // тихий час — не пишем
    // Режим и отдельный чат дайджеста (publish_project_settings.digest_chat_id);
    // без него — чат проекта из telegram_links.
    const { data: st } = await admin.from("publish_project_settings")
      .select("notify_mode, digest_chat_id").eq("project_id", projectId).maybeSingle();
    const settings = st as { notify_mode?: string; digest_chat_id?: string | null } | null;
    const mode = settings?.notify_mode === "each" || settings?.notify_mode === "silent" ? settings.notify_mode : "digest";
    if (mode !== "digest") continue;
    const { data: acc } = await admin.from("publish_accounts")
      .select("account_name, platform, status")
      .eq("project_id", projectId).in("status", ["token_expired", "limited", "error"]).limit(10);
    const attention = ((acc ?? []) as { account_name: string; platform: string; status: string }[])
      .map((a) => `• ${a.account_name} (${a.platform}) — ${a.status}`).join("\n");
    const reasons = Array.from(p.reasons.entries()).map(([k, n]) => `${k}×${n}`).join(", ");
    await notifyProject(
      admin, projectId,
      `📊 Публикации за час: ✅ ${p.published} · ❌ ${p.failed}${reasons ? ` (${reasons})` : ""} · 🔁 повторы ${p.retry} · 🖐 ручной разбор ${p.manual}` +
        (attention ? `\n\nТребуют внимания:\n${attention}` : ""),
      settings?.digest_chat_id ?? null,
    );
    sent++;
  }
  return { projects: byProject.size, sent };
}

async function checkErrors(admin: SupabaseClient) {
  const { data, error } = await admin.from("publish_accounts")
    .select("*")
    .gte("consecutive_errors", ERROR_STREAK_LIMIT)
    .eq("status", "active");
  if (error) return { disabled: 0, manual_review: 0, accounts: [], error: error.message };
  const broken = (data ?? []) as PublishAccount[];

  for (const account of broken) {
    await admin.from("publish_accounts").update({
      status: "error",
      publish_enabled: false,
    }).eq("id", account.id);
    await notifyProject(
      admin, account.project_id,
      `🛑 Аккаунт «${account.account_name}» (${account.platform}) отключён от публикаций: ${account.consecutive_errors} ошибок подряд.\nПоследняя: ${account.last_error ?? "—"}`,
    );
  }

  // Заодно показываем, сколько заданий ждёт ручного разбора.
  const { count } = await admin.from("publish_jobs")
    .select("id", { count: "exact", head: true }).eq("status", "manual_review");

  return {
    disabled: broken.length,
    manual_review: count ?? 0,
    accounts: broken.map((a) => ({ id: a.id, account_name: a.account_name, errors: a.consecutive_errors })),
  };
}


/* ───────────────────────── ежедневный отчёт ───────────────────────── */

export interface DailyReport {
  project_id: string;
  project_name: string | null;
  period_from: string;
  period_to: string;
  accounts: { total: number; healthy: number; need_attention: number };
  jobs: { scheduled: number; published: number; failed: number; waiting: number; success_rate: number | null };
  views_7d: number;
  reach_7d: number;
  top_content: { content_id: string; title: string | null; views_total: number; score: number | null }[];
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

export function formatDailyReport(r: DailyReport): string {
  const day = new Date(r.period_to).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Almaty" });
  const rate = r.jobs.success_rate == null ? "—" : `${r.jobs.success_rate.toFixed(1)}%`;
  const top = r.top_content.length
    ? r.top_content.map((c, i) => `${i + 1}. ${c.title ?? c.content_id.slice(0, 8)} — ${fmtInt(c.views_total)} просмотров${c.score != null ? ` · score ${c.score}` : ""}`).join("\n")
    : "пока нет измеренных публикаций";
  return [
    `📊 Отчёт за сутки · ${r.project_name ?? "проект"} · ${day}`,
    "",
    `Аккаунты: ${r.accounts.total} · здоровы ${r.accounts.healthy} · внимание ${r.accounts.need_attention}`,
    `Публикации: запланировано ${r.jobs.scheduled} · опубликовано ${r.jobs.published} · ошибок ${r.jobs.failed} · ждут ${r.jobs.waiting}`,
    `Успешность: ${rate}`,
    `Просмотры за 7 дней: ${fmtInt(r.views_7d)} · охват ${fmtInt(r.reach_7d)}`,
    "",
    "Лучший контент:",
    top,
  ].join("\n");
}

/**
 * Отчёт по проекту за последние 24 часа + просмотры за 7 дней + топ контента.
 * Считается из publish_jobs / publish_accounts / publish_content_metrics; ничего не пишет.
 */
async function buildDailyReport(admin: SupabaseClient, projectId: string): Promise<DailyReport> {
  const to = new Date();
  const from = new Date(to.getTime() - 86_400_000);
  const week = new Date(to.getTime() - 7 * 86_400_000).toISOString();
  const [{ data: project }, { data: accounts }, { data: jobs }, { data: content }, { data: pubs }] = await Promise.all([
    admin.from("projects").select("name").eq("id", projectId).maybeSingle(),
    admin.from("publish_accounts").select("status, health_score, publish_enabled").eq("project_id", projectId).neq("status", "disabled"),
    admin.from("publish_jobs").select("status, scheduled_at, published_at, updated_at").eq("project_id", projectId).gte("updated_at", from.toISOString()),
    admin.from("publish_content_metrics").select("content_id, title, views_total, score").eq("project_id", projectId)
      .gt("publications_measured", 0).order("score", { ascending: false, nullsFirst: false }).limit(3),
    admin.from("publish_publications").select("views, reach").eq("project_id", projectId).gte("published_at", week),
  ]);
  const accs = (accounts ?? []) as { status: string; health_score: number | null }[];
  const rows = (jobs ?? []) as { status: string; scheduled_at: string | null; published_at: string | null }[];
  const published = rows.filter((j) => j.status === "published" && j.published_at && j.published_at >= from.toISOString()).length;
  const failed = rows.filter((j) => j.status === "failed").length;
  const waiting = rows.filter((j) => ["pending", "retry", "processing", "verifying", "manual_review"].includes(j.status)).length;
  const scheduled = rows.filter((j) => j.scheduled_at && j.scheduled_at >= from.toISOString() && j.scheduled_at < to.toISOString()).length;
  const decided = published + failed;
  const views = (pubs ?? []) as { views: number | null; reach: number | null }[];
  return {
    project_id: projectId,
    project_name: (project as { name?: string } | null)?.name ?? null,
    period_from: from.toISOString(),
    period_to: to.toISOString(),
    accounts: {
      total: accs.length,
      healthy: accs.filter((a) => a.status === "active" && (a.health_score ?? 0) >= 50).length,
      need_attention: accs.filter((a) => a.status !== "active" || (a.health_score ?? 0) < 20).length,
    },
    jobs: { scheduled, published, failed, waiting, success_rate: decided ? Math.round((published / decided) * 1000) / 10 : null },
    views_7d: views.reduce((s, v) => s + (v.views ?? 0), 0),
    reach_7d: views.reduce((s, v) => s + (v.reach ?? 0), 0),
    top_content: ((content ?? []) as DailyReport["top_content"]).map((c) => ({ ...c, views_total: Number(c.views_total ?? 0), score: c.score == null ? null : Number(c.score) })),
  };
}

/**
 * mode: "daily_report" — отчёт каждому проекту с подключёнными аккаунтами: Telegram
 * (чат дайджеста или чат проекта), уведомление report.daily (через него — вебхуки).
 * С project_id и dry_run — только вернуть JSON (публичный API GET /reports/daily).
 */
async function sendDailyReports(admin: SupabaseClient, projectId: string | null, dryRun: boolean) {
  let projects: string[];
  if (projectId) projects = [projectId];
  else {
    const { data } = await admin.from("publish_accounts").select("project_id");
    projects = [...new Set(((data ?? []) as { project_id: string }[]).map((r) => r.project_id))];
  }
  const reports: DailyReport[] = [];
  let sent = 0;
  const day = new Date().toISOString().slice(0, 10);
  for (const pid of projects) {
    const report = await buildDailyReport(admin, pid);
    reports.push(report);
    if (dryRun) continue;
    const text = formatDailyReport(report);
    const { data: settings } = await admin.from("publish_project_settings").select("digest_chat_id, notify_mode").eq("project_id", pid).maybeSingle();
    const st = settings as { digest_chat_id?: string | null; notify_mode?: string } | null;
    if (st?.notify_mode !== "silent") {
      await notifyProject(admin, pid, text, st?.digest_chat_id ?? null);
      sent++;
    }
    await notifyCenter(admin, {
      projectId: pid, kind: "report.daily", severity: "info",
      title: `Отчёт за сутки: опубликовано ${report.jobs.published}, ошибок ${report.jobs.failed}`,
      body: text, dedupeKey: `report:daily:${day}`,
    });
  }
  return { projects: projects.length, sent, reports: projectId ? reports : undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? "errors");
  const projectId = typeof body?.project_id === "string" && body.project_id ? body.project_id : null;
  const accountIds = Array.isArray(body?.account_ids) ? body.account_ids.map(String).filter(Boolean) : null;

  if (!(await automationKeyValid(req, admin))) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    // Проверка здоровья своего проекта — любому, у кого есть к нему доступ;
    // остальные режимы и вся сеть целиком — только admin/manager.
    if ((mode === "health" || mode === "daily_report") && projectId) {
      const access = await requireProjectAccess(auth.authHeader, projectId);
      if (!access.ok) return access.response;
    } else if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) {
      return json({ error: "forbidden" }, 403);
    }
  }

  try {
    if (mode === "health") return json({ ok: true, mode, ...(await checkHealth(admin, projectId, accountIds)) });
    if (mode === "tokens") return json({ ok: true, mode, ...(await checkTokens(admin)) });
    if (mode === "errors") return json({ ok: true, mode, ...(await checkErrors(admin)) });
    if (mode === "digest") return json({ ok: true, mode, ...(await sendDigests(admin)) });
    if (mode === "daily_report") return json({ ok: true, mode, ...(await sendDailyReports(admin, projectId, body?.dry_run === true)) });
    return json({ error: `неизвестный режим: ${mode}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
