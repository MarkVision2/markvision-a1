/**
 * Раздел «Подключение TikTok» (docs/TIKTOK-DEVELOPER-APP.md): живая
 * демонстрация продуктов TikTok for Developers поверх аккаунтов очереди
 * публикаций (publish_accounts, platform = tiktok). Вход через Login Kit —
 * publish-oauth (start/callback), здесь — всё после входа.
 *
 *   POST /tiktok-connect  (JWT, доступ к проекту)  { action, project_id, ... }
 *     status          → настройка приложения (без секретов), подключённые аккаунты и их права
 *     profile         { account_id }                         — Display API: /user/info
 *     videos          { account_id, cursor? }                — Display API: /video/list
 *     creator_info    { account_id }                         — Content Posting API: creator_info/query
 *     publish         { account_id, mode, source, video_url, form } — video/init (+ загрузка чанков) | inbox/video/init
 *     publish_status  { account_id, publish_id }             — status/fetch
 *     disconnect      { account_id }                         — /oauth/revoke + удаление аккаунта и токенов
 *
 * Токены расшифровываются только здесь (PUBLISH_TOKEN_KEY), короткоживущий
 * access_token обновляется перед вызовом (ensureFreshToken). Все ответы
 * площадки уходят в publish_logs — это же журнал для App review.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireProjectAccess, requireUser } from "../_lib/auth.ts";
import { CORS_HEADERS, decryptSecret, json, logJob, type PublishAccount, tokenKeyConfigured } from "../_lib/publishing.ts";
import { ensureFreshToken } from "../_lib/publishRunner.ts";
import { tiktokPostUrl } from "../_lib/publishers/tiktok.ts";
import {
  apiError,
  buildPostInfo,
  contentRange,
  creatorInfoRequest,
  DEFAULT_TIKTOK_SCOPE,
  explainError,
  initRequest,
  isSandboxClientKey,
  parseCreatorInfo,
  parsePublishStatus,
  parseUserInfo,
  parseVideoList,
  type PostForm,
  type PostMode,
  revokeRequest,
  splitScopes,
  statusRequest,
  TIKTOK_SCOPES,
  uploadPlan,
  userInfoRequest,
  videoListRequest,
} from "../_lib/tiktokApi.ts";

type Body = Record<string, unknown>;

function clientKey(): string {
  return Deno.env.get("TIKTOK_CLIENT_KEY")?.trim() ?? "";
}

/** Права, которые просим при входе: секрет TIKTOK_SCOPES переопределяет каталог. */
function requestedScope(): string {
  return Deno.env.get("TIKTOK_SCOPES")?.trim() || DEFAULT_TIKTOK_SCOPE;
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: Body }> {
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let body: Body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: { error: { code: "network", message: e instanceof Error ? e.message : String(e) } } };
  }
}

/** Ошибка площадки → ответ клиенту с объяснением на двух языках. */
function apiFail(body: Body, status = 502): Response | null {
  const err = apiError(body);
  if (!err) return null;
  return json({
    error: `${explainError(err.code, "ru")} (${err.code})`,
    error_en: `${explainError(err.code, "en")} (${err.code})`,
    code: err.code,
    detail: err.message,
  }, status);
}

/* ───────────────────────────── аккаунт и токен ───────────────────────────── */

async function loadAccount(admin: SupabaseClient, projectId: string, accountId: string): Promise<PublishAccount | null> {
  if (!accountId) return null;
  const { data } = await admin.from("publish_accounts").select("*")
    .eq("id", accountId).eq("project_id", projectId).eq("platform", "tiktok").maybeSingle();
  return (data as PublishAccount | null) ?? null;
}

async function accessTokenFor(admin: SupabaseClient, account: PublishAccount): Promise<{ token: string } | { error: string }> {
  let token: string | null = null;
  try { token = await decryptSecret(account.access_token_encrypted); } catch { token = null; }
  if (!token) return { error: "Токен аккаунта не читается — переподключите TikTok" };
  const fresh = await ensureFreshToken(admin, account, token);
  if (fresh.error) {
    await admin.from("publish_accounts").update({ status: "token_expired", last_error: fresh.error }).eq("id", account.id);
    return { error: `Не удалось обновить токен: ${fresh.error}` };
  }
  return { token: fresh.token };
}

/** Общий пролог действий с аккаунтом: строка + живой токен или готовый ответ с ошибкой. */
async function withAccount(admin: SupabaseClient, projectId: string, body: Body): Promise<{ account: PublishAccount; token: string } | { response: Response }> {
  const account = await loadAccount(admin, projectId, String(body.account_id ?? ""));
  if (!account) return { response: json({ error: "Аккаунт TikTok не найден в этом проекте" }, 404) };
  const t = await accessTokenFor(admin, account);
  if ("error" in t) return { response: json({ error: t.error, code: "token" }, 401) };
  return { account, token: t.token };
}

/* ───────────────────────────── действия ───────────────────────────── */

async function status(admin: SupabaseClient, projectId: string): Promise<Response> {
  const key = clientKey();
  const scope = requestedScope();
  const { data } = await admin.from("publish_accounts")
    .select("id, account_name, handle, external_account_id, status, oauth_scope, token_expires_at, token_refreshed_at, connected_by, publish_enabled, last_error, last_post_at, followers")
    .eq("project_id", projectId).eq("platform", "tiktok").order("account_name");
  const requested = splitScopes(scope);
  const accounts = ((data ?? []) as Record<string, unknown>[]).map((a) => {
    const granted = splitScopes(a.oauth_scope as string | null);
    return {
      ...a,
      granted_scopes: granted,
      // Аккаунт подключён до появления права — площадка scope не вернула: считаем, что выдано всё, проверит первый вызов.
      missing_scopes: granted.length ? requested.filter((s) => !granted.includes(s)) : [],
    };
  });
  return json({
    ok: true,
    app: {
      configured: Boolean(key && Deno.env.get("TIKTOK_CLIENT_SECRET")?.trim()),
      sandbox: isSandboxClientKey(key),
      client_key_prefix: key ? `${key.slice(0, 4)}…` : null,
      token_key_configured: tokenKeyConfigured(),
      redirect_uri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/publish-oauth/callback/tiktok`,
      requested_scopes: requested,
      catalog: TIKTOK_SCOPES,
    },
    accounts,
  });
}

async function profile(admin: SupabaseClient, projectId: string, body: Body): Promise<Response> {
  const ctx = await withAccount(admin, projectId, body);
  if ("response" in ctx) return ctx.response;
  const rq = userInfoRequest(ctx.token, ctx.account.oauth_scope ?? null);
  const r = await fetchJson(rq.url, rq.init);
  const fail = apiFail(r.body);
  if (fail) return fail;
  const user = parseUserInfo(r.body);
  if (!user) return json({ error: "TikTok не вернул данные пользователя" }, 502);
  // Обновляем то, что видно в сети публикаций: имя, @username, подписчики.
  await admin.from("publish_accounts").update({
    account_name: user.display_name,
    handle: user.username ?? ctx.account.handle,
    ...(user.follower_count != null ? { followers: user.follower_count } : {}),
    last_checked_at: new Date().toISOString(),
  }).eq("id", ctx.account.id);
  return json({ ok: true, user, fields: rq.url.split("fields=")[1] });
}

async function videos(admin: SupabaseClient, projectId: string, body: Body): Promise<Response> {
  const ctx = await withAccount(admin, projectId, body);
  if ("response" in ctx) return ctx.response;
  const cursor = typeof body.cursor === "number" ? body.cursor : null;
  const rq = videoListRequest(ctx.token, { cursor, maxCount: 20 });
  const r = await fetchJson(rq.url, rq.init);
  const fail = apiFail(r.body);
  if (fail) return fail;
  const list = parseVideoList(r.body);
  return json({ ok: true, videos: list.videos, cursor: list.cursor, has_more: list.hasMore });
}

async function creatorInfo(admin: SupabaseClient, projectId: string, body: Body): Promise<Response> {
  const ctx = await withAccount(admin, projectId, body);
  if ("response" in ctx) return ctx.response;
  const rq = creatorInfoRequest(ctx.token);
  const r = await fetchJson(rq.url, rq.init);
  const fail = apiFail(r.body);
  if (fail) return fail;
  const creator = parseCreatorInfo(r.body);
  if (!creator) return json({ error: "TikTok не вернул creator_info" }, 502);
  return json({ ok: true, creator });
}

/** Размер файла по HEAD; если сервер не отдаёт Content-Length — скачиваем целиком. */
async function remoteSize(url: string): Promise<number | null> {
  try {
    const h = await fetch(url, { method: "HEAD" });
    const len = Number(h.headers.get("content-length"));
    return h.ok && Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  }
}

/**
 * Перекладываем файл из нашего хранилища на upload_url TikTok чанками:
 * Range-запрос к источнику → PUT с Content-Range. Если источник не умеет
 * Range (ответил 200 вместо 206), режем тело сами.
 */
async function pushChunks(videoUrl: string, uploadUrl: string, plan: ReturnType<typeof uploadPlan>, contentType: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  let whole: ArrayBuffer | null = null;
  let sent = 0;
  for (const range of plan.ranges) {
    let chunk: ArrayBuffer;
    if (whole) {
      chunk = whole.slice(range[0], range[1] + 1);
    } else {
      const r = await fetch(videoUrl, { headers: { Range: `bytes=${range[0]}-${range[1]}` } });
      if (!r.ok) return { ok: false, error: `источник видео ответил HTTP ${r.status}` };
      const buf = await r.arrayBuffer();
      if (r.status === 206 && buf.byteLength === range[1] - range[0] + 1) {
        chunk = buf;
      } else if (r.status === 200 && buf.byteLength >= range[1] + 1) {
        // Источник не умеет Range и отдал файл целиком — режем сами.
        whole = buf;
        chunk = whole.slice(range[0], range[1] + 1);
      } else {
        // 206 неверной длины или усечённый 200: резать такое по абсолютным смещениям —
        // отправить TikTok не те байты и получить невнятный отказ после init.
        return { ok: false, error: `источник видео отдал ${buf.byteLength} байт вместо диапазона ${range[0]}–${range[1]} (HTTP ${r.status})` };
      }
    }
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(chunk.byteLength),
        "Content-Range": contentRange(range, plan.video_size),
      },
      body: chunk,
    });
    if (!(put.status === 201 || put.status === 206 || put.ok)) {
      const text = await put.text().catch(() => "");
      return { ok: false, error: `TikTok не принял чанк ${range[0]}-${range[1]}: HTTP ${put.status} ${text.slice(0, 200)}` };
    }
    sent += chunk.byteLength;
  }
  return { ok: true, bytes: sent };
}

async function publish(admin: SupabaseClient, projectId: string, userId: string, body: Body): Promise<Response> {
  const ctx = await withAccount(admin, projectId, body);
  if ("response" in ctx) return ctx.response;
  const mode: PostMode = body.mode === "inbox" ? "inbox" : "direct";
  const sourceKind = body.source === "url" ? "url" : "file";
  const videoUrl = String(body.video_url ?? "");
  if (!/^https:\/\//.test(videoUrl)) return json({ error: "video_url: нужна https-ссылка на видео" }, 400);
  const lang: "ru" | "en" = body.lang === "en" ? "en" : "ru";

  let postInfo: ReturnType<typeof buildPostInfo> | null = null;
  let creatorNick: string | null = null;
  if (mode === "direct") {
    const ci = await fetchJson(creatorInfoRequest(ctx.token).url, creatorInfoRequest(ctx.token).init);
    const ciFail = apiFail(ci.body);
    if (ciFail) return ciFail;
    const creator = parseCreatorInfo(ci.body);
    if (!creator) return json({ error: "TikTok не вернул creator_info" }, 502);
    creatorNick = creator.nickname;
    const f = (body.form ?? {}) as Partial<PostForm>;
    const form: PostForm = {
      title: String(f.title ?? ""),
      privacy_level: typeof f.privacy_level === "string" ? f.privacy_level : null,
      allow_comment: Boolean(f.allow_comment),
      allow_duet: Boolean(f.allow_duet),
      allow_stitch: Boolean(f.allow_stitch),
      commercial_content: Boolean(f.commercial_content),
      your_brand: Boolean(f.your_brand),
      branded_content: Boolean(f.branded_content),
      ai_generated: Boolean(f.ai_generated),
      cover_timestamp_ms: typeof f.cover_timestamp_ms === "number" ? f.cover_timestamp_ms : null,
    };
    postInfo = buildPostInfo(form, creator);
    if (!postInfo.ok) return json({ error: postInfo.error.ru, error_en: postInfo.error.en, code: "form" }, 400);
  }

  let plan: ReturnType<typeof uploadPlan> | null = null;
  if (sourceKind === "file") {
    const size = await remoteSize(videoUrl);
    if (!size) return json({ error: "Не удалось узнать размер видео по ссылке (нет Content-Length)" }, 400);
    plan = uploadPlan(size);
  }

  const rq = initRequest(ctx.token, {
    mode,
    ...(postInfo && postInfo.ok ? { postInfo: postInfo.postInfo } : {}),
    source: plan ? { kind: "file", plan } : { kind: "url", videoUrl },
  });
  const init = await fetchJson(rq.url, rq.init);
  await logJob(admin, { accountId: ctx.account.id, message: `tiktok-connect ${mode}/${sourceKind} init → ${init.status}`, raw: init.body });
  const initFail = apiFail(init.body);
  if (initFail) return initFail;
  const data = (init.body.data ?? {}) as { publish_id?: string; upload_url?: string };
  if (!data.publish_id) return json({ error: "TikTok не вернул publish_id" }, 502);

  let uploaded: number | null = null;
  if (plan) {
    if (!data.upload_url) return json({ error: "TikTok не вернул upload_url" }, 502);
    const contentType = /\.(mov|qt)(\?|$)/i.test(videoUrl) ? "video/quicktime" : /\.webm(\?|$)/i.test(videoUrl) ? "video/webm" : "video/mp4";
    const pushed = await pushChunks(videoUrl, data.upload_url, plan, contentType);
    await logJob(admin, {
      accountId: ctx.account.id,
      level: pushed.ok ? "info" : "error",
      message: pushed.ok ? `tiktok-connect upload ${pushed.bytes} B in ${plan.total_chunk_count} chunk(s)` : `tiktok-connect upload failed: ${pushed.error}`,
    });
    if (!pushed.ok) return json({ error: pushed.error, publish_id: data.publish_id }, 502);
    uploaded = pushed.bytes;
  }

  await admin.from("publish_accounts").update({ last_error: null, connected_by: ctx.account.connected_by ?? userId }).eq("id", ctx.account.id);
  return json({
    ok: true,
    publish_id: data.publish_id,
    mode,
    source: sourceKind,
    uploaded_bytes: uploaded,
    chunks: plan?.total_chunk_count ?? null,
    creator_nickname: creatorNick,
    message: lang === "en"
      ? "Video sent to TikTok. Processing may take a few minutes; the status below updates automatically."
      : "Видео отправлено в TikTok. Обработка может занять несколько минут — статус ниже обновляется сам.",
  });
}

async function publishStatus(admin: SupabaseClient, projectId: string, body: Body): Promise<Response> {
  const ctx = await withAccount(admin, projectId, body);
  if ("response" in ctx) return ctx.response;
  const publishId = String(body.publish_id ?? "");
  if (!publishId) return json({ error: "publish_id обязателен" }, 400);
  const rq = statusRequest(ctx.token, publishId);
  const r = await fetchJson(rq.url, rq.init);
  const fail = apiFail(r.body);
  if (fail) return fail;
  const st = parsePublishStatus(r.body);
  if (st.status === "PUBLISH_COMPLETE") {
    await admin.from("publish_accounts").update({ last_post_at: new Date().toISOString() }).eq("id", ctx.account.id);
  }
  const postId = st.post_ids[0] ?? null;
  return json({
    ok: true,
    status: st.status,
    fail_reason: st.fail_reason,
    fail_explained: st.fail_reason ? { ru: explainError(st.fail_reason, "ru"), en: explainError(st.fail_reason, "en") } : null,
    uploaded_bytes: st.uploaded_bytes,
    post_id: postId,
    post_url: tiktokPostUrl(ctx.account.handle, postId),
  });
}

/**
 * Отключение = отзыв токена у TikTok + удаление строки аккаунта вместе с
 * зашифрованными токенами. Отзыв «как получится»: если площадка недоступна,
 * данные у нас всё равно удаляются.
 */
async function disconnect(admin: SupabaseClient, projectId: string, body: Body): Promise<Response> {
  const account = await loadAccount(admin, projectId, String(body.account_id ?? ""));
  if (!account) return json({ error: "Аккаунт TikTok не найден в этом проекте" }, 404);
  let revoked = false;
  const key = clientKey();
  const secret = Deno.env.get("TIKTOK_CLIENT_SECRET")?.trim() ?? "";
  let token: string | null = null;
  try { token = await decryptSecret(account.access_token_encrypted); } catch { token = null; }
  if (token && key && secret) {
    const rq = revokeRequest({ clientKey: key, clientSecret: secret, accessToken: token });
    const r = await fetchJson(rq.url, rq.init);
    revoked = r.status >= 200 && r.status < 300 && !apiError(r.body);
  }
  const { error } = await admin.from("publish_accounts").delete().eq("id", account.id);
  if (error) return json({ error: error.message }, 500);
  await logJob(admin, { message: `tiktok-connect disconnect ${account.account_name}: revoked=${revoked}` });
  return json({ ok: true, revoked });
}

/* ───────────────────────────── вход ───────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const body = (await req.json().catch(() => ({}))) as Body;
    const action = String(body.action ?? "status");
    const projectId = String(body.project_id ?? "");
    const access = await requireProjectAccess(auth.authHeader, projectId);
    if (!access.ok) return access.response;

    switch (action) {
      case "status": return await status(admin, projectId);
      case "profile": return await profile(admin, projectId, body);
      case "videos": return await videos(admin, projectId, body);
      case "creator_info": return await creatorInfo(admin, projectId, body);
      case "publish": return await publish(admin, projectId, auth.userId, body);
      case "publish_status": return await publishStatus(admin, projectId, body);
      case "disconnect": return await disconnect(admin, projectId, body);
      default: return json({ error: `неизвестное действие: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
