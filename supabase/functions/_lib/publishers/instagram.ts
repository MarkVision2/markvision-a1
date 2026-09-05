/**
 * Публикация Reels в Instagram через Content Publishing API.
 *
 * Порядок площадки: создать контейнер (video_url + caption) → дождаться
 * status_code=FINISHED → media_publish. Логика перенесена из edge-функции
 * publisher (контент-план проекта) и дополнена тем, что нужно очереди на
 * много аккаунтов: повтор добивает уже созданный контейнер, а отказ
 * классифицируется (мёртвый токен / лимит / временный сбой / отказ по сути).
 *
 * Граф выбирается по типу токена: Instagram Login (IGAA/IGQV…) ходит на
 * graph.instagram.com, Facebook Page token (EAA…) — на graph.facebook.com.
 * Без этого аккаунт с Instagram-Login токеном получает 190 «Invalid OAuth».
 */
import type { FailureKind, PublishOutcome, PublishRequest } from "./types.ts";

const GRAPH_IG = "https://graph.instagram.com/v21.0";
const GRAPH_FB = "https://graph.facebook.com/v21.0";

/** Коды Meta, на которых повтор имеет смысл: сервис занят, неизвестный сбой. */
const TEMPORARY_CODES = new Set([1, 2]);
/** Лимиты приложения/пользователя и лимит публикаций Instagram (25/сутки). */
const LIMIT_CODES = new Set([4, 17, 32, 613, 9007]);
/** Мёртвый или отозванный токен. */
const TOKEN_CODES = new Set([102, 190, 200, 10]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function graphFor(token: string): string {
  return /^IG/i.test(token) ? GRAPH_IG : GRAPH_FB;
}

interface MetaError {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}

function metaError(payload: unknown): MetaError | null {
  const err = (payload as { error?: MetaError } | null)?.error;
  return err && typeof err === "object" ? err : null;
}

/** Отказ Meta → тип отказа для очереди. */
function classify(err: MetaError): { kind: FailureKind; code: string; message: string } {
  const code = err.code ?? 0;
  const message = err.message ?? "неизвестная ошибка Instagram";
  if (TOKEN_CODES.has(code) || /Invalid OAuth access token|Cannot parse access token|Session has expired/i.test(message)) {
    return { kind: "token", code: String(code), message: `Токен Instagram недействителен: ${message}` };
  }
  if (LIMIT_CODES.has(code) || /rate limit|too many|limit reached/i.test(message)) {
    return { kind: "limit", code: String(code), message: `Лимит Instagram: ${message}` };
  }
  if (TEMPORARY_CODES.has(code)) {
    return { kind: "temporary", code: String(code), message };
  }
  return { kind: "fatal", code: String(code), message };
}

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; body: unknown }> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, body };
  } catch (e) {
    // Сеть отвалилась — это временный отказ, а не отказ площадки.
    return { ok: false, body: { error: { code: 2, message: e instanceof Error ? e.message : String(e) } } };
  }
}

async function containerStatus(
  graph: string,
  token: string,
  containerId: string,
): Promise<{ code: string; detail: string; raw: unknown }> {
  // status_code — машинный статус (FINISHED/ERROR/IN_PROGRESS), status —
  // человекочитаемая причина от Instagram при ERROR (например 2207052).
  const { body } = await call(`${graph}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
  const j = (body ?? {}) as { status_code?: string; status?: string };
  return { code: j.status_code ?? "", detail: typeof j.status === "string" ? j.status : "", raw: body };
}

async function permalinkOf(graph: string, token: string, mediaId: string): Promise<string | null> {
  const { body } = await call(`${graph}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`);
  return (body as { permalink?: string } | null)?.permalink ?? null;
}

export async function publishInstagram(req: PublishRequest): Promise<PublishOutcome> {
  const { token, account } = req;
  const graph = graphFor(token);
  const igUserId = account.external_account_id;
  const budgetMs = req.budgetMs ?? 25_000;
  const deadline = Date.now() + budgetMs;

  let containerId = req.containerId ?? null;

  // 1. Контейнер. Если он уже есть с прошлой попытки — видео не перезаливаем.
  if (!containerId) {
    const params = new URLSearchParams({
      access_token: token,
      media_type: "REELS",
      video_url: req.videoUrl,
      caption: req.caption,
    });
    if (req.thumbnailUrl) params.set("cover_url", req.thumbnailUrl);

    const { body } = await call(`${graph}/${igUserId}/media?${params}`, { method: "POST" });
    const id = (body as { id?: string } | null)?.id;
    if (!id) {
      const err = metaError(body) ?? { message: JSON.stringify(body).slice(0, 300) };
      const c = classify(err);
      return { status: "failed", kind: c.kind, code: c.code, message: c.message, raw: body };
    }
    containerId = id;
  }

  // 2. Ждём обработку. Не дождались за бюджет — вернём processing: очередь
  //    добьёт этот же контейнер на следующем тике, дубля не будет.
  while (Date.now() < deadline) {
    const st = await containerStatus(graph, token, containerId);
    if (st.code === "ERROR") {
      return {
        status: "failed",
        kind: "fatal",
        code: "container_error",
        message: `Instagram не смог обработать медиа: ${st.detail || "причина не указана"}`,
        raw: st.raw,
      };
    }
    // Пустой status_code встречается у части аккаунтов — пробуем публиковать.
    if (st.code === "FINISHED" || st.code === "") break;
    await sleep(2000);
  }
  if (Date.now() >= deadline) return { status: "processing", containerId };

  // 3. Публикация.
  const { body: pub } = await call(
    `${graph}/${igUserId}/media_publish?creation_id=${containerId}&access_token=${encodeURIComponent(token)}`,
    { method: "POST" },
  );
  const mediaId = (pub as { id?: string } | null)?.id;
  if (!mediaId) {
    const err = metaError(pub);
    const raw = JSON.stringify(pub ?? {});
    // «Media ID is not available» — контейнер ещё не дозрел, это не отказ.
    if (/not ready|Media ID is not available/i.test(raw)) return { status: "processing", containerId };
    const c = classify(err ?? { message: raw.slice(0, 300) });
    return { status: "failed", kind: c.kind, code: c.code, message: c.message, raw: pub };
  }

  return {
    status: "published",
    externalPostId: mediaId,
    externalPostUrl: await permalinkOf(graph, token, mediaId),
    raw: pub,
  };
}
