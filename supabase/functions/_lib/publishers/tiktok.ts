/**
 * Публикация видео в TikTok через Content Posting API (Direct Post).
 *
 * Порядок площадки: creator_info/query (какие privacy_level доступны аккаунту) →
 * post/publish/video/init с FILE_UPLOAD → PUT байтов кусками на upload_url →
 * опрос post/publish/status/fetch до PUBLISH_COMPLETE. publish_id сохраняется
 * как containerId: повтор опрашивает тот же заказ, а не заливает заново.
 *
 * Почему FILE_UPLOAD, а не PULL_FROM_URL: для pull TikTok требует верифицировать
 * домен видео в приложении, а ролики лежат на supabase.co и r2.cloudflarestorage.com —
 * чужие домены, их верифицировать нельзя (url_ownership_unverified навсегда).
 * FILE_UPLOAD верификации не требует: байты качаем с исходника Range-запросами
 * и отдаём площадке, ничего не буферизуя целиком.
 *
 * Неаудированное приложение публикует только приватно (SELF_ONLY) — площадка
 * отвечает privacy_level_option_mismatch / unaudited_client_…, это fatal с
 * понятным текстом, а не бесконечные повторы.
 */
import type { FailureKind, PublishOutcome, PublishRequest } from "./types.ts";

const API = "https://open.tiktokapis.com/v2";
export const TIKTOK_TITLE_LIMIT = 2200;

const MB = 1024 * 1024;
/** Границы площадки: кусок 5–64 МБ, одним куском — до 64 МБ, файл — до 4 ГБ. */
export const TIKTOK_MIN_CHUNK = 5 * MB;
export const TIKTOK_MAX_CHUNK = 64 * MB;
export const TIKTOK_MAX_VIDEO = 4 * 1024 * MB;
/** Рабочий размер куска: меньше — больше запросов, больше — дольше один PUT. */
export const TIKTOK_CHUNK = 32 * MB;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Код ошибки TikTok → тип отказа для очереди (чистая функция, покрыта тестами). */
export function classifyTikTokError(code: string | undefined, message?: string): { kind: FailureKind; code: string; message: string } {
  const c = String(code ?? "unknown");
  const msg = message ?? c;
  if (["access_token_invalid", "scope_not_authorized", "token_expired", "invalid_token"].includes(c)) {
    return { kind: "token", code: c, message: `Токен TikTok недействителен: ${msg}` };
  }
  if (["rate_limit_exceeded", "spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap", "spam_risk_too_many_pending_share", "daily_quota_exceeded"].includes(c)) {
    return { kind: "limit", code: c, message: `Лимит TikTok: ${msg}` };
  }
  if (["internal_error", "server_error", "timeout"].includes(c)) return { kind: "temporary", code: c, message: msg };
  return { kind: "fatal", code: c, message: msg };
}

/** Публичный уровень, если аккаунту он доступен, иначе первый разрешённый. */
export function pickPrivacyLevel(options: unknown): string {
  const list = Array.isArray(options) ? options.map(String) : [];
  if (!list.length) return "PUBLIC_TO_EVERYONE";
  if (list.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
  if (list.includes("MUTUAL_FOLLOW_FRIENDS")) return "MUTUAL_FOLLOW_FRIENDS";
  return list[0];
}

export function tiktokTitle(caption: string): string {
  const t = caption.trim();
  return t.length <= TIKTOK_TITLE_LIMIT ? t : `${t.slice(0, TIKTOK_TITLE_LIMIT - 1).trimEnd()}…`;
}

export function tiktokPostUrl(handle: string | null, postId: string | null): string | null {
  if (!postId) return null;
  return handle ? `https://www.tiktok.com/@${handle.replace(/^@/, "")}/video/${postId}` : `https://www.tiktok.com/video/${postId}`;
}

export interface TikTokChunk {
  start: number;
  /** Включительно, как в Content-Range. */
  end: number;
}

export interface TikTokChunkPlan {
  chunkSize: number;
  totalChunkCount: number;
  chunks: TikTokChunk[];
}

/**
 * Раскладка файла по кускам под правила площадки: total_chunk_count =
 * floor(size / chunk_size), хвост меньше chunk_size приклеивается к последнему
 * куску (последний может быть больше остальных). Файл до 64 МБ — один кусок
 * размером с файл. Чистая функция, покрыта тестами.
 */
export function planTikTokChunks(size: number, chunk: number = TIKTOK_CHUNK): TikTokChunkPlan {
  if (!Number.isFinite(size) || size <= 0) throw new Error("размер видео неизвестен");
  if (size > TIKTOK_MAX_VIDEO) throw new Error(`видео больше ${TIKTOK_MAX_VIDEO / MB} МБ — TikTok не примет`);
  if (size <= TIKTOK_MAX_CHUNK) {
    return { chunkSize: size, totalChunkCount: 1, chunks: [{ start: 0, end: size - 1 }] };
  }
  const chunkSize = Math.min(TIKTOK_MAX_CHUNK, Math.max(TIKTOK_MIN_CHUNK, chunk));
  const totalChunkCount = Math.max(1, Math.floor(size / chunkSize));
  const chunks: TikTokChunk[] = [];
  for (let i = 0; i < totalChunkCount; i++) {
    const start = i * chunkSize;
    const end = i === totalChunkCount - 1 ? size - 1 : start + chunkSize - 1;
    chunks.push({ start, end });
  }
  return { chunkSize, totalChunkCount, chunks };
}

async function call(url: string, token: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 300) }; }
    return { status: r.status, body: parsed };
  } catch (e) {
    return { status: 0, body: { error: { code: "timeout", message: e instanceof Error ? e.message : String(e) } } };
  }
}

function errOf(body: Record<string, unknown>): { code?: string; message?: string } {
  const e = (body.error ?? {}) as { code?: string; message?: string };
  return e.code && e.code !== "ok" ? e : {};
}

/** Размер и тип исходника — HEAD, чтобы не тянуть тело ради заголовков. */
async function probeSource(url: string): Promise<{ size: number; type: string } | { error: string }> {
  try {
    let r = await fetch(url, { method: "HEAD" });
    // Часть хранилищ на HEAD отвечает без Content-Length — тогда GET с закрытием тела.
    if (!r.ok || !r.headers.get("content-length")) {
      r = await fetch(url, { headers: { Range: "bytes=0-0" } });
      const cr = r.headers.get("content-range"); // bytes 0-0/12345
      const total = cr ? Number(cr.split("/")[1]) : Number(r.headers.get("content-length") ?? 0);
      await r.body?.cancel();
      if (!r.ok || !total) return { error: `исходник недоступен (HTTP ${r.status})` };
      return { size: total, type: r.headers.get("content-type") ?? "video/mp4" };
    }
    return { size: Number(r.headers.get("content-length")), type: r.headers.get("content-type") ?? "video/mp4" };
  } catch (e) {
    return { error: `исходник недоступен: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Один кусок: Range с исходника → PUT площадке с Content-Range. */
async function uploadChunk(
  uploadUrl: string, sourceUrl: string, type: string, c: TikTokChunk, total: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const src = await fetch(sourceUrl, { headers: { Range: `bytes=${c.start}-${c.end}` } });
  if (!(src.status === 206 || (src.status === 200 && c.start === 0 && c.end === total - 1))) {
    await src.body?.cancel();
    return { ok: false, message: `исходник не отдал диапазон ${c.start}-${c.end} (HTTP ${src.status})` };
  }
  const len = c.end - c.start + 1;
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": type.startsWith("video/") ? type : "video/mp4",
      "Content-Length": String(len),
      "Content-Range": `bytes ${c.start}-${c.end}/${total}`,
    },
    body: src.body,
  });
  if (put.status === 206 || put.status === 201 || put.ok) return { ok: true };
  const text = await put.text().catch(() => "");
  return { ok: false, message: `TikTok не принял кусок ${c.start}-${c.end} (HTTP ${put.status}) ${text.slice(0, 160)}` };
}

export async function publishTikTok(req: PublishRequest): Promise<PublishOutcome> {
  const { token, account } = req;
  const deadline = Date.now() + (req.budgetMs ?? 25_000);
  let publishId = req.containerId ?? null;

  if (!publishId) {
    const info = await call(`${API}/post/publish/creator_info/query/`, token, {});
    const infoErr = errOf(info.body);
    if (infoErr.code) {
      const c = classifyTikTokError(infoErr.code, infoErr.message);
      return { status: "failed", kind: c.kind, code: c.code, message: c.message, raw: info.body };
    }
    const data = (info.body.data ?? {}) as Record<string, unknown>;
    const maxDuration = Number(data.max_video_post_duration_sec ?? 0);
    const privacy = pickPrivacyLevel(data.privacy_level_options);

    const source = await probeSource(req.videoUrl);
    if ("error" in source) return { status: "failed", kind: "temporary", code: "source_unavailable", message: source.error };
    let plan: TikTokChunkPlan;
    try {
      plan = planTikTokChunks(source.size);
    } catch (e) {
      return { status: "failed", kind: "fatal", code: "video_size", message: e instanceof Error ? e.message : String(e) };
    }

    const init = await call(`${API}/post/publish/video/init/`, token, {
      post_info: {
        title: tiktokTitle(req.caption),
        privacy_level: privacy,
        disable_duet: false,
        disable_comment: Boolean(data.comment_disabled),
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: source.size,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    });
    const initErr = errOf(init.body);
    if (initErr.code) {
      const c = classifyTikTokError(initErr.code, initErr.message);
      const hint = /unaudited|privacy_level_option_mismatch/.test(initErr.code)
        ? " — приложение TikTok не прошло аудит, доступна только приватная публикация"
        : "";
      return { status: "failed", kind: c.kind, code: c.code, message: `${c.message}${hint}${maxDuration ? ` (лимит длительности ${maxDuration} с)` : ""}`, raw: init.body };
    }
    const initData = (init.body.data ?? {}) as { publish_id?: string; upload_url?: string };
    publishId = String(initData.publish_id ?? "");
    const uploadUrl = String(initData.upload_url ?? "");
    if (!publishId || !uploadUrl) {
      return { status: "failed", kind: "temporary", code: "no_upload_url", message: "TikTok не вернул publish_id/upload_url", raw: init.body };
    }

    // Куски — последовательно: параллельные PUT площадка не гарантирует.
    for (const c of plan.chunks) {
      const up = await uploadChunk(uploadUrl, req.videoUrl, source.type, c, source.size);
      // `=== false`, а не `!up.ok`: корневой tsc без strictNullChecks иначе не сужает тип.
      if (up.ok === false) {
        // Недолитый заказ повтором не добьёшь — upload_url одноразовый; начнём заново.
        return { status: "failed", kind: "temporary", code: "upload_failed", message: up.message };
      }
    }
  }

  while (Date.now() < deadline) {
    const st = await call(`${API}/post/publish/status/fetch/`, token, { publish_id: publishId });
    const stErr = errOf(st.body);
    if (stErr.code) {
      const c = classifyTikTokError(stErr.code, stErr.message);
      return { status: "failed", kind: c.kind, code: c.code, message: c.message, raw: st.body };
    }
    const data = (st.body.data ?? {}) as { status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] };
    if (data.status === "PUBLISH_COMPLETE") {
      const postId = data.publicaly_available_post_id?.[0] != null ? String(data.publicaly_available_post_id[0]) : null;
      return { status: "published", externalPostId: postId ?? publishId, externalPostUrl: tiktokPostUrl(account.handle, postId), raw: st.body };
    }
    if (data.status === "FAILED") {
      const c = classifyTikTokError(data.fail_reason, data.fail_reason);
      // Проблемы с самим файлом повтором не лечатся — это окончательный отказ.
      return { status: "failed", kind: /download|url|file|format|duration|resolution|frame|size/i.test(c.code) ? "fatal" : c.kind, code: c.code, message: `TikTok отклонил публикацию: ${data.fail_reason ?? "причина не указана"}`, raw: st.body };
    }
    await sleep(3000);
  }
  return { status: "processing", containerId: publishId };
}
