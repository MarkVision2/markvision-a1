// Общая обёртка над Meta Graph API для прямого контура запуска рекламы.
//
// Зачем отдельный модуль: воркер запуска обязан отличать «повторяемую» ошибку
// (throttle, временный сбой Meta) от фатальной (протух токен, битые параметры).
// Без этой классификации ретраи либо бесполезно долбят Graph, либо задание
// навсегда застревает в очереди.
//
// Модуль намеренно без импортов Deno/Supabase — чистые функции покрыты тестами
// из src/test/metaGraph.test.ts.

export const META_API_VERSION = "v21.0";
export const META_GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

export interface MetaError {
  message: string;
  /** Код ошибки Graph API. */
  code: number | null;
  subcode: number | null;
  type: string | null;
  /** fbtrace_id — по нему Meta ищет запрос в своих логах. */
  traceId: string | null;
  /** HTTP-статус ответа. */
  httpStatus: number;
}

export interface GraphResult<T = Record<string, unknown>> {
  ok: boolean;
  data: T | null;
  error: MetaError | null;
}

/**
 * Коды Graph, означающие «повтори позже».
 *   4     — лимит вызовов приложения
 *   17    — лимит вызовов пользователя
 *   613   — превышен лимит вызовов (rate limit ad account)
 *   80004 — Ads Management API throttle
 *   1, 2  — временная/неизвестная ошибка на стороне Meta
 *   341   — временный лимит приложения
 */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 341, 613, 80000, 80001, 80002, 80003, 80004]);

/**
 * Коды, при которых ретрай бессмыслен и нужно показать человеку внятную причину.
 *   190 — токен протух/отозван
 *   200, 272, 294 — нет прав на кабинет/страницу
 *   100 — битые параметры запроса
 *   368 — аккаунт ограничен Meta
 */
const FATAL_CODES = new Set([100, 190, 200, 272, 294, 368]);

export type MetaFailureKind = "retryable" | "fatal" | "unknown";

export function classifyMetaError(err: MetaError | null): MetaFailureKind {
  if (!err) return "unknown";
  if (err.code != null && FATAL_CODES.has(err.code)) return "fatal";
  if (err.code != null && RETRYABLE_CODES.has(err.code)) return "retryable";
  // 5xx Meta — почти всегда временное.
  if (err.httpStatus >= 500) return "retryable";
  // 429 без распознанного кода.
  if (err.httpStatus === 429) return "retryable";
  return "unknown";
}

/** Человекочитаемая причина для status_message в UI. */
export function describeMetaError(err: MetaError | null): string {
  if (!err) return "Неизвестная ошибка Meta";
  switch (err.code) {
    case 190:
      return "Токен Meta протух или отозван — переподключите кабинет в разделе «Реклама → Кабинеты»";
    case 200:
    case 272:
    case 294:
      return `Недостаточно прав в Meta: ${err.message}`;
    case 368:
      return "Рекламный аккаунт ограничен Meta — запуск невозможен до снятия ограничения";
    case 100:
      return `Meta отклонила параметры запроса: ${err.message}`;
    default:
      return err.message || `Ошибка Meta (HTTP ${err.httpStatus})`;
  }
}

/**
 * Задержка перед следующей попыткой: экспонента 2^attempts минут с потолком.
 * attempts — сколько попыток уже сделано (1 после первой неудачи).
 */
export function backoffMinutes(attempts: number, maxMinutes = 60): number {
  const raw = Math.pow(2, Math.max(0, attempts));
  return Math.min(raw, maxMinutes);
}

function parseMetaError(body: unknown, httpStatus: number): MetaError {
  const err = (body as { error?: Record<string, unknown> } | null)?.error ?? {};
  const num = (v: unknown): number | null =>
    typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
  return {
    message: typeof err.message === "string" ? err.message : `HTTP ${httpStatus}`,
    code: num(err.code),
    subcode: num(err.error_subcode),
    type: typeof err.type === "string" ? err.type : null,
    traceId: typeof err.fbtrace_id === "string" ? err.fbtrace_id : null,
    httpStatus,
  };
}

/** POST в Graph API формой application/x-www-form-urlencoded. */
export async function graphPost<T = Record<string, unknown>>(
  path: string,
  token: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<GraphResult<T>> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  form.set("access_token", token);

  try {
    const res = await fetch(`${META_GRAPH}/${path.replace(/^\/+/, "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || (body as { error?: unknown } | null)?.error) {
      return { ok: false, data: null, error: parseMetaError(body, res.status) };
    }
    return { ok: true, data: body as T, error: null };
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: {
        message: (e as Error)?.message ?? "network error",
        code: null,
        subcode: null,
        type: "network",
        traceId: null,
        // 0 не попадает ни в fatal, ни в retryable по кодам, но сеть стоит
        // повторить — поэтому отдаём 503, который classifyMetaError считает
        // повторяемым.
        httpStatus: 503,
      },
    };
  }
}

/** GET из Graph API. */
export async function graphGet<T = Record<string, unknown>>(
  path: string,
  token: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<GraphResult<T>> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    qs.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  qs.set("access_token", token);

  try {
    const res = await fetch(`${META_GRAPH}/${path.replace(/^\/+/, "")}?${qs.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || (body as { error?: unknown } | null)?.error) {
      return { ok: false, data: null, error: parseMetaError(body, res.status) };
    }
    return { ok: true, data: body as T, error: null };
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: {
        message: (e as Error)?.message ?? "network error",
        code: null,
        subcode: null,
        type: "network",
        traceId: null,
        httpStatus: 503,
      },
    };
  }
}

/**
 * Загрузка картинки в /act_X/adimages. Meta принимает только байты,
 * параметра «скачай по ссылке» для картинок нет — поэтому байты качает воркер.
 */
export async function uploadAdImage(
  adAccount: string,
  token: string,
  file: Blob,
  filename: string,
): Promise<GraphResult<{ hash: string; url: string }>> {
  const fd = new FormData();
  fd.append(filename, file, filename);
  fd.append("access_token", token);

  try {
    const res = await fetch(`${META_GRAPH}/${adAccount}/adimages`, {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => null) as
      | { images?: Record<string, { hash?: string; url?: string }>; error?: unknown }
      | null;
    if (!res.ok || body?.error) {
      return { ok: false, data: null, error: parseMetaError(body, res.status) };
    }
    const entry = body?.images ? Object.values(body.images)[0] : null;
    if (!entry?.hash) {
      return {
        ok: false,
        data: null,
        error: {
          message: "Meta не вернула image_hash",
          code: null, subcode: null, type: "protocol", traceId: null, httpStatus: res.status,
        },
      };
    }
    return { ok: true, data: { hash: entry.hash, url: entry.url ?? "" }, error: null };
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: {
        message: (e as Error)?.message ?? "network error",
        code: null, subcode: null, type: "network", traceId: null, httpStatus: 503,
      },
    };
  }
}

/**
 * Загрузка видео в /act_X/advideos по публичной ссылке — Meta скачивает ролик
 * сама (параметр file_url). Так мы не тащим сотни мегабайт через память
 * edge-функции. Возвращает video_id; готовность проверяется отдельно
 * через pollVideoStatus — обработка на стороне Meta асинхронная.
 */
export async function uploadAdVideoByUrl(
  adAccount: string,
  token: string,
  fileUrl: string,
  name: string,
): Promise<GraphResult<{ id: string }>> {
  return await graphPost<{ id: string }>(
    `${adAccount}/advideos`,
    token,
    { file_url: fileUrl, name },
    120_000,
  );
}

export type VideoStatus = "ready" | "processing" | "error";

/** Статус обработки видео: ready | processing | error. */
export async function pollVideoStatus(
  videoId: string,
  token: string,
): Promise<{ status: VideoStatus; error: MetaError | null; detail: string | null }> {
  const res = await graphGet<{ status?: { video_status?: string; processing_progress?: number; error?: { message?: string } } }>(
    videoId,
    token,
    { fields: "status" },
  );
  if (!res.ok) return { status: "error", error: res.error, detail: null };

  const raw = String(res.data?.status?.video_status ?? "").toLowerCase();
  if (raw === "ready") return { status: "ready", error: null, detail: null };
  if (raw === "error") {
    return {
      status: "error",
      error: null,
      detail: res.data?.status?.error?.message ?? "Meta не смогла обработать видео",
    };
  }
  const progress = res.data?.status?.processing_progress;
  return {
    status: "processing",
    error: null,
    detail: typeof progress === "number" ? `${progress}%` : null,
  };
}

/** Нормализация ad account id к виду act_<digits>. */
export function normalizeAdAccount(raw: string): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  const digits = t.replace(/\D/g, "");
  return digits ? `act_${digits}` : "";
}
