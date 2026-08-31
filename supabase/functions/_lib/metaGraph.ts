/**
 * Тонкий клиент Meta Marketing API: запросы, разбор ошибок и деление их на
 * временные (можно повторить) и окончательные (повтор не поможет).
 *
 * Логика сборки тел живёт в metaAds.ts, резолв гео — в metaGeo.ts. Здесь
 * только сеть, поэтому модуль не покрывается unit-тестами напрямую;
 * классификация ошибок вынесена в чистую функцию и тестируется отдельно.
 */
import { META_API_VERSION } from "./metaAds.ts";
import type { GeoSearch, GeoSearchItem } from "./metaGeo.ts";

const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

export interface MetaErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
  fbtrace_id?: string;
}

export class MetaApiError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly transient: boolean;

  constructor(status: number, payload: MetaErrorPayload | null, fallback: string) {
    // Пользовательское сообщение Meta понятнее технического — показываем его.
    const text = payload?.error_user_msg || payload?.message || fallback;
    super(text);
    this.name = "MetaApiError";
    this.status = status;
    this.code = payload?.code ?? null;
    this.subcode = payload?.error_subcode ?? null;
    this.transient = isTransientMetaError(status, payload);
  }
}

/**
 * Временные коды Meta: лимиты запросов, внутренние сбои и явный флаг
 * `is_transient`. Всё остальное (протухший токен, отклонённая настройка)
 * повтором не лечится и должно сразу становиться ошибкой запуска.
 */
export function isTransientMetaError(
  status: number,
  payload: MetaErrorPayload | null,
): boolean {
  if (payload?.is_transient) return true;
  const code = payload?.code ?? null;
  // 1 — неизвестная ошибка, 2 — сервис недоступен, 4/17/32/613 — лимиты запросов,
  // 80000-80004 — лимиты рекламного API.
  if (code !== null) {
    if ([1, 2, 4, 17, 32, 613].includes(code)) return true;
    if (code >= 80000 && code <= 80004) return true;
    return false;
  }
  return status === 429 || status >= 500;
}

export interface GraphOptions {
  token: string;
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | undefined | null>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

/** Запрос к Graph API. Бросает MetaApiError, иначе отдаёт разобранный JSON. */
export async function graph<T = Record<string, unknown>>(
  path: string,
  opts: GraphOptions,
): Promise<T> {
  const url = new URL(`${GRAPH}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  url.searchParams.set("access_token", opts.token);

  const method = opts.method ?? "GET";
  const res = await fetch(url.toString(), {
    method,
    ...(opts.body
      ? {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts.body),
      }
      : {}),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  const errorPayload = (parsed as { error?: MetaErrorPayload } | null)?.error ?? null;
  if (!res.ok || errorPayload) {
    throw new MetaApiError(
      res.status,
      errorPayload,
      `Meta ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  return (parsed ?? {}) as T;
}

/* ────────────────────────────── справочник гео ───────────────────────── */

/** Поиск городов и стран для metaGeo.buildGeoLocations. */
export function makeGeoSearch(token: string): GeoSearch {
  return async (query: string) => {
    const res = await graph<{ data?: GeoSearchItem[] }>("search", {
      token,
      query: {
        type: "adgeolocation",
        q: query,
        location_types: JSON.stringify(["country", "region", "city"]),
        limit: 15,
      },
      timeoutMs: 20_000,
    });
    return res.data ?? [];
  };
}

/* ────────────────────────────── медиа ────────────────────────────────── */

/** Загружает картинку в рекламный аккаунт, отдаёт image_hash. */
export async function uploadImage(
  adAccountId: string,
  token: string,
  file: File,
): Promise<{ hash: string; url: string } | null> {
  const fd = new FormData();
  fd.append(file.name, file, file.name);
  fd.append("access_token", token);

  const res = await fetch(`${GRAPH}/${adAccountId}/adimages`, {
    method: "POST",
    body: fd,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => null) as {
    images?: Record<string, { hash?: string; url?: string }>;
    error?: MetaErrorPayload;
  } | null;

  if (!res.ok || data?.error) {
    throw new MetaApiError(res.status, data?.error ?? null, "Не удалось загрузить изображение");
  }
  const entry = data?.images ? Object.values(data.images)[0] : null;
  return entry?.hash ? { hash: entry.hash, url: entry.url ?? "" } : null;
}

/** Загружает видео файлом — как оно пришло из мастера запуска. */
export async function uploadVideoFile(
  adAccountId: string,
  token: string,
  file: File,
): Promise<string> {
  const fd = new FormData();
  fd.append("source", file, file.name);
  fd.append("name", file.name);
  fd.append("access_token", token);

  const res = await fetch(`${GRAPH}/${adAccountId}/advideos`, {
    method: "POST",
    body: fd,
    signal: AbortSignal.timeout(180_000),
  });
  const data = await res.json().catch(() => null) as
    | { id?: string; error?: MetaErrorPayload }
    | null;
  if (!res.ok || data?.error || !data?.id) {
    throw new MetaApiError(res.status, data?.error ?? null, "Не удалось загрузить видео");
  }
  return data.id;
}

/**
 * Ставит видео в обработку по публичной ссылке. Meta скачивает файл сама,
 * поэтому тело запроса остаётся маленьким и не упирается в лимиты edge-функции.
 */
export async function uploadVideoByUrl(
  adAccountId: string,
  token: string,
  fileUrl: string,
  name?: string,
): Promise<string> {
  const res = await graph<{ id?: string }>(`${adAccountId}/advideos`, {
    token,
    method: "POST",
    body: { file_url: fileUrl, ...(name ? { name } : {}) },
    timeoutMs: 120_000,
  });
  if (!res.id) throw new Error("Meta не вернула id видео");
  return res.id;
}

export interface VideoState {
  ready: boolean;
  failed: boolean;
  thumbnailUrl: string | null;
  message: string | null;
}

/** Статус обработки видео: Meta готовит его асинхронно, иногда минуты. */
export async function getVideoState(videoId: string, token: string): Promise<VideoState> {
  const res = await graph<{
    status?: { video_status?: string; processing_progress?: number; error?: { message?: string } };
    picture?: string;
  }>(videoId, { token, query: { fields: "status,picture" }, timeoutMs: 20_000 });

  const status = res.status?.video_status ?? "";
  return {
    ready: status === "ready",
    failed: status === "error",
    thumbnailUrl: res.picture ?? null,
    message: res.status?.error?.message ?? null,
  };
}

/* ────────────────────────────── страница и формы ─────────────────────── */

/** Page access token — нужен, чтобы читать лид-формы страницы. */
export async function getPageAccessToken(
  pageId: string,
  token: string,
): Promise<string | null> {
  const res = await graph<{ data?: Array<{ id?: string; access_token?: string }> }>(
    "me/accounts",
    { token, query: { limit: 100 }, timeoutMs: 20_000 },
  );
  const page = (res.data ?? []).find((p) => p.id === pageId);
  return page?.access_token ?? null;
}

/** Первая активная лид-форма страницы — фолбэк, если форма не выбрана вручную. */
export async function resolveActiveLeadForm(
  pageId: string,
  token: string,
): Promise<string | null> {
  const pageToken = await getPageAccessToken(pageId, token).catch(() => null);
  const res = await graph<{ data?: Array<{ id?: string; status?: string }> }>(
    `${pageId}/leadgen_forms`,
    { token: pageToken ?? token, query: { fields: "id,name,status", limit: 25 }, timeoutMs: 20_000 },
  );
  const forms = res.data ?? [];
  const active = forms.find((f) => f.status === "ACTIVE") ?? forms[0];
  return active?.id ?? null;
}

/* ────────────────────────────── рекламный аккаунт ────────────────────── */

/** Валюты, которые Meta считает целыми единицами — копеек у них нет. */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "CLP", "ISK", "PYG", "UGX", "RWF",
  "XAF", "XOF", "XPF", "BIF", "DJF", "GNF", "KMF", "MGA", "VUV",
]);

export interface AdAccountMoney {
  currency: string;
  /** Дробность валюты: 100 обычно, 1 для валют без копеек. */
  minorUnits: number;
  /** Минимальный дневной бюджет в единицах валюты, если Meta его сообщила. */
  minDailyBudget: number | null;
}

/**
 * Валюта кабинета. Без неё дневной бюджет уходит в Meta не в тех единицах:
 * `daily_budget` считается в минорных единицах валюты СЧЁТА, а не в центах
 * доллара.
 */
export async function getAdAccountMoney(
  adAccountId: string,
  token: string,
): Promise<AdAccountMoney> {
  const res = await graph<{
    currency?: string;
    min_daily_budget_low_freq?: string | number;
  }>(adAccountId, {
    token,
    query: { fields: "currency,min_daily_budget_low_freq" },
    timeoutMs: 20_000,
  });
  const currency = String(res.currency ?? "USD").toUpperCase();
  const minorUnits = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
  const minMinor = Number(res.min_daily_budget_low_freq ?? 0);
  return {
    currency,
    minorUnits,
    minDailyBudget: minMinor > 0 ? minMinor / minorUnits : null,
  };
}

/* ────────────────────────────── сущности рекламы ─────────────────────── */

export async function createCampaign(
  adAccountId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await graph<{ id?: string }>(`${adAccountId}/campaigns`, {
    token,
    method: "POST",
    body,
  });
  if (!res.id) throw new Error("Meta не вернула id кампании");
  return res.id;
}

export async function createAdSet(
  adAccountId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await graph<{ id?: string }>(`${adAccountId}/adsets`, {
    token,
    method: "POST",
    body,
  });
  if (!res.id) throw new Error("Meta не вернула id группы объявлений");
  return res.id;
}

export async function createAdCreative(
  adAccountId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await graph<{ id?: string }>(`${adAccountId}/adcreatives`, {
    token,
    method: "POST",
    body,
  });
  if (!res.id) throw new Error("Meta не вернула id креатива");
  return res.id;
}

export async function createAd(
  adAccountId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await graph<{ id?: string }>(`${adAccountId}/ads`, {
    token,
    method: "POST",
    body,
  });
  if (!res.id) throw new Error("Meta не вернула id объявления");
  return res.id;
}

/** Живые группы кампании — по ним считаем индекс новой группы (g1, g2, …). */
export async function countLiveAdSets(
  campaignId: string,
  token: string,
): Promise<number> {
  const res = await graph<{ data?: Array<{ effective_status?: string }> }>(
    `${campaignId}/adsets`,
    { token, query: { fields: "id,effective_status", limit: 200 }, timeoutMs: 30_000 },
  );
  return (res.data ?? []).filter((a) =>
    a.effective_status !== "DELETED" && a.effective_status !== "ARCHIVED"
  ).length;
}

/**
 * Существует ли кампания и жива ли она — страховка от устаревшей записи в БД.
 *
 * Временные сбои пробрасываем наверх: посчитать кампанию мёртвой из-за
 * сетевой ошибки значит создать её дубль в кабинете. «Не жива» отвечаем
 * только на окончательный ответ Meta (объект удалён или недоступен).
 */
export async function campaignIsLive(
  campaignId: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await graph<{ effective_status?: string }>(campaignId, {
      token,
      query: { fields: "id,effective_status" },
      timeoutMs: 20_000,
    });
    const st = res.effective_status ?? "";
    return st !== "DELETED" && st !== "ARCHIVED";
  } catch (e) {
    if (e instanceof MetaApiError && !e.transient) return false;
    throw e;
  }
}
