/**
 * PhoneGrid Open API — облачные Android-устройства для заведения и прогрева аккаунтов.
 *
 * Зачем: публикация идёт через официальные API площадок и устройств не требует, но
 * зарегистрировать аккаунт, прогреть его и восстановить доступ можно только с телефона
 * (docs/AUTOPOST-ARCHITECTURE.md). Open API работает с сервера, поэтому весь этот контур
 * живёт в MarkVision, а кабинет PhoneGrid открывать не нужно (docs/PHONEGRID-VS-OWN.md).
 *
 * Секреты: PHONEGRID_OPEN_API_ID (числовой) + PHONEGRID_OPEN_API_KEY. Токен живёт час,
 * поэтому держим его в памяти инстанса и обновляем заранее.
 */

const BASE = "https://api.phonegrid.com";

/** Токен переиспользуется между вызовами инстанса; обновляем за минуту до срока. */
let cachedToken: { value: string; expiresAt: number } | null = null;

export interface PhoneGridConfig {
  apiId: string;
  apiKey: string;
}

export function phonegridConfig(): PhoneGridConfig | null {
  const apiId = Deno.env.get("PHONEGRID_OPEN_API_ID") ?? "";
  const apiKey = Deno.env.get("PHONEGRID_OPEN_API_KEY") ?? "";
  return apiId && apiKey ? { apiId, apiKey } : null;
}

export async function phonegridToken(cfg: PhoneGridConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const res = await fetch(`${BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: String(cfg.apiId), client_secret: cfg.apiKey, grant_type: "client_credentials" }),
  });
  const body = await res.json().catch(() => ({}));
  if (body?.code !== 0 || !body?.data?.access_token) {
    throw new Error(`PhoneGrid /oauth2/token: ${body?.msg ?? `HTTP ${res.status}`} (code ${body?.code ?? "?"})`);
  }
  const ttl = Number(body.data.expires_in ?? 3600);
  cachedToken = { value: body.data.access_token, expiresAt: Date.now() + Math.max(ttl - 60, 60) * 1000 };
  return cachedToken.value;
}

/** Вызов Open API. Пути без префикса /api — он есть только у локального клиента. */
export async function phonegridCall<T = unknown>(cfg: PhoneGridConfig, path: string, body: unknown = {}): Promise<T> {
  const token = await phonegridToken(cfg);
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (json?.code !== 0) {
    throw new Error(`PhoneGrid ${path}: ${json?.msg ?? `HTTP ${res.status}`} (code ${json?.code ?? "?"})`);
  }
  return json.data as T;
}

export interface PhoneSummary {
  id: string;
  name: string;
  status: number;
  statusText: string;
  remark: string;
  proxyId: string | null;
  proxyIp: string | null;
  country: string | null;
}

/** 2 — выключен, 3 — загружается, 4 — работает. Остальное показываем кодом. */
export function phoneStatusText(status: number): string {
  return { 2: "выключен", 3: "загружается", 4: "работает" }[status] ?? `статус ${status}`;
}

export function summarizePhone(p: Record<string, unknown>): PhoneSummary {
  const proxy = (p.proxy ?? null) as Record<string, unknown> | null;
  const status = Number(p.envStatus ?? 0);
  return {
    id: String(p.id ?? ""),
    name: String(p.envName ?? ""),
    status,
    statusText: phoneStatusText(status),
    remark: String(p.envRemark ?? ""),
    proxyId: proxy?.id ? String(proxy.id) : (p.proxyId ? String(p.proxyId) : null),
    proxyIp: proxy?.proxyIp ? String(proxy.proxyIp) : null,
    country: (p.country as string) ?? (proxy?.country as string) ?? null,
  };
}

/**
 * Шаблоны прогрева из маркетплейса PhoneGrid и их жёсткие требования.
 *
 * Требования видны только в клиенте («Просмотр» шаблона), API их не отдаёт, а при
 * несовпадении задача падает на сервере PhoneGrid с кодом 33603, не доходя до телефона.
 * Совпадать должны версия приложения и язык; телефон при этом обязан быть ВЫКЛЮЧЕН —
 * RPA включает его сам, иначе 33309. Подробности — docs/PHONEGRID.md.
 */
export const WARMUP_TEMPLATES: Record<string, {
  templateId: number;
  title: string;
  packageName: string;
  requiredVersion: string | null;
  appVersionId: string | null;
  requiredLocale: string;
  max: { follow: number; like: number; comments: number };
}> = {
  instagram: {
    templateId: 1686892291414622,
    title: "Instagram AI account warmup",
    packageName: "com.instagram.android",
    requiredVersion: "412.0.0.35.87",
    appVersionId: "1682134957917431",
    requiredLocale: "en-US",
    max: { follow: 90, like: 90, comments: 90 },
  },
  tiktok: {
    templateId: 1686875577110812,
    title: "TikTok Account Warm-up",
    packageName: "com.zhiliaoapp.musically",
    // Версию под шаблон ещё предстоит взять из клиента: Автоматизация → Маркетплейс → Просмотр.
    requiredVersion: null,
    appVersionId: null,
    requiredLocale: "en-US",
    max: { follow: 95, like: 95, comments: 95 },
  },
};

/** Ключи параметров шаблона — человекочитаемые фразы, менять нельзя. */
const PARAM_KEYS = {
  videos: "Estimated number of videos browsed",
  follow: "Probability of following",
  like: "Probability of liking",
  comments: "Probability of viewing comments",
};

export interface WarmupPlan {
  day: number;
  ready: boolean;
  note: string;
  videos: number;
  like: number;
  follow: number;
  comments: number;
}

/**
 * План прогрева по дням. Свежий аккаунт, который сразу лайкает и подписывается, площадка
 * читает как бота, поэтому активность нарастает: сначала только просмотр, действия позже.
 * С 15-го дня аккаунт считается прогретым и подключается к контуру публикации.
 */
export function warmupPlan(day: number, platform = "instagram"): WarmupPlan {
  const d = Math.max(1, Math.floor(Number(day) || 1));
  const stage =
    d <= 2 ? { videos: [8, 14], like: 0, follow: 0, comments: 0, note: "только просмотр — аккаунт осматривается" }
    : d <= 4 ? { videos: [15, 25], like: 5, follow: 0, comments: 3, note: "появляются первые лайки" }
    : d <= 7 ? { videos: [25, 40], like: 10, follow: 3, comments: 5, note: "лайки чаще, первые подписки" }
    : d <= 14 ? { videos: [40, 70], like: 18, follow: 5, comments: 8, note: "выход на обычную активность" }
    : { videos: [60, 110], like: 22, follow: 5, comments: 10, note: "прогрет — можно подключать к публикации" };
  const [lo, hi] = stage.videos;
  const videos = lo + Math.floor(Math.random() * (hi - lo + 1));
  const jitter = (v: number) => (v === 0 ? 0 : Math.max(0, v + Math.floor(Math.random() * 5) - 2));
  const cap = WARMUP_TEMPLATES[platform]?.max ?? { follow: 90, like: 90, comments: 90 };
  return {
    day: d,
    ready: d >= 15,
    note: stage.note,
    videos,
    like: Math.min(jitter(stage.like), cap.like),
    follow: Math.min(jitter(stage.follow), cap.follow),
    comments: Math.min(jitter(stage.comments), cap.comments),
  };
}

export function warmupParameter(plan: WarmupPlan): string {
  return JSON.stringify({
    [PARAM_KEYS.videos]: plan.videos,
    [PARAM_KEYS.follow]: plan.follow,
    [PARAM_KEYS.like]: plan.like,
    [PARAM_KEYS.comments]: plan.comments,
  });
}

/** Сколько дней прогрева прошло с даты старта (первый день — 1). */
export function warmupDayFrom(startedAt: string | null, now = new Date()): number {
  if (!startedAt) return 1;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return 1;
  const days = Math.floor((now.getTime() - started.getTime()) / 86_400_000);
  return Math.max(1, days + 1);
}

/**
 * Модели облачных телефонов PhoneGrid: skuId → версия Android.
 * Значения зашиты в API и в UI не перечисляются — взяты из схемы /cloudphone/create.
 */
export const PHONE_MODELS: { skuId: string; label: string }[] = [
  { skuId: "10005", label: "Android 14" },
  { skuId: "10004", label: "Android 15" },
  { skuId: "10014", label: "Android 15A" },
  { skuId: "10013", label: "Android 13" },
  { skuId: "10002", label: "Android 12" },
];

/** Коды провайдеров прокси по схеме URL (обычные прокси; интеграции провайдеров — свои коды). */
export const PROXY_PROVIDER: Record<string, number> = { http: 0, https: 1, socks5: 2, socks5h: 2, ssh: 3 };

/** socks5://логин:пароль@хост:порт → поля /proxyInfo/add. */
export function parseProxyUrl(raw: string): {
  proxyProvider: number; proxyIp: string; proxyPort: number; username: string; password: string;
} {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(`Не разобрать прокси «${raw}». Ожидаю socks5://логин:пароль@хост:порт`);
  }
  const scheme = u.protocol.replace(":", "").toLowerCase();
  if (!(scheme in PROXY_PROVIDER)) throw new Error(`Схема ${scheme} не поддерживается: http, https, socks5, ssh`);
  const port = u.port || ({ http: "80", https: "443" } as Record<string, string>)[scheme] || "";
  if (!u.hostname || !port) throw new Error("В строке прокси нужны хост и порт");
  return {
    proxyProvider: PROXY_PROVIDER[scheme],
    proxyIp: u.hostname,
    proxyPort: Number(port),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

/** Расшифровка состояний RPA-задачи — в документации PhoneGrid описаны не все. */
export const RPA_STATE: Record<number, string> = {
  0: "ожидает запуска",
  1: "выполняется",
  2: "выполнена",
  3: "отменена",
  4: "ошибка",
  5: "останавливается",
};
