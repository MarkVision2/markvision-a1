/**
 * OAuth-подключение аккаунтов площадок к очереди публикаций: Threads, TikTok,
 * YouTube (Instagram из интерфейса подключается через Meta OAuth в publish-accounts,
 * а по ссылке-приглашению — здесь же, входом клиента в его Facebook).
 *
 * Две двери, одна машина: менеджер из кабинета (JWT) и клиент по ссылке
 * (публично, доверие — токен ссылки из publish_connect_links). Обе кладут
 * одинаковый state в publish_oauth_states и приходят в один callback.
 *
 *   POST /publish-oauth/start   (JWT)  { project_id, platform, return_url, group_id? } → { url }
 *   GET  /publish-oauth/invite?token=…            → карточка ссылки для клиента (публично)
 *   POST /publish-oauth/invite/start  { token, platform, return_url } → { url } (публично)
 *   POST /publish-oauth/invite/pages  { token, pending_id } → { pages } — выбор страницы Instagram
 *   POST /publish-oauth/invite/finish { token, pending_id, page_ids } → { connected }
 *   GET  /publish-oauth/diag           (JWT | x-automation-key) → что настроено, без секретов
 *   GET  /publish-oauth/probe-tiktok  (JWT | x-automation-key) → что отвечает TikTok на наш client key
 *   GET  /publish-oauth/callback/:platform?code&state   → 302 на return_url с
 *        ?publish_connected=<platform>&account=<name> или ?publish_error=<msg>
 *
 * Доверие callback — одноразовый state (publish_oauth_states, TTL 15 мин), как у
 * google-oauth-callback. Токены шифруются PUBLISH_TOKEN_KEY, scope сохраняется в
 * publish_accounts.oauth_scope. Секреты приложений:
 *   THREADS_APP_ID / THREADS_APP_SECRET
 *   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (+ необязательный TIKTOK_SCOPES — урезать права
 *   под песочницу; по умолчанию каталог _lib/tiktokApi.ts: Login Kit + Display API + Content Posting API)
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (тот же клиент, что у Google Ads;
 *   в консоли Google Cloud включить YouTube Data API и добавить redirect URI этой функции)
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireProjectAccess, requireUser } from "../_lib/auth.ts";
import { automationKeyValid, CORS_HEADERS, decryptSecret, encryptSecret, json, tokenKeyConfigured } from "../_lib/publishing.ts";
import { resolveCapabilities } from "../_lib/publishCapabilities.ts";
import {
  authorizeUrl,
  codeExchangeRequest,
  hasRequiredScope,
  identityRequest,
  isOAuthPlatform,
  metaAuthorizeUrl,
  metaCodeExchangeUrl,
  metaLongLivedUrl,
  metaPagesUrl,
  type MetaPageOption,
  type OAuthPlatform,
  parseIdentity,
  parseMetaPages,
  parseTokenResponse,
  returnUrlWith,
  threadsLongLivedRequest,
  tokenError,
} from "../_lib/publishOAuth.ts";
import {
  allowedPlatforms,
  CONNECT_LINK_STATE_TEXT,
  connectLinkState,
  connectLinkUsable,
  type ConnectLinkPlatform,
  isConnectLinkPlatform,
} from "../_lib/publishConnectLinks.ts";
import { tokenKindOf } from "../_lib/publishCapabilities.ts";

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
 * доступ закрываем вручную: JWT пользователя или ops-ключ (x-automation-key),
 * которым ходят крон и publishing-doctor.
 */
async function diag(req: Request, admin: SupabaseClient): Promise<Response> {
  if (!(await automationKeyValid(req, admin))) {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
  }
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
  return json({
    ok: true,
    token_key_configured: tokenKeyConfigured(),
    platforms,
    notes: {
      tiktok: [
        "Ошибка «client_key» на странице TikTok ПОСЛЕ входа — это не про значение ключа: у приложения, которое ещё не Live, авторизоваться могут только target users песочницы.",
        "Ключ с префиксом aw — production; он заработает для всех только после одобрения приложения (App review).",
        "До одобрения: Manage apps → переключить в Sandbox → Create Sandbox → добавить продукты Login Kit + Content Posting API → Target users → Add account (до 10) → взять sandbox Client Key (sbaw…) и Secret → положить в TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET → зарегистрировать redirect_uri в Login Kit песочницы.",
        "Sandbox не публикует публичные видео через Content Posting API — только для проверки связки; для боевой публикации нужен App review.",
      ],
    },
  });
}

/**
 * Живая проверка у TikTok: запрашиваем страницу согласия и смотрим, куда
 * площадка отправляет. Ловит только то, что TikTok отсекает ДО входа
 * (явные error_code в редиректе); неизвестный или неактивный ключ до входа
 * не отличается от рабочего — оба уводят на /login.
 */
async function probeTiktok(req: Request, admin: SupabaseClient): Promise<Response> {
  if (!(await automationKeyValid(req, admin))) {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
  }
  const creds = appCredentials("tiktok");
  if (!creds) return json({ error: "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET не заданы" }, 503);

  const url = authorizeUrl("tiktok", {
    clientId: creds.clientId,
    redirectUri: redirectUri("tiktok"),
    state: "probe",
  });
  let status = 0;
  let location: string | null = null;
  let verdict = "неизвестно";
  try {
    const r = await fetch(url, { redirect: "manual" });
    status = r.status;
    location = r.headers.get("location");
    const seen = `${location ?? ""} ${status === 200 ? await r.text() : ""}`;
    if (/error_code=client_key|"client_key"/.test(seen)) {
      verdict = "TikTok не принимает client key — значение в TIKTOK_CLIENT_KEY не соответствует приложению";
    } else if (/error_code=redirect_uri|redirect_uri/.test(seen)) {
      verdict = `TikTok не принимает redirect_uri — зарегистрируйте в приложении: ${redirectUri("tiktok")}`;
    } else if (/scope/.test(seen)) {
      verdict = "TikTok не выдаёт запрошенные права — проверьте продукты Login Kit / Content Posting API";
    } else if (status >= 300 && status < 400) {
      // На любой client_key, даже заведомо левый, TikTok отвечает 302 на /login —
      // проверка приложения происходит уже после входа пользователя.
      verdict = "до входа TikTok ключ не проверяет — редирект на /login ничего не доказывает; смотрите статус приложения и sandbox";
    } else if (status === 200) {
      verdict = "TikTok отдал страницу согласия без ошибки";
    }
  } catch (e) {
    verdict = `запрос к TikTok не удался: ${e instanceof Error ? e.message : String(e)}`;
  }
  return json({
    ok: true,
    verdict,
    status,
    /** Хост назначения без query — в query уходит client_key. */
    location_host: location ? new URL(location, "https://www.tiktok.com").host : null,
    location_error: location ? new URL(location, "https://www.tiktok.com").searchParams.get("error_code") : null,
    redirect_uri: redirectUri("tiktok"),
    client_key_prefix: `${creds.clientId.slice(0, 2)}…`,
    client_key_length: creds.clientId.length,
  });
}

function redirectUri(platform: ConnectLinkPlatform): string {
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

  return json({
    url: authorizeUrl(platform, {
      clientId: creds.clientId,
      redirectUri: redirectUri(platform),
      state: (state as { id: string }).id,
      ...(platform === "tiktok" && Deno.env.get("TIKTOK_SCOPES")?.trim() ? { scope: Deno.env.get("TIKTOK_SCOPES")!.trim() } : {}),
    }),
  });
}

async function callback(url: URL, platform: ConnectLinkPlatform, admin: SupabaseClient): Promise<Response> {
  const stateId = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!stateId) return new Response("Missing state", { status: 400 });
  const { data: state } = await admin.from("publish_oauth_states")
    .select("project_id, user_id, return_url, group_id, created_at, platform, connect_link_id").eq("id", stateId).maybeSingle();
  await admin.from("publish_oauth_states").delete().eq("id", stateId);
  const st = state as { project_id: string; user_id: string | null; return_url: string; group_id: string | null; created_at: string; platform: string; connect_link_id: string | null } | null;
  if (!st || st.platform !== platform) return new Response("Invalid or expired state", { status: 400 });
  if (Date.now() - Date.parse(st.created_at) > STATE_TTL_MS) return new Response("State expired", { status: 400 });
  const fail = (msg: string) => new Response(null, { status: 302, headers: { Location: returnUrlWith(st.return_url, { publish_error: msg.slice(0, 200) }) } });
  const done = (params: Record<string, string>) => new Response(null, { status: 302, headers: { Location: returnUrlWith(st.return_url, params) } });

  // Ссылка могла протухнуть, пока клиент был на площадке — проверяем на возврате.
  let link: ConnectLink | null = null;
  if (st.connect_link_id) {
    const { data } = await admin.from("publish_connect_links").select(LINK_COLUMNS).eq("id", st.connect_link_id).maybeSingle();
    link = (data as ConnectLink | null) ?? null;
    if (!link) return fail("ссылка удалена");
    if (!connectLinkUsable(link)) return fail(CONNECT_LINK_STATE_TEXT[connectLinkState(link)]);
  }

  const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (!code) return fail(denied ?? "Площадка не вернула code");
  if (platform === "instagram") {
    if (!link) return fail("Instagram подключается по ссылке-приглашению");
    if (!tokenKeyConfigured()) return fail("PUBLISH_TOKEN_KEY не задан — токены сохранять некуда");
    return await instagramCallback(admin, link, code, fail, done);
  }
  if (!tokenKeyConfigured()) return fail("PUBLISH_TOKEN_KEY не задан — токены сохранять некуда");
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
    connected_via: link ? "invite" : "dashboard",
    ...(link ? { connect_link_id: link.id, ...(link.persona_id ? { persona_id: link.persona_id } : {}) } : {}),
    status: "active",
    publish_enabled: true,
    consecutive_errors: 0,
    last_error: null,
    // Свежее подключение — здоровый аккаунт: формула пересчитает при следующей проверке.
    health_score: 100,
    health_reasons: [link ? "аккаунт подключён клиентом по ссылке" : "аккаунт переподключён, токен свежий"],
    last_checked_at: new Date().toISOString(),
    auth_status: "connected",
    capabilities: resolveCapabilities({ platform, tokenKind: "oauth", oauthScope: parsed.scope, hasRefreshToken: Boolean(parsed.refreshToken) }),
    ...(st.group_id ? { group_id: st.group_id } : {}),
  }, { onConflict: "project_id,platform,external_account_id" }).select("id, account_name").maybeSingle();
  if (error) return fail(`сохранение аккаунта: ${error.message}`);
  if (link) await bumpLinkUsage(admin, link, 1);
  // Новый токен — посты, чьи метрики были недоступны старому, пробуем собрать снова.
  if (data?.id) {
    await admin.from("publish_jobs")
      .update({ metrics_unavailable_reason: null })
      .eq("account_id", data.id)
      .not("metrics_unavailable_reason", "is", null);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: returnUrlWith(st.return_url, { publish_connected: platform, account: (data as { account_name: string } | null)?.account_name ?? identity.name }) },
  });
}


/* ──────────────────── подключение по ссылке ──────────────────── */

/**
 * Куда возвращать клиента после площадки. Адрес НЕ берём из тела запроса:
 * эндпоинт публичный, и чужой return_url превратил бы функцию в открытый
 * редирект. Собираем сами — корень приложения из секрета плюс страница
 * самой ссылки.
 */
const APP_ORIGIN = (): string =>
  (Deno.env.get("PUBLIC_APP_URL") ?? Deno.env.get("IG_PUBLIC_LINK_ORIGIN") ?? "https://www.markvision.kz").replace(/\/+$/, "");

function inviteReturnUrl(token: string): string {
  return `${APP_ORIGIN()}/connect/${encodeURIComponent(token)}`;
}

function metaCredentials(): { clientId: string; clientSecret: string } | null {
  // App ID публичный и зашит в facebook-oauth-* — держим тот же, секрет из Supabase Secrets.
  const clientId = (Deno.env.get("META_APP_ID") ?? "943753324681398").trim();
  const clientSecret = Deno.env.get("META_APP_SECRET")?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

interface ConnectLink {
  id: string;
  project_id: string;
  label: string;
  note: string | null;
  platforms: string[] | null;
  group_id: string | null;
  persona_id: string | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
}

const LINK_COLUMNS = "id, project_id, label, note, platforms, group_id, persona_id, max_uses, used_count, expires_at, revoked_at";

async function linkByToken(admin: SupabaseClient, token: unknown): Promise<ConnectLink | null> {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) return null;
  const { data } = await admin.from("publish_connect_links").select(LINK_COLUMNS).eq("token", token).maybeSingle();
  return (data as ConnectLink | null) ?? null;
}

/** Какие площадки реально предложить: разрешённые ссылкой ∩ настроенные секретами. */
function offeredPlatforms(link: ConnectLink): { platform: ConnectLinkPlatform; ready: boolean; hint: string | null }[] {
  return allowedPlatforms(link).map((platform) => {
    if (platform === "instagram") {
      return { platform, ready: metaCredentials() != null, hint: metaCredentials() ? null : "META_APP_SECRET не задан" };
    }
    const creds = appCredentials(platform);
    if (!creds) return { platform, ready: false, hint: `${envKeys(platform)[0]} / ${envKeys(platform)[1]} не заданы` };
    const shape = credentialShapeProblem(platform, creds.clientId);
    return { platform, ready: shape == null, hint: shape };
  });
}

/**
 * Карточка ссылки для страницы клиента: что за проект, какие кнопки показать,
 * что уже подключено. Публично — поэтому наружу уходит только то, что клиент
 * и так увидит на площадке: название проекта, имена подключённых им аккаунтов.
 */
async function inviteInfo(url: URL, admin: SupabaseClient): Promise<Response> {
  const token = url.searchParams.get("token");
  const link = await linkByToken(admin, token);
  if (!link) return json({ error: "invalid_link", message: "Ссылка не найдена. Попросите менеджера прислать новую." }, 404);

  const state = connectLinkState(link);
  const { data: project } = await admin.from("projects").select("name").eq("id", link.project_id).maybeSingle();
  const { data: connected } = await admin.from("publish_accounts")
    .select("platform, account_name, handle, status")
    .eq("connect_link_id", link.id).order("created_at", { ascending: false }).limit(50);

  return json({
    ok: true,
    state,
    state_text: CONNECT_LINK_STATE_TEXT[state],
    project_name: (project as { name?: string } | null)?.name ?? null,
    label: link.label,
    note: link.note,
    expires_at: link.expires_at,
    remaining: link.max_uses == null ? null : Math.max(0, link.max_uses - link.used_count),
    platforms: offeredPlatforms(link),
    connected: (connected ?? []) as { platform: string; account_name: string; handle: string | null; status: string }[],
  });
}

/** Клиент нажал «Подключить <площадка>» на публичной странице. */
async function inviteStart(req: Request, admin: SupabaseClient): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const link = await linkByToken(admin, body?.token);
  if (!link) return json({ error: "invalid_link", message: "Ссылка не найдена." }, 404);
  const state = connectLinkState(link);
  if (state !== "active") return json({ error: state, message: CONNECT_LINK_STATE_TEXT[state] }, 410);

  const platform = body?.platform;
  if (!isConnectLinkPlatform(platform)) return json({ error: "platform", message: "Неизвестная площадка." }, 400);
  if (!allowedPlatforms(link).includes(platform)) {
    return json({ error: "platform_not_allowed", message: "Эта площадка не входит в ссылку." }, 400);
  }
  if (!tokenKeyConfigured()) return json({ error: "not_configured", message: "PUBLISH_TOKEN_KEY не задан на сервере." }, 503);

  const creds = platform === "instagram" ? metaCredentials() : appCredentials(platform);
  if (!creds) return json({ error: "not_configured", message: `Подключение ${platform} не настроено на сервере.` }, 503);

  const { data: st, error } = await admin.from("publish_oauth_states").insert({
    project_id: link.project_id,
    user_id: null,
    platform,
    return_url: inviteReturnUrl(String(body.token)),
    group_id: link.group_id,
    connect_link_id: link.id,
  }).select("id").single();
  if (error || !st) return json({ error: "state", message: error?.message ?? "Не удалось начать подключение." }, 500);

  const stateId = (st as { id: string }).id;
  const url = platform === "instagram"
    ? metaAuthorizeUrl({ clientId: creds.clientId, redirectUri: redirectUri("instagram"), state: stateId })
    : authorizeUrl(platform, {
      clientId: creds.clientId,
      redirectUri: redirectUri(platform),
      state: stateId,
      ...(platform === "tiktok" && Deno.env.get("TIKTOK_SCOPES")?.trim() ? { scope: Deno.env.get("TIKTOK_SCOPES")!.trim() } : {}),
    });
  return json({ ok: true, url });
}

/** Страницы Facebook на выбор — без токенов наружу. */
async function invitePages(req: Request, admin: SupabaseClient): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const link = await linkByToken(admin, body?.token);
  if (!link) return json({ error: "invalid_link" }, 404);
  const { data } = await admin.from("publish_connect_pending")
    .select("id, pages, project_id, connect_link_id").eq("id", String(body?.pending_id ?? "")).maybeSingle();
  const pending = data as { pages: MetaPageOption[]; connect_link_id: string } | null;
  if (!pending || pending.connect_link_id !== link.id) return json({ error: "not_found", message: "Выбор устарел — начните заново." }, 404);
  return json({
    ok: true,
    pages: (pending.pages ?? []).map(({ page_token: _t, ...rest }) => rest),
  });
}

/** Клиент выбрал страницы Instagram — подключаем. */
async function inviteFinish(req: Request, admin: SupabaseClient): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const link = await linkByToken(admin, body?.token);
  if (!link) return json({ error: "invalid_link" }, 404);
  const state = connectLinkState(link);
  if (state !== "active") return json({ error: state, message: CONNECT_LINK_STATE_TEXT[state] }, 410);

  const { data } = await admin.from("publish_connect_pending")
    .select("id, pages, connect_link_id").eq("id", String(body?.pending_id ?? "")).maybeSingle();
  const pending = data as { id: string; pages: MetaPageOption[]; connect_link_id: string } | null;
  if (!pending || pending.connect_link_id !== link.id) return json({ error: "not_found", message: "Выбор устарел — начните заново." }, 404);

  const wanted = new Set((Array.isArray(body?.page_ids) ? body.page_ids : []).map(String));
  const pages = (pending.pages ?? []).filter((p) => wanted.has(p.page_id));
  if (!pages.length) return json({ error: "page_ids", message: "Выберите хотя бы один аккаунт." }, 400);

  const result = await connectInstagramPages(admin, link, pages);
  await admin.from("publish_connect_pending").delete().eq("id", pending.id);
  if (!result.connected.length) {
    return json({ error: "not_connected", message: result.skipped[0]?.reason ?? "Не удалось подключить аккаунт." }, 400);
  }
  return json({ ok: true, connected: result.connected, skipped: result.skipped });
}

/**
 * Сохранение страниц Instagram как аккаунтов сетки. Page-токен приходит либо
 * открытым (свежий ответ Meta в callback), либо шифротекстом (отложенный
 * выбор из publish_connect_pending) — decryptSecret понимает оба вида.
 */
async function connectInstagramPages(
  admin: SupabaseClient,
  link: ConnectLink,
  pages: MetaPageOption[],
): Promise<{ connected: { id: string; account_name: string; handle: string | null }[]; skipped: { page_id: string; reason: string }[] }> {
  const connected: { id: string; account_name: string; handle: string | null }[] = [];
  const skipped: { page_id: string; reason: string }[] = [];

  for (const page of pages) {
    if (!page.ig_user_id) { skipped.push({ page_id: page.page_id, reason: "к странице не привязан Instagram Business/Creator" }); continue; }
    const raw = await decryptSecret(page.page_token);
    if (!raw) { skipped.push({ page_id: page.page_id, reason: "Meta не отдала токен страницы" }); continue; }

    const { data, error } = await admin.from("publish_accounts").upsert({
      project_id: link.project_id,
      platform: "instagram",
      account_name: page.ig_name ?? page.ig_username ?? page.page_name ?? "Instagram",
      handle: page.ig_username,
      external_account_id: page.ig_user_id,
      fb_page_id: page.page_id,
      access_token_encrypted: await encryptSecret(raw),
      status: "active",
      publish_enabled: true,
      consecutive_errors: 0,
      last_error: null,
      followers: page.ig_followers,
      auth_status: "connected",
      capabilities: resolveCapabilities({ platform: "instagram", tokenKind: tokenKindOf(raw) }),
      health_score: 100,
      health_reasons: ["аккаунт подключён клиентом по ссылке"],
      last_checked_at: new Date().toISOString(),
      connected_via: "invite",
      connect_link_id: link.id,
      ...(link.group_id ? { group_id: link.group_id } : {}),
      ...(link.persona_id ? { persona_id: link.persona_id } : {}),
    }, { onConflict: "project_id,platform,external_account_id" })
      .select("id, account_name, handle").maybeSingle();

    if (error) skipped.push({ page_id: page.page_id, reason: error.message });
    else if (data) connected.push(data as { id: string; account_name: string; handle: string | null });
  }

  if (connected.length) await bumpLinkUsage(admin, link, connected.length);
  return { connected, skipped };
}

/** Счётчик подключений ссылки — по нему считается «осталось» и «исчерпана». */
async function bumpLinkUsage(admin: SupabaseClient, link: ConnectLink, by: number): Promise<void> {
  await admin.from("publish_connect_links")
    .update({ used_count: link.used_count + by, last_used_at: new Date().toISOString() })
    .eq("id", link.id);
}

/**
 * Instagram в callback: код Meta → долгий пользовательский токен → страницы.
 * Одна пригодная страница — подключаем молча; несколько — откладываем выбор
 * (гадать нельзя: у агентства это чужие бренды).
 */
async function instagramCallback(
  admin: SupabaseClient,
  link: ConnectLink,
  code: string,
  fail: (msg: string) => Response,
  done: (params: Record<string, string>) => Response,
): Promise<Response> {
  const creds = metaCredentials();
  if (!creds) return fail("подключение Instagram не настроено на сервере");

  const short = await fetchJson(metaCodeExchangeUrl({ ...creds, code, redirectUri: redirectUri("instagram") }), { method: "GET" });
  const shortErr = tokenError(short);
  if (shortErr) return fail(`обмен кода: ${shortErr}`);
  const shortToken = (short as { access_token?: string }).access_token;
  if (!shortToken) return fail("Meta не вернула access_token");

  const long = await fetchJson(metaLongLivedUrl({ ...creds, shortToken }), { method: "GET" });
  const userToken = (long as { access_token?: string }).access_token ?? shortToken;

  const pagesBody = await fetchJson(metaPagesUrl(userToken), { method: "GET" });
  const pagesErr = tokenError(pagesBody);
  if (pagesErr) return fail(`список страниц: ${pagesErr}`);
  const usable = parseMetaPages(pagesBody).filter((p) => p.connectable);
  if (!usable.length) {
    return fail("к вашему Facebook не привязан Instagram Business или Creator — переведите профиль в бизнес-аккаунт и свяжите со страницей");
  }

  if (usable.length === 1) {
    const res = await connectInstagramPages(admin, link, usable);
    if (!res.connected.length) return fail(res.skipped[0]?.reason ?? "не удалось сохранить аккаунт");
    return done({ publish_connected: "instagram", account: res.connected[0].account_name });
  }

  // Несколько страниц — прячем токены и отдаём клиенту выбор.
  const encrypted = await Promise.all(usable.map(async (p) => ({ ...p, page_token: p.page_token ? await encryptSecret(p.page_token) : null })));
  const { data, error } = await admin.from("publish_connect_pending").insert({
    connect_link_id: link.id,
    project_id: link.project_id,
    platform: "instagram",
    pages: encrypted,
  }).select("id").single();
  if (error || !data) return fail(error?.message ?? "не удалось сохранить список страниц");
  return done({ publish_select: (data as { id: string }).id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("publish-oauth");
  const seg = idx >= 0 ? parts.slice(idx + 1) : parts;
  try {
    if (seg[0] === "diag" && req.method === "GET") return await diag(req, admin);
    if (seg[0] === "probe-tiktok" && req.method === "GET") return await probeTiktok(req, admin);
    if (seg[0] === "start" && req.method === "POST") return await start(req, admin);
    // Публичные двери приглашения: доверие — токен ссылки, JWT здесь нет.
    if (seg[0] === "invite" && !seg[1] && req.method === "GET") return await inviteInfo(url, admin);
    if (seg[0] === "invite" && seg[1] === "start" && req.method === "POST") return await inviteStart(req, admin);
    if (seg[0] === "invite" && seg[1] === "pages" && req.method === "POST") return await invitePages(req, admin);
    if (seg[0] === "invite" && seg[1] === "finish" && req.method === "POST") return await inviteFinish(req, admin);
    if (seg[0] === "callback" && isConnectLinkPlatform(seg[1]) && req.method === "GET") return await callback(url, seg[1], admin);
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
