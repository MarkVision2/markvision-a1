/**
 * Публикация видео в Threads через Threads API.
 *
 * Порядок площадки тот же двухшаговый, что у Instagram: создать контейнер
 * (POST /{user}/threads, media_type=VIDEO, video_url, text) → дождаться
 * status=FINISHED (GET /{container}?fields=status,error_message) →
 * POST /{user}/threads_publish (creation_id). Токен — отдельный токен Threads
 * (long-lived, обновляется в publish-monitor через refresh_access_token),
 * external_account_id — Threads user id.
 *
 * Лимит площадки: 250 публикаций на аккаунт за сутки — классифицируется как
 * limit, аккаунт уходит в limited до разбора.
 */
import type { FailureKind, PublishOutcome, PublishRequest } from "./types.ts";

const GRAPH = "https://graph.threads.net/v1.0";

/** Максимальная длина текста поста Threads. */
export const THREADS_TEXT_LIMIT = 500;

const TOKEN_CODES = new Set([102, 190, 200, 10]);
const LIMIT_CODES = new Set([4, 17, 32, 613]);
const TEMPORARY_CODES = new Set([1, 2]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ThreadsError {
  message?: string;
  code?: number;
  error_subcode?: number;
}

function threadsError(payload: unknown): ThreadsError | null {
  const err = (payload as { error?: ThreadsError } | null)?.error;
  return err && typeof err === "object" ? err : null;
}

/** Отказ Threads → тип отказа для очереди (чистая функция — покрыта тестами). */
export function classifyThreadsError(err: ThreadsError): { kind: FailureKind; code: string; message: string } {
  const code = err.code ?? 0;
  const message = err.message ?? "неизвестная ошибка Threads";
  if (TOKEN_CODES.has(code) || /Invalid OAuth access token|Session has expired|Cannot parse access token/i.test(message)) {
    return { kind: "token", code: String(code), message: `Токен Threads недействителен: ${message}` };
  }
  if (LIMIT_CODES.has(code) || /rate limit|too many|limit reached|publishing limit/i.test(message)) {
    return { kind: "limit", code: String(code), message: `Лимит Threads: ${message}` };
  }
  if (TEMPORARY_CODES.has(code)) return { kind: "temporary", code: String(code), message };
  return { kind: "fatal", code: String(code), message };
}

/** Текст поста: подпись обрезается по лимиту площадки по границе слова. */
export function threadsText(caption: string): string {
  const text = caption.trim();
  if (text.length <= THREADS_TEXT_LIMIT) return text;
  const cut = text.slice(0, THREADS_TEXT_LIMIT - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > THREADS_TEXT_LIMIT * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; body: unknown }> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, body };
  } catch (e) {
    return { ok: false, body: { error: { code: 2, message: e instanceof Error ? e.message : String(e) } } };
  }
}

export async function publishThreads(req: PublishRequest): Promise<PublishOutcome> {
  const { token, account } = req;
  const userId = account.external_account_id;
  const deadline = Date.now() + (req.budgetMs ?? 25_000);
  let containerId = req.containerId ?? null;

  if (!containerId) {
    const params = new URLSearchParams({
      access_token: token,
      media_type: "VIDEO",
      video_url: req.videoUrl,
      text: threadsText(req.caption),
    });
    const { body } = await call(`${GRAPH}/${userId}/threads?${params}`, { method: "POST" });
    const id = (body as { id?: string } | null)?.id;
    if (!id) {
      const c = classifyThreadsError(threadsError(body) ?? { message: JSON.stringify(body).slice(0, 300) });
      return { status: "failed", kind: c.kind, code: c.code, message: c.message, raw: body };
    }
    containerId = id;
  }

  while (Date.now() < deadline) {
    const { body } = await call(`${GRAPH}/${containerId}?fields=status,error_message&access_token=${encodeURIComponent(token)}`);
    const st = (body ?? {}) as { status?: string; error_message?: string };
    if (st.status === "ERROR") {
      return {
        status: "failed", kind: "fatal", code: "container_error",
        message: `Threads не смог обработать видео: ${st.error_message || "причина не указана"}`, raw: body,
      };
    }
    if (st.status === "FINISHED") break;
    if (st.status === "EXPIRED") {
      return { status: "failed", kind: "temporary", code: "container_expired", message: "контейнер Threads истёк — повторим с новым", raw: body };
    }
    await sleep(2000);
  }
  if (Date.now() >= deadline) return { status: "processing", containerId };

  const { body: pub } = await call(
    `${GRAPH}/${userId}/threads_publish?creation_id=${containerId}&access_token=${encodeURIComponent(token)}`,
    { method: "POST" },
  );
  const mediaId = (pub as { id?: string } | null)?.id;
  if (!mediaId) {
    const raw = JSON.stringify(pub ?? {});
    if (/not ready|not available/i.test(raw)) return { status: "processing", containerId };
    const c = classifyThreadsError(threadsError(pub) ?? { message: raw.slice(0, 300) });
    return { status: "failed", kind: c.kind, code: c.code, message: c.message, raw: pub };
  }

  const { body: info } = await call(`${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`);
  return {
    status: "published",
    externalPostId: mediaId,
    externalPostUrl: (info as { permalink?: string } | null)?.permalink ?? null,
    raw: pub,
  };
}
