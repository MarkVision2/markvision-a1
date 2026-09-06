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
import { identityRequest, parseIdentity, tokenNeedsRefresh } from "../_lib/publishOAuth.ts";
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
    await admin.from("publish_accounts").update({
      status: nextStatus,
      health_score: h.score,
      health_reasons: h.reasons,
      // Не удалось достучаться до площадки — не считаем это проверкой.
      ...(probe.alive == null ? {} : { last_checked_at: now }),
      ...(probe.alive === false ? { last_error: probe.reason ?? "токен не проходит проверку — нужен reconnect" } : {}),
    }).eq("id", account.id);
    if (probe.alive === false && account.status !== "token_expired") dead.push(account);
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

/** Метка в last_error: по ней монитор отличает свою автопаузу от ручного «ограничен». */
const SHADOW_MARK = "возможный теневой бан";

interface ShadowRow {
  account_id: string;
  project_id: string;
  account_name: string;
  platform: string;
  status: string;
  last_error: string | null;
  baseline_views: number | null;
  recent_views: number | null;
  ratio: number | null;
  suspect: boolean;
}

/**
 * Теневой бан по просмотрам (publish_shadowban_scan, крон раз в сутки): последние
 * посты аккаунта собирают в разы меньше его же медианы → status = limited, планировщик
 * и claim аккаунт не берут, проект получает сообщение. Просмотры вернулись → снимаем
 * паузу сами, но только со своей пометкой: «ограничен» руками оператора не трогаем.
 */
async function checkShadowban(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("publish_shadowban_scan", {});
  if (error) return { scanned: 0, limited: 0, restored: 0, error: error.message };
  const rows = (data ?? []) as ShadowRow[];
  const limited: ShadowRow[] = [];
  const restored: ShadowRow[] = [];
  for (const r of rows) {
    const pct = r.ratio != null ? Math.round(Number(r.ratio) * 100) : null;
    if (r.suspect && r.status === "active") {
      const { error: uErr } = await admin.from("publish_accounts").update({
        status: "limited",
        last_error: `просмотры последних постов упали до ${pct ?? "?"} % от обычных (${r.recent_views ?? "?"} против ${r.baseline_views ?? "?"}) — ${SHADOW_MARK}, публикации приостановлены`,
      }).eq("id", r.account_id);
      if (!uErr) limited.push(r);
    } else if (!r.suspect && r.status === "limited" && (r.last_error ?? "").includes(SHADOW_MARK)) {
      const { error: uErr } = await admin.from("publish_accounts").update({ status: "active", last_error: null }).eq("id", r.account_id);
      if (!uErr) restored.push(r);
    }
  }

  const byProject = new Map<string, { limited: ShadowRow[]; restored: ShadowRow[] }>();
  for (const r of limited) { const p = byProject.get(r.project_id) ?? { limited: [], restored: [] }; p.limited.push(r); byProject.set(r.project_id, p); }
  for (const r of restored) { const p = byProject.get(r.project_id) ?? { limited: [], restored: [] }; p.restored.push(r); byProject.set(r.project_id, p); }
  for (const [projectId, p] of byProject) {
    const lines: string[] = [];
    if (p.limited.length) {
      lines.push(`🕶 Возможный теневой бан — публикации приостановлены (${p.limited.length}):`);
      for (const r of p.limited) lines.push(`• ${r.account_name} (${r.platform}) — ${r.recent_views ?? "?"} просмотров против обычных ${r.baseline_views ?? "?"}`);
      lines.push("Проверьте аккаунт вручную; когда просмотры вернутся, пауза снимется сама.");
    }
    if (p.restored.length) {
      lines.push(`✅ Просмотры вернулись, публикации возобновлены (${p.restored.length}): ${p.restored.map((r) => r.account_name).join(", ")}`);
    }
    await notifyProject(admin, projectId, lines.join("\n"));
  }

  return {
    scanned: rows.length,
    suspects: rows.filter((r) => r.suspect).length,
    limited: limited.length,
    restored: restored.length,
    accounts: rows.filter((r) => r.suspect).map((r) => ({
      id: r.account_id, account_name: r.account_name, platform: r.platform,
      baseline_views: r.baseline_views, recent_views: r.recent_views, ratio: r.ratio,
    })),
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
    if (mode === "health" && projectId) {
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
    if (mode === "shadow") return json({ ok: true, mode, ...(await checkShadowban(admin)) });
    return json({ error: `неизвестный режим: ${mode}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
