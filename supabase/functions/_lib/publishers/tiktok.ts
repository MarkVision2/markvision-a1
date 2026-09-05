/**
 * Публикация видео в TikTok через Content Posting API (Direct Post).
 *
 * Порядок площадки: creator_info/query (какие privacy_level доступны аккаунту) →
 * post/publish/video/init с PULL_FROM_URL (домен видео должен быть верифицирован
 * в приложении TikTok) → опрос post/publish/status/fetch до PUBLISH_COMPLETE.
 * publish_id сохраняется как containerId: повтор опрашивает тот же заказ.
 *
 * Неаудированное приложение публикует только приватно (SELF_ONLY) — площадка
 * отвечает privacy_level_option_mismatch / unaudited_client_…, это fatal с
 * понятным текстом, а не бесконечные повторы.
 */
import type { FailureKind, PublishOutcome, PublishRequest } from "./types.ts";

const API = "https://open.tiktokapis.com/v2";
export const TIKTOK_TITLE_LIMIT = 2200;

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

    const init = await call(`${API}/post/publish/video/init/`, token, {
      post_info: {
        title: tiktokTitle(req.caption),
        privacy_level: privacy,
        disable_duet: false,
        disable_comment: Boolean(data.comment_disabled),
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: { source: "PULL_FROM_URL", video_url: req.videoUrl },
    });
    const initErr = errOf(init.body);
    if (initErr.code) {
      const c = classifyTikTokError(initErr.code, initErr.message);
      const hint = initErr.code === "url_ownership_unverified"
        ? " — домен видео не верифицирован в приложении TikTok"
        : /unaudited|privacy_level_option_mismatch/.test(initErr.code) ? " — приложение TikTok не прошло аудит, доступна только приватная публикация" : "";
      return { status: "failed", kind: c.kind, code: c.code, message: `${c.message}${hint}${maxDuration ? ` (лимит длительности ${maxDuration} с)` : ""}`, raw: init.body };
    }
    publishId = String(((init.body.data ?? {}) as Record<string, unknown>).publish_id ?? "");
    if (!publishId) return { status: "failed", kind: "temporary", code: "no_publish_id", message: "TikTok не вернул publish_id", raw: init.body };
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
      // Проблемы с самим файлом/ссылкой повтором не лечатся — это окончательный отказ.
      return { status: "failed", kind: /download|url|file|format|duration|resolution|frame/i.test(c.code) ? "fatal" : c.kind, code: c.code, message: `TikTok отклонил публикацию: ${data.fail_reason ?? "причина не указана"}`, raw: st.body };
    }
    await sleep(3000);
  }
  return { status: "processing", containerId: publishId };
}
