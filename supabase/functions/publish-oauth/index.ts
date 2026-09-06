/**
 * OAuth-подключение аккаунтов площадок к очереди публикаций: Instagram, Threads,
 * TikTok, YouTube.
 *
 * Две двери, одна машина: менеджер из кабинета (JWT) и клиент по ссылке
 * (публично, доверие — токен ссылки из publish_connect_links). Обе кладут
 * одинаковый state в publish_oauth_states и приходят в один callback.
 *
 * У Instagram, в свою очередь, два входа (mode):
 *   facebook  — человек входит в Facebook, мы забираем его страницы и
 *               привязанные к ним Instagram Business (page-токен бессрочный);
 *   instagram — вход логином самого Instagram (Instagram API with Instagram
 *               Login): страница Facebook не нужна, токен на 60 дней.
 * Общий Meta-токен проекта (publish-accounts) остаётся третьей дорогой — для
 * страниц, доступ к которым у менеджера уже есть.
 *
 *   POST /publish-oauth/start   (JWT)  { project_id, platform, return_url, group_id?, mode? } → { url }
 *   POST /publish-oauth/pages   (JWT)  { project_id, pending_id } → { pages } — выбор страницы Instagram
 *   POST /publish-oauth/finish  (JWT)  { project_id, pending_id, page_ids, group_id? } → { connected }
 *   GET  /publish-oauth/invite?token=…            → карточка ссылки для клиента (публично)
 *   POST /publish-oauth/invite/start  { token, platform, mode? } → { url } (публично)
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
  hasInstagramPublishScope,
  hasRequiredScope,
  identityRequest,
  instagramLoginAuthorizeUrl,
  instagramLoginCodeExchangeRequest,
  instagramLongLivedUrl,
  instagramMeUrl,
  metaAuthorizeUrl,
  metaCodeExchangeUrl,
  metaLongLivedUrl,
  metaPagesUrl,
  type MetaPageOption,
  type OAuthPlatform,
  parseIdentity,
  parseInstagramLoginToken,
  parseInstagramProfile,
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
  // Instagram живёт на секретах Meta и в diag попадает отдельной строкой: у него
  // другой набор переменных, но тот же вопрос — какой redirect_uri зарегистрировать.
  const meta = metaCredentials();
  const rawMetaSecret = Deno.env.get("META_APP_SECRET");
  const instagram = {
    platform: "instagram" as const,
    client_id_env: "META_APP_ID",
    client_id_set: Boolean(meta?.clientId),
    client_id_length: meta?.clientId.length ?? 0,
    client_id_prefix: meta ? `${meta.clientId.slice(0, 2)}…` : null,
    client_id_had_whitespace: false,
    secret_env: "META_APP_SECRET",
    secret_set: Boolean(rawMetaSecret?.trim()),
    secret_had_whitespace: Boolean(rawMetaSecret && rawMetaSecret !== rawMetaSecret.trim()),
    shape_problem: null,
    redirect_uri: redirectUri("instagram"),
  };
  // Второй вход в Instagram — логином самого Instagram: другое приложение,
  // своя пара ключей и свой адрес возврата.
  const rawIgId = Deno.env.get("INSTAGRAM_APP_ID");
  const rawIgSecret = Deno.env.get("INSTAGRAM_APP_SECRET");
  const igLogin = {
    platform: "instagram" as const,
    mode: "instagram" as const,
    client_id_env: "INSTAGRAM_APP_ID",
    client_id_set: Boolean(rawIgId?.trim()),
    client_id_length: rawIgId?.trim().length ?? 0,
    client_id_prefix: rawIgId?.trim() ? `${rawIgId.trim().slice(0, 2)}…` : null,
    client_id_had_whitespace: Boolean(rawIgId && rawIgId !== rawIgId.trim()),
    secret_env: "INSTAGRAM_APP_SECRET",
    secret_set: Boolean(rawIgSecret?.trim()),
    secret_had_whitespace: Boolean(rawIgSecret && rawIgSecret !== rawIgSecret.trim()),
    shape_problem: null,
    redirect_uri: redirectUri("instagram", "instagram"),
  };
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
    app_origin: APP_ORIGIN(),
    platforms: [instagram, igLogin, ...platforms],
    notes: {
      redirect_uri: [
        "Каждый redirect_uri из списка выше должен быть зарегистрирован в консоли своего приложения — иначе площадка отбивает вход ДО того, как мы что-то узнаем.",
        "Instagram (вход через Facebook): приложение Meta → Facebook Login → Settings → Valid OAuth Redirect URIs. Meta сверяет адрес только ПОСЛЕ входа, поэтому проверить заранее нельзя — человек увидит «URL Blocked».",
        "Instagram (вход в Instagram): приложение Meta → Instagram → API setup with Instagram login → Business login settings → OAuth redirect URI; там же берутся INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET.",
        "YouTube: Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs. Google сверяет адрес ДО входа и отвечает «Ошибка 400: redirect_uri_mismatch».",
        "TikTok: Login Kit приложения (или его песочницы) → Redirect URI.",
      ],
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

/**
 * Каким входом человек подключает Instagram. `facebook` — вход в Facebook и
 * выбор страниц, `instagram` — вход в сам Instagram (Instagram Login).
 * У остальных площадок вход один и в state не пишется.
 */
type InstagramMode = "facebook" | "instagram";

function isInstagramMode(v: unknown): v is InstagramMode {
  return v === "facebook" || v === "instagram";
}

/** Режим из тела запроса; по умолчанию — привычный вход через Facebook. */
function modeOf(v: unknown): InstagramMode {
  return isInstagramMode(v) ? v : "facebook";
}

/**
 * Ключи приложения Instagram Login. Это ДРУГАЯ пара, не META_APP_*: в карточке
 * приложения Meta она лежит в разделе «Instagram → API setup with Instagram
 * login» (Instagram app ID / Instagram app secret).
 */
function instagramLoginCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get("INSTAGRAM_APP_ID")?.trim();
  const clientSecret = Deno.env.get("INSTAGRAM_APP_SECRET")?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Адрес возврата площадки. У двух входов в Instagram он разный: приложения
 * разные, и каждый адрес регистрируется в своей консоли — иначе человек
 * упирается в «URL Blocked» уже после ввода пароля.
 */
function redirectUri(platform: ConnectLinkPlatform, mode: InstagramMode = "facebook"): string {
  const seg = platform === "instagram" && mode === "instagram" ? "instagram-login" : platform;
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/publish-oauth/callback/${seg}`;
}

/** Сегмент адреса возврата → площадка и режим входа. */
function callbackRoute(seg: string): { platform: ConnectLinkPlatform; mode: InstagramMode } | null {
  if (seg === "instagram-login") return { platform: "instagram", mode: "instagram" };
  if (isConnectLinkPlatform(seg)) return { platform: seg, mode: "facebook" };
  return null;
}

/** Куда и от чьего имени сохранять подключённый аккаунт. */
interface ConnectTarget {
  projectId: string;
  groupId: string | null;
  personaId: string | null;
  linkId: string | null;
  userId: string | null;
  via: "dashboard" | "invite";
}

function targetOfLink(link: ConnectLink): ConnectTarget {
  return {
    projectId: link.project_id,
    groupId: link.group_id,
    personaId: link.persona_id,
    linkId: link.id,
    userId: null,
    via: "invite",
  };
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
  if (!isConnectLinkPlatform(platform)) return json({ error: "platform: instagram | threads | tiktok | youtube" }, 400);
  if (!projectId || !/^https?:\/\//.test(returnUrl)) return json({ error: "project_id и return_url обязательны" }, 400);
  const access = await requireProjectAccess(auth.authHeader, projectId);
  if (!access.ok) return access.response;
  const groupId = typeof body?.group_id === "string" ? body.group_id : null;

  // Instagram — свои ключи и свой адрес возврата на каждый из двух входов.
  if (platform === "instagram") {
    const mode = modeOf(body?.mode);
    const igCreds = mode === "instagram" ? instagramLoginCredentials() : metaCredentials();
    if (!igCreds) {
      return json({
        error: mode === "instagram" ? "Вход через Instagram не настроен" : "Вход через Facebook не настроен",
        hint: mode === "instagram"
          ? "Секреты INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET (Meta App → Instagram → API setup with Instagram login)"
          : "Секрет META_APP_SECRET (Meta App → Facebook Login)",
      }, 503);
    }
    if (!tokenKeyConfigured()) return json({ error: "PUBLISH_TOKEN_KEY не задан — токены сохранять некуда" }, 500);
    const { data: igState, error: igErr } = await admin.from("publish_oauth_states").insert({
      project_id: projectId,
      user_id: auth.userId,
      platform,
      mode,
      return_url: returnUrl,
      group_id: groupId,
    }).select("id").single();
    if (igErr || !igState) return json({ error: igErr?.message ?? "state" }, 500);
    const igStateId = (igState as { id: string }).id;
    return json({
      url: mode === "instagram"
        ? instagramLoginAuthorizeUrl({ clientId: igCreds.clientId, redirectUri: redirectUri("instagram", "instagram"), state: igStateId })
        : metaAuthorizeUrl({ clientId: igCreds.clientId, redirectUri: redirectUri("instagram"), state: igStateId }),
    });
  }

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
    group_id: groupId,
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

async function callback(url: URL, platform: ConnectLinkPlatform, mode: InstagramMode, admin: SupabaseClient): Promise<Response> {
  const stateId = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!stateId) return new Response("Missing state", { status: 400 });
  const { data: state } = await admin.from("publish_oauth_states")
    .select("project_id, user_id, return_url, group_id, created_at, platform, mode, connect_link_id").eq("id", stateId).maybeSingle();
  await admin.from("publish_oauth_states").delete().eq("id", stateId);
  const st = state as { project_id: string; user_id: string | null; return_url: string; group_id: string | null; created_at: string; platform: string; mode: string | null; connect_link_id: string | null } | null;
  if (!st || st.platform !== platform) return new Response("Invalid or expired state", { status: 400 });
  // Режим из state должен совпадать с дверью, откуда пришёл code: чужому коду
  // с другого входа тут делать нечего.
  if (platform === "instagram" && modeOf(st.mode) !== mode) return new Response("Invalid or expired state", { status: 400 });
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
    if (!tokenKeyConfigured()) return fail("PUBLISH_TOKEN_KEY не задан — токены сохранять некуда");
    // Из кабинета аккаунт кладётся в проект state, по ссылке — в проект ссылки.
    const target: ConnectTarget = link
      ? targetOfLink(link)
      : { projectId: st.project_id, groupId: st.group_id, personaId: null, linkId: null, userId: st.user_id, via: "dashboard" };
    return mode === "instagram"
      ? await instagramLoginCallback(admin, target, code, fail, done)
      : await instagramCallback(admin, target, code, fail, done);
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


/* ──────────────────── выбор страниц из кабинета ──────────────────── */

/**
 * Страницы, отложенные после входа менеджера через Facebook. Токенов страниц
 * наружу не отдаём — только то, что человек и так видит в Instagram.
 */
async function dashboardPages(req: Request, admin: SupabaseClient): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const projectId = String(body?.project_id ?? "");
  if (!projectId) return json({ error: "project_id обязателен" }, 400);
  const access = await requireProjectAccess(auth.authHeader, projectId);
  if (!access.ok) return access.response;

  const pending = await pendingForUser(admin, String(body?.pending_id ?? ""), projectId, auth.userId);
  if (!pending) return json({ error: "not_found", message: "Выбор устарел — начните подключение заново." }, 404);
  const marks = await connectionMarks(admin, projectId, pending.pages);
  return json({
    ok: true,
    group_id: pending.group_id,
    pages: pending.pages.map(({ page_token: _t, ...rest }) => ({
      ...rest,
      already_connected: marks.connected.has(rest.ig_user_id ?? ""),
      connected_elsewhere: marks.elsewhere.get(rest.ig_user_id ?? "") ?? null,
    })),
  });
}

/** Менеджер выбрал страницы — подключаем их в проект. */
async function dashboardFinish(req: Request, admin: SupabaseClient): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const projectId = String(body?.project_id ?? "");
  if (!projectId) return json({ error: "project_id обязателен" }, 400);
  const access = await requireProjectAccess(auth.authHeader, projectId);
  if (!access.ok) return access.response;
  if (!tokenKeyConfigured()) return json({ error: "PUBLISH_TOKEN_KEY не задан — токены сохранять некуда" }, 500);

  const pending = await pendingForUser(admin, String(body?.pending_id ?? ""), projectId, auth.userId);
  if (!pending) return json({ error: "not_found", message: "Выбор устарел — начните подключение заново." }, 404);

  const wanted = new Set((Array.isArray(body?.page_ids) ? body.page_ids : []).map(String));
  const pages = pending.pages.filter((p) => wanted.has(p.page_id));
  if (!pages.length) return json({ error: "page_ids", message: "Выберите хотя бы один аккаунт." }, 400);

  // Группу берём из запроса (в диалоге её могли поменять), иначе — из state входа.
  const groupId = typeof body?.group_id === "string" && body.group_id ? body.group_id : pending.group_id;
  const result = await connectInstagramPages(admin, {
    projectId,
    groupId,
    personaId: null,
    linkId: null,
    userId: auth.userId,
    via: "dashboard",
  }, pages);
  await admin.from("publish_connect_pending").delete().eq("id", pending.id);
  if (!result.connected.length) {
    return json({ error: "not_connected", message: result.skipped[0]?.reason ?? "Не удалось подключить аккаунт." }, 400);
  }
  return json({ ok: true, connected: result.connected, skipped: result.skipped });
}

/** Отложенный выбор, начатый этим человеком в этом проекте; иначе null. */
async function pendingForUser(
  admin: SupabaseClient,
  pendingId: string,
  projectId: string,
  userId: string,
): Promise<{ id: string; pages: MetaPageOption[]; group_id: string | null } | null> {
  if (!pendingId) return null;
  const { data } = await admin.from("publish_connect_pending")
    .select("id, pages, group_id, project_id, user_id").eq("id", pendingId).maybeSingle();
  const row = data as { id: string; pages: MetaPageOption[] | null; group_id: string | null; project_id: string; user_id: string | null } | null;
  if (!row || row.project_id !== projectId || row.user_id !== userId) return null;
  return { id: row.id, pages: row.pages ?? [], group_id: row.group_id };
}

/**
 * Пометки для списка: этот Instagram уже в проекте / он же подключён в другом
 * проекте (дневные лимиты сложатся — площадка видит один аккаунт). Тот же
 * смысл, что у action=available в publish-accounts.
 */
async function connectionMarks(
  admin: SupabaseClient,
  projectId: string,
  pages: MetaPageOption[],
): Promise<{ connected: Set<string>; elsewhere: Map<string, string> }> {
  const igIds = pages.map((p) => p.ig_user_id).filter((x): x is string => Boolean(x));
  const connected = new Set<string>();
  const elsewhere = new Map<string, string>();
  if (!igIds.length) return { connected, elsewhere };

  const { data: mine } = await admin.from("publish_accounts")
    .select("external_account_id").eq("project_id", projectId).eq("platform", "instagram").in("external_account_id", igIds);
  for (const r of (mine ?? []) as { external_account_id: string }[]) connected.add(r.external_account_id);

  const { data: other } = await admin.from("publish_accounts")
    .select("external_account_id, projects(name)")
    .eq("platform", "instagram").neq("project_id", projectId).in("external_account_id", igIds);
  // Связь через FK клиент типизирует то объектом, то массивом — принимаем оба вида.
  type Rel = { name?: string } | { name?: string }[] | null;
  for (const r of (other ?? []) as unknown as { external_account_id: string; projects: Rel }[]) {
    const rel = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    elsewhere.set(r.external_account_id, rel?.name ?? "другом проекте");
  }
  return { connected, elsewhere };
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

/** Какие входы в Instagram настроены ключами приложения. */
function instagramModes(): { mode: InstagramMode; ready: boolean; hint: string | null }[] {
  return [
    {
      mode: "instagram",
      ready: instagramLoginCredentials() != null,
      hint: instagramLoginCredentials() ? null : "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET не заданы",
    },
    {
      mode: "facebook",
      ready: metaCredentials() != null,
      hint: metaCredentials() ? null : "META_APP_SECRET не задан",
    },
  ];
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
function offeredPlatforms(link: ConnectLink): { platform: ConnectLinkPlatform; ready: boolean; hint: string | null; modes?: { mode: InstagramMode; ready: boolean; hint: string | null }[] }[] {
  return allowedPlatforms(link).map((platform) => {
    if (platform === "instagram") {
      // Два входа: логином Instagram (проще клиенту) и через Facebook.
      // Кнопку показываем ту, что реально настроена ключами.
      const modes = instagramModes();
      return {
        platform,
        ready: modes.some((m) => m.ready),
        hint: modes.some((m) => m.ready) ? null : "META_APP_SECRET / INSTAGRAM_APP_* не заданы",
        modes,
      };
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

  const mode = modeOf(body?.mode);
  const creds = platform === "instagram"
    ? (mode === "instagram" ? instagramLoginCredentials() : metaCredentials())
    : appCredentials(platform);
  if (!creds) return json({ error: "not_configured", message: `Подключение ${platform} не настроено на сервере.` }, 503);

  const { data: st, error } = await admin.from("publish_oauth_states").insert({
    project_id: link.project_id,
    user_id: null,
    platform,
    mode: platform === "instagram" ? mode : null,
    return_url: inviteReturnUrl(String(body.token)),
    group_id: link.group_id,
    connect_link_id: link.id,
  }).select("id").single();
  if (error || !st) return json({ error: "state", message: error?.message ?? "Не удалось начать подключение." }, 500);

  const stateId = (st as { id: string }).id;
  const url = platform === "instagram"
    ? (mode === "instagram"
      ? instagramLoginAuthorizeUrl({ clientId: creds.clientId, redirectUri: redirectUri("instagram", "instagram"), state: stateId })
      : metaAuthorizeUrl({ clientId: creds.clientId, redirectUri: redirectUri("instagram"), state: stateId }))
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

  const result = await connectInstagramPages(admin, targetOfLink(link), pages);
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
  target: ConnectTarget,
  pages: MetaPageOption[],
): Promise<{ connected: { id: string; account_name: string; handle: string | null }[]; skipped: { page_id: string; reason: string }[] }> {
  const connected: { id: string; account_name: string; handle: string | null }[] = [];
  const skipped: { page_id: string; reason: string }[] = [];

  for (const page of pages) {
    if (!page.ig_user_id) { skipped.push({ page_id: page.page_id, reason: "к странице не привязан Instagram Business/Creator" }); continue; }
    const raw = await decryptSecret(page.page_token);
    if (!raw) { skipped.push({ page_id: page.page_id, reason: "Meta не отдала токен страницы" }); continue; }

    const { data, error } = await admin.from("publish_accounts").upsert({
      project_id: target.projectId,
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
      health_reasons: [target.via === "invite" ? "аккаунт подключён клиентом по ссылке" : "аккаунт подключён входом в Facebook"],
      last_checked_at: new Date().toISOString(),
      connected_via: target.via,
      connected_by: target.userId,
      connect_link_id: target.linkId,
      ...(target.groupId ? { group_id: target.groupId } : {}),
      ...(target.personaId ? { persona_id: target.personaId } : {}),
    }, { onConflict: "project_id,platform,external_account_id" })
      .select("id, account_name, handle").maybeSingle();

    if (error) skipped.push({ page_id: page.page_id, reason: error.message });
    else if (data) connected.push(data as { id: string; account_name: string; handle: string | null });
  }

  if (connected.length && target.linkId) await bumpLinkUsage(admin, { id: target.linkId }, connected.length);
  return { connected, skipped };
}

/**
 * Счётчик подключений ссылки — по нему считается «осталось» и «исчерпана».
 * Значение перечитываем: между выдачей ссылки и возвратом с площадки её мог
 * использовать другой человек.
 */
async function bumpLinkUsage(admin: SupabaseClient, link: { id: string }, by: number): Promise<void> {
  const { data } = await admin.from("publish_connect_links").select("used_count").eq("id", link.id).maybeSingle();
  const used = (data as { used_count?: number } | null)?.used_count ?? 0;
  await admin.from("publish_connect_links")
    .update({ used_count: used + by, last_used_at: new Date().toISOString() })
    .eq("id", link.id);
}

/**
 * Instagram в callback: код Meta → долгий пользовательский токен → страницы.
 * Одна пригодная страница — подключаем молча; несколько — откладываем выбор
 * (гадать нельзя: у агентства это чужие бренды).
 */
async function instagramCallback(
  admin: SupabaseClient,
  target: ConnectTarget,
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

  // Одна страница у клиента по ссылке — подключаем молча: выбирать не из чего.
  // В кабинете выбор показываем всегда: там же назначают группу и пресет пачки.
  if (usable.length === 1 && target.via === "invite") {
    const res = await connectInstagramPages(admin, target, usable);
    if (!res.connected.length) return fail(res.skipped[0]?.reason ?? "не удалось сохранить аккаунт");
    return done({ publish_connected: "instagram", account: res.connected[0].account_name });
  }

  // Несколько страниц — прячем токены и отдаём выбор тому, кто начал вход.
  const encrypted = await Promise.all(usable.map(async (p) => ({ ...p, page_token: p.page_token ? await encryptSecret(p.page_token) : null })));
  const { data, error } = await admin.from("publish_connect_pending").insert({
    connect_link_id: target.linkId,
    user_id: target.userId,
    project_id: target.projectId,
    group_id: target.groupId,
    platform: "instagram",
    pages: encrypted,
  }).select("id").single();
  if (error || !data) return fail(error?.message ?? "не удалось сохранить список страниц");
  return done({ publish_select: (data as { id: string }).id });
}

/**
 * Instagram Login: вход логином самого Instagram. Аккаунт один — выбирать
 * нечего, подключаем сразу. Токен долгий (60 дней) и продлевается: срок кладём
 * в token_expires_at, дальше его ведёт publish-monitor.
 */
async function instagramLoginCallback(
  admin: SupabaseClient,
  target: ConnectTarget,
  code: string,
  fail: (msg: string) => Response,
  done: (params: Record<string, string>) => Response,
): Promise<Response> {
  const creds = instagramLoginCredentials();
  if (!creds) return fail("вход через Instagram не настроен на сервере");

  const ex = instagramLoginCodeExchangeRequest({ ...creds, code, redirectUri: redirectUri("instagram", "instagram") });
  const shortBody = await fetchJson(ex.url, ex.init);
  const shortErr = tokenError(shortBody);
  if (shortErr) return fail(`обмен кода: ${shortErr}`);
  const short = parseInstagramLoginToken(shortBody);
  if (!short) return fail("Instagram не вернул access_token");
  if (!hasInstagramPublishScope(short.scope)) {
    return fail(`не выдано право на публикацию (${short.scope ?? "права пусты"})`);
  }

  const longBody = await fetchJson(instagramLongLivedUrl({ clientSecret: creds.clientSecret, shortToken: short.accessToken }), { method: "GET" });
  const long = parseInstagramLoginToken(longBody);
  // Долгий токен не выдался — работаем коротким: он живёт час, монитор
  // попросит переподключить, но аккаунт уже в сетке.
  const token = long?.accessToken ?? short.accessToken;
  const expiresAt = long?.expiresAt ?? short.expiresAt;

  const profile = parseInstagramProfile(await fetchJson(instagramMeUrl(token), { method: "GET" }));
  if (!profile) return fail("не удалось прочитать профиль Instagram");
  if (profile.accountType === "PERSONAL") {
    return fail("это личный профиль Instagram — переведите его в профессиональный (Business или Creator), тогда появится публикация через API");
  }

  const { data, error } = await admin.from("publish_accounts").upsert({
    project_id: target.projectId,
    platform: "instagram",
    account_name: profile.name ?? profile.username ?? "Instagram",
    handle: profile.username,
    external_account_id: profile.externalId,
    access_token_encrypted: await encryptSecret(token),
    token_expires_at: expiresAt,
    token_refreshed_at: new Date().toISOString(),
    oauth_scope: short.scope,
    followers: profile.followers,
    status: "active",
    publish_enabled: true,
    consecutive_errors: 0,
    last_error: null,
    auth_status: "connected",
    capabilities: resolveCapabilities({ platform: "instagram", tokenKind: tokenKindOf(token), oauthScope: short.scope }),
    health_score: 100,
    health_reasons: [target.via === "invite" ? "аккаунт подключён клиентом по ссылке" : "аккаунт подключён входом в Instagram"],
    last_checked_at: new Date().toISOString(),
    connected_via: target.via,
    connected_by: target.userId,
    connect_link_id: target.linkId,
    ...(target.groupId ? { group_id: target.groupId } : {}),
    ...(target.personaId ? { persona_id: target.personaId } : {}),
  }, { onConflict: "project_id,platform,external_account_id" }).select("id, account_name").maybeSingle();
  if (error) return fail(`сохранение аккаунта: ${error.message}`);
  if (target.linkId) await bumpLinkUsage(admin, { id: target.linkId }, 1);

  return done({ publish_connected: "instagram", account: (data as { account_name: string } | null)?.account_name ?? profile.username ?? "Instagram" });
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
    if (seg[0] === "pages" && req.method === "POST") return await dashboardPages(req, admin);
    if (seg[0] === "finish" && req.method === "POST") return await dashboardFinish(req, admin);
    // Публичные двери приглашения: доверие — токен ссылки, JWT здесь нет.
    if (seg[0] === "invite" && !seg[1] && req.method === "GET") return await inviteInfo(url, admin);
    if (seg[0] === "invite" && seg[1] === "start" && req.method === "POST") return await inviteStart(req, admin);
    if (seg[0] === "invite" && seg[1] === "pages" && req.method === "POST") return await invitePages(req, admin);
    if (seg[0] === "invite" && seg[1] === "finish" && req.method === "POST") return await inviteFinish(req, admin);
    if (seg[0] === "callback" && req.method === "GET") {
      const route = callbackRoute(seg[1] ?? "");
      if (route) return await callback(url, route.platform, route.mode, admin);
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
