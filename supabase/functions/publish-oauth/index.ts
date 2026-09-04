/**
 * OAuth-подключение аккаунтов площадок к очереди публикаций: Threads, TikTok,
 * YouTube (Instagram подключается через Meta OAuth в publish-accounts).
 *
 *   POST /publish-oauth/start   (JWT)  { project_id, platform, return_url, group_id? } → { url }
 *   GET  /publish-oauth/diag    (JWT)  → что настроено, без значений секретов
 *   GET  /publish-oauth/callback/:platform?code&state   → 302 на return_url с
 *        ?publish_connected=<platform>&account=<name> или ?publish_error=<msg>
 *
 * Доверие callback — одноразовый state (publish_oauth_states, TTL 15 мин), как у
 * google-oauth-callback. Токены шифруются PUBLISH_TOKEN_KEY, scope сохраняется в
 * publish_accounts.oauth_scope. Секреты приложений:
 *   THREADS_APP_ID / THREADS_APP_SECRET
 *   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (тот же клиент, что у Google Ads;
 *   в консоли Google Cloud включить YouTube Data API и добавить redirect URI этой функции)
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireProjectAccess, requireUser } from "../_lib/auth.ts";
import { CORS_HEADERS, encryptSecret, json, tokenKeyConfigured } from "../_lib/publishing.ts";
import {
  authorizeUrl,
  codeExchangeRequest,
  hasRequiredScope,
  identityRequest,
  isOAuthPlatform,
  type OAuthPlatform,
  parseIdentity,
  parseTokenResponse,
  returnUrlWith,
  threadsLongLivedRequest,
  tokenError,
} from "../_lib/publishOAuth.ts";

const STATE_TTL_MS = 15 * 60_000;

function envKeys(platform: OAuthPlatform): [string, string] {
  return platform === "threads"
    ? ["THREADS_APP_ID", "THREADS_APP_SECRET"]
    : platform === "tiktok"
    ? ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]
    : ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"];
}

/**
 * Ключи приложения из секретов.
 *
 * trim обязателен: при вставке в Supabase Secrets в значение почти всегда
 * приезжает перевод строки или пробел, и площадка отвечает «client_key» —
 * ошибка выглядит так, будто ключ не тот, хотя он верный.
 */
function appCredentials(platform: OAuthPlatform): { clientId: string; clientSecret: string } | null {
  const [idKey, secretKey] = envKeys(platform);
  const clientId = Deno.env.get(idKey)?.trim();
  const clientSecret = Deno.env.get(secretKey)?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Явно неверный ключ — чтобы не гонять человека на страницу ошибки площадки.
 * TikTok: client key начинается с `aw` (прод) или `sbaw` (песочница); чисто
 * числовое значение — это App ID из той же карточки приложения, его площадка
 * не принимает. Возвращает текст проблемы или null.
 */
function credentialShapeProblem(platform: OAuthPlatform, clientId: string): string | null {
  if (platform !== "tiktok") return null;
  if (/^\d+$/.test(clientId)) {
    return "в TIKTOK_CLIENT_KEY лежит числовой App ID — нужен Client key со страницы приложения (начинается с aw или sbaw)";
  }
  if (!/^(sb)?aw/i.test(clientId)) {
    return `TIKTOK_CLIENT_KEY не похож на client key TikTok (начинается с «${clientId.slice(0, 2)}», ожидается aw или sbaw)`;
  }
  return null;
}

/**
 * Диагностика настройки OAuth без утечки секретов: что задано, какой длины,
 * похоже ли на ключ площадки и какой redirect_uri нужно зарегистрировать в
 * консоли приложения. Значения секретов наружу не отдаются.
 *
 * Функция публичная (verify_jwt = false нужен для callback площадки), поэтому
 * диагностику закрываем JWT вручную — конфиг проекта не для случайного гостя.
 */
async function diag(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const platforms = (["threads", "tiktok", "youtube"] as OAuthPlatform[]).map((platform) => {
    const [idKey, secretKey] = envKeys(platform);
    const rawId = Deno.env.get(idKey);
    const rawSecret = Deno.env.get(secretKey);
    const id = rawId?.trim() ?? "";
    return {
      platform,
      client_id_env: idKey,
      client_id_set: Boolean(id),
      client_id_length: id.length,
      /** Первые два символа — их хватает, чтобы отличить aw / sbaw / цифры. */
      client_id_prefix: id ? `${id.slice(0, 2)}…` : null,
      /** Самая частая беда: пробел или перевод строки внутри секрета. */
      client_id_had_whitespace: Boolean(rawId && rawId !== rawId.trim()),
      secret_env: secretKey,
      secret_set: Boolean(rawSecret?.trim()),
      secret_had_whitespace: Boolean(rawSecret && rawSecret !== rawSecret.trim()),
      shape_problem: id ? credentialShapeProblem(platform, id) : null,
      redirect_uri: redirectUri(platform),
    };
  });
  return json({ ok: true, token_key_configured: tokenKeyConfigured(), platforms });
}

function redirectUri(platform: OAuthPlatform): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/publish-oauth/callback/${platform}`;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const r = await fetch(url, init);
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { error: `HTTP ${r.status}: ${text.slice(0, 200)}` }; }
}

async function start(req: Request, admin: SupabaseClient): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const platform = body?.platform;
  const projectId = String(body?.project_id ?? "");
  const returnUrl = String(body?.return_url ?? "");
  if (!isOAuthPlatform(platform)) return json({ error: "platform: threads | tiktok | youtube" }, 400);
  if (!projectId || !/^https?:\/\//.test(returnUrl)) return json({ error: "project_id и return_url обязательны" }, 400);
  const access = await requireProjectAccess(auth.authHeader, projectId);
  if (!access.ok) return access.response;
  const creds = appCredentials(platform);
  if (!creds) {
    return json({
      error: `OAuth ${platform} не настроен`,
      hint: platform === "threads" ? "Секреты THREADS_APP_ID / THREADS_APP_SECRET" : platform === "tiktok" ? "Секреты TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET" : "Секреты GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET",
    }, 503);
  }
  const shape = credentialShapeProblem(platform, creds.clientId);
  if (shape) {
    return json({ error: `OAuth ${platform} настроен неверно`, hint: shape }, 503);
  }
  if (!tokenKeyConfigured()) return json({ error: "PUBLISH_TOKEN_KEY не задан — токены сохранять некуда" }, 500);

  const { data: state, error } = await admin.from("publish_oauth_states").insert({
    project_id: projectId,
    user_id: auth.userId,
    platform,
    return_url: returnUrl,
    group_id: typeof body?.group_id === "string" ? body.group_id : null,
  }).select("id").single();
  if (error || !state) return json({ error: error?.message ?? "state" }, 500);

  return json({ url: authorizeUrl(platform, { clientId: creds.clientId, redirectUri: redirectUri(platform), state: (state as { id: string }).id }) });
}

async function callback(url: URL, platform: OAuthPlatform, admin: SupabaseClient): Promise<Response> {
  const stateId = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!stateId) return new Response("Missing state", { status: 400 });
  const { data: state } = await admin.from("publish_oauth_states")
    .select("project_id, user_id, return_url, group_id, created_at, platform").eq("id", stateId).maybeSingle();
  await admin.from("publish_oauth_states").delete().eq("id", stateId);
  const st = state as { project_id: string; user_id: string; return_url: string; group_id: string | null; created_at: string; platform: string } | null;
  if (!st || st.platform !== platform) return new Response("Invalid or expired state", { status: 400 });
  if (Date.now() - Date.parse(st.created_at) > STATE_TTL_MS) return new Response("State expired", { status: 400 });
  const fail = (msg: string) => new Response(null, { status: 302, headers: { Location: returnUrlWith(st.return_url, { publish_error: msg.slice(0, 200) }) } });

  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (!code) return fail(denied ?? "Площадка не вернула code");
  const creds = appCredentials(platform);
  if (!creds) return fail(`OAuth ${platform} не настроен`);

  const ex = codeExchangeRequest(platform, { ...creds, code, redirectUri: redirectUri(platform) });
  let tokenBody = await fetchJson(ex.url, ex.init);
  let err = tokenError(tokenBody);
  if (err) return fail(`обмен кода: ${err}`);
  let parsed = parseTokenResponse(platform, tokenBody);
  if (!parsed) return fail("площадка не вернула access_token");

  if (platform === "threads") {
    // Короткий токен → long-lived (60 дней); обновляется потом в publish-monitor.
    const ll = threadsLongLivedRequest({ clientSecret: creds.clientSecret, accessToken: parsed.accessToken });
    tokenBody = await fetchJson(ll.url, ll.init);
    err = tokenError(tokenBody);
    if (err) return fail(`long-lived токен Threads: ${err}`);
    const long = parseTokenResponse("threads", tokenBody);
    if (long) parsed = { ...long, scope: parsed.scope, externalId: parsed.externalId };
  }
  if (!hasRequiredScope(platform, parsed.scope)) {
    return fail(`не выдано право на публикацию (${parsed.scope ?? "scope пуст"})`);
  }

  const idReq = identityRequest(platform, parsed.accessToken);
  const identity = parseIdentity(platform, await fetchJson(idReq.url, idReq.init));
  if (!identity) return fail("не удалось получить данные аккаунта площадки");

  const { data, error } = await admin.from("publish_accounts").upsert({
    project_id: st.project_id,
    platform,
    account_name: identity.name,
    handle: identity.handle,
    external_account_id: identity.externalId,
    access_token_encrypted: await encryptSecret(parsed.accessToken),
    refresh_token_encrypted: parsed.refreshToken ? await encryptSecret(parsed.refreshToken) : null,
    token_expires_at: parsed.expiresAt,
    token_refreshed_at: new Date().toISOString(),
    oauth_scope: parsed.scope,
    connected_by: st.user_id,
    status: "active",
    publish_enabled: true,
    consecutive_errors: 0,
    last_error: null,
    ...(st.group_id ? { group_id: st.group_id } : {}),
  }, { onConflict: "project_id,platform,external_account_id" }).select("id, account_name").maybeSingle();
  if (error) return fail(`сохранение аккаунта: ${error.message}`);

  return new Response(null, {
    status: 302,
    headers: { Location: returnUrlWith(st.return_url, { publish_connected: platform, account: (data as { account_name: string } | null)?.account_name ?? identity.name }) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("publish-oauth");
  const seg = idx >= 0 ? parts.slice(idx + 1) : parts;
  try {
    if (seg[0] === "diag" && req.method === "GET") return await diag(req);
    if (seg[0] === "start" && req.method === "POST") return await start(req, admin);
    if (seg[0] === "callback" && isOAuthPlatform(seg[1]) && req.method === "GET") return await callback(url, seg[1], admin);
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
