/**
 * Контент-конвейер: чистая логика без сети и БД.
 *
 * Здесь живёт всё, что должно быть предсказуемым и покрытым тестами:
 * машина состояний запуска, правила повторов и backoff, валидация сценария,
 * подпись закрытого callback (HMAC + timestamp + nonce), маскирование секретов
 * в ошибках, безопасные тексты для пользователя, оценка стоимости и защита
 * загрузчика от SSRF. Edge-функция content-pipeline и n8n опираются на эти
 * контракты; тесты — src/test/contentPipeline.test.ts.
 */

/* ───────────────────────────── состояния ───────────────────────────── */

export const RUN_STATES = [
  "queued",
  "claimed",
  "script_generating",
  "script_ready",
  "video_requested",
  "video_rendering",
  "video_ready",
  "normalizing",
  "awaiting_review",
  "approved",
  "rejected",
  "retry_wait",
  "failed",
  "cancelled",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const ITEM_STATUSES = ["idea", "in_progress", "ready", "published", "failed", "cancelled"] as const;
export type PipelineItemStatus = (typeof ITEM_STATUSES)[number];

/** Этапы, после которых запуск завершён и тему можно брать заново. */
export const TERMINAL_RUN_STATES: readonly RunState[] = ["approved", "rejected", "failed", "cancelled"];

/** Этапы, на которых у провайдера уже есть платный заказ. */
export const PAID_VIDEO_STATES: readonly RunState[] = ["video_requested", "video_rendering"];

/** Этапы, на которых воркер обязан слать heartbeat. */
export const ACTIVE_RUN_STATES: readonly RunState[] = [
  "claimed",
  "script_generating",
  "script_ready",
  "video_requested",
  "video_rendering",
  "video_ready",
  "normalizing",
];

export const ALLOWED_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  queued: ["claimed", "cancelled"],
  claimed: ["script_generating", "script_ready", "video_requested", "video_rendering", "video_ready", "retry_wait", "failed", "cancelled"],
  script_generating: ["script_ready", "retry_wait", "failed", "cancelled"],
  script_ready: ["video_requested", "retry_wait", "failed", "cancelled"],
  video_requested: ["video_rendering", "video_ready", "retry_wait", "failed", "cancelled"],
  video_rendering: ["video_rendering", "video_ready", "retry_wait", "failed", "cancelled"],
  video_ready: ["normalizing", "retry_wait", "failed", "cancelled"],
  normalizing: ["awaiting_review", "retry_wait", "failed", "cancelled"],
  awaiting_review: ["approved", "rejected", "cancelled"],
  approved: [],
  rejected: [],
  retry_wait: ["claimed", "failed", "cancelled"],
  failed: [],
  cancelled: [],
};

export function isRunState(value: unknown): value is RunState {
  return typeof value === "string" && (RUN_STATES as readonly string[]).includes(value);
}

export function canTransition(from: RunState, to: RunState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Пользовательский статус темы, который соответствует техническому этапу. */
export function itemStatusForRunState(state: RunState): PipelineItemStatus {
  switch (state) {
    case "queued":
      return "idea";
    case "awaiting_review":
    case "approved":
      return "ready";
    case "rejected":
      // Отклонение = новая попытка: тема возвращается в очередь.
      return "idea";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "in_progress";
  }
}

export const RUN_STATE_LABELS: Record<RunState, string> = {
  queued: "В очереди",
  claimed: "Взято в работу",
  script_generating: "Пишем сценарий",
  script_ready: "Сценарий готов",
  video_requested: "Видео заказано",
  video_rendering: "Рендер видео",
  video_ready: "Видео получено",
  normalizing: "Нормализация",
  awaiting_review: "Ждёт согласования",
  approved: "Одобрено",
  rejected: "Отклонено",
  retry_wait: "Ждёт повтора",
  failed: "Ошибка",
  cancelled: "Отменено",
};

/* ───────────────────────────── ошибки и повторы ───────────────────────────── */

export type ErrorKind =
  | "network"
  | "server"
  | "rate_limited"
  | "validation"
  | "auth"
  | "provider_timeout"
  | "provider_failed"
  | "budget"
  | "unknown";

/** Классификация HTTP-ответа внешнего сервиса. */
export function classifyHttpStatus(status: number): ErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 504) return "provider_timeout";
  if (status >= 500) return "server";
  if (status === 400 || status === 404 || status === 409 || status === 422) return "validation";
  return "unknown";
}

/** Сеть и 5xx: 5 → 30 → 120 с. */
export const NETWORK_BACKOFF_SECONDS = [5, 30, 120] as const;

/**
 * Задержка перед повтором или null, если повторять нельзя.
 * attemptIndex — номер уже сделанной попытки (1 = первая упала).
 */
export function backoffSeconds(
  kind: ErrorKind,
  attemptIndex: number,
  retryAfterHeader?: string | null,
): number | null {
  switch (kind) {
    case "network":
    case "server":
    case "unknown":
      return attemptIndex >= 1 && attemptIndex <= NETWORK_BACKOFF_SECONDS.length
        ? NETWORK_BACKOFF_SECONDS[attemptIndex - 1]
        : null;
    case "rate_limited": {
      const ra = parseRetryAfter(retryAfterHeader);
      if (ra != null) return ra;
      return attemptIndex <= NETWORK_BACKOFF_SECONDS.length ? 60 : null;
    }
    case "provider_timeout":
      // Заказ у провайдера уже есть: retry_wait, новый заказ не создаём.
      return attemptIndex <= 3 ? 300 : null;
    case "validation":
    case "auth":
    case "budget":
    case "provider_failed":
      return null;
  }
}

export function parseRetryAfter(header?: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Math.min(3600, Number(trimmed)));
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(3600, Math.round((date - now) / 1000)));
  return null;
}

/** Коды ошибок конвейера → безопасное сообщение пользователю. */
export const USER_ERROR_MESSAGES: Record<string, string> = {
  script_invalid: "Не удалось составить сценарий по теме. Уточните описание и попробуйте снова.",
  script_provider: "Сервис генерации сценария временно недоступен. Повторите позже.",
  video_provider: "Сервис генерации видео вернул ошибку. Повторите позже.",
  video_timeout: "Генерация видео заняла слишком много времени. Попробуйте ещё раз.",
  normalize_failed: "Не удалось подготовить видеофайл. Попробуйте повторить генерацию.",
  budget_exceeded: "Исчерпан бюджет проекта на генерацию. Обратитесь к администратору.",
  stale_run: "Генерация не завершилась после нескольких попыток. Нажмите «Повторить» или измените тему.",
  auth: "Ключ внешнего сервиса недействителен. Обратитесь к администратору.",
  cancelled: "Задание отменено.",
};

export function userFacingError(code: string | null | undefined): string {
  if (code && USER_ERROR_MESSAGES[code]) return USER_ERROR_MESSAGES[code];
  return "Генерация не удалась. Попробуйте повторить позже.";
}

/**
 * Маскирование секретов в технических сообщениях: ключи, токены, JWT,
 * заголовки авторизации и токены Telegram-ботов не должны попадать в БД,
 * execution data n8n и Telegram-уведомления.
 */
export function maskSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?\S+/gi, "$1***")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, "$1-***")
    .replace(/\bbot\d{6,}:[A-Za-z0-9_-]{20,}/g, "bot***")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "***jwt***")
    .replace(/(["']?(?:api[_-]?key|x-api-key|apikey|token|secret|password|service_role_key)["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi, "$1***")
    .replace(/(sb_(?:secret|publishable)_)[A-Za-z0-9_-]+/g, "$1***");
}

/** Обрезать техническое сообщение до разумной длины. */
export function safeTechMessage(err: unknown, limit = 1500): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
  return maskSecrets(raw).slice(0, limit);
}

/* ───────────────────────────── сценарий ───────────────────────────── */

export interface ScriptDraft {
  hook: string;
  script: string;
  title: string;
  description: string;
  hashtags: string[];
}

export interface ScriptLimits {
  wordsMin: number;
  wordsMax: number;
  forbiddenPhrases?: string[];
}

export interface ScriptValidation {
  ok: boolean;
  errors: string[];
  value: ScriptDraft | null;
  words: number;
}

export const SCRIPT_JSON_SCHEMA = {
  name: "reels_script",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["hook", "script", "title", "description", "hashtags"],
    properties: {
      hook: { type: "string", description: "Первые 1–2 фразы, цепляющие внимание." },
      script: { type: "string", description: "Полный текст озвучки, включая hook." },
      title: { type: "string" },
      description: { type: "string" },
      hashtags: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 15 },
    },
  },
} as const;

export function countWords(text: string): number {
  return (text ?? "")
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function normalizeHashtag(tag: string): string {
  const cleaned = String(tag ?? "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, "");
  return cleaned ? `#${cleaned}` : "";
}

/** Разбор ответа модели: текст → объект; принимает JSON с обвязкой ```json. */
export function parseScriptJson(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1];
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function validateScript(input: unknown, limits: ScriptLimits): ScriptValidation {
  const errors: string[] = [];
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const str = (key: keyof ScriptDraft): string => {
    const v = obj[key];
    if (typeof v !== "string" || !v.trim()) {
      errors.push(`поле «${key}» отсутствует или пустое`);
      return "";
    }
    return v.trim();
  };

  const hook = str("hook");
  const script = str("script");
  const title = str("title");
  const description = str("description");

  const rawTags = Array.isArray(obj.hashtags) ? obj.hashtags : [];
  if (!Array.isArray(obj.hashtags)) errors.push("поле «hashtags» должно быть массивом строк");
  const hashtags = Array.from(
    new Set(rawTags.map((t) => normalizeHashtag(String(t ?? ""))).filter(Boolean)),
  );
  if (Array.isArray(obj.hashtags) && hashtags.length < 3) errors.push("нужно минимум 3 хештега");

  const words = countWords(script);
  if (script && (words < limits.wordsMin || words > limits.wordsMax)) {
    errors.push(`длина сценария ${words} слов, допустимо ${limits.wordsMin}–${limits.wordsMax}`);
  }
  if (title.length > 120) errors.push("заголовок длиннее 120 символов");
  if (description.length > 2200) errors.push("описание длиннее 2200 символов");

  const haystack = `${hook}\n${script}\n${title}\n${description}`.toLowerCase();
  for (const phrase of limits.forbiddenPhrases ?? []) {
    const p = String(phrase ?? "").trim().toLowerCase();
    if (p && haystack.includes(p)) errors.push(`запрещённая формулировка: «${phrase}»`);
  }

  if (errors.length) return { ok: false, errors, value: null, words };
  return { ok: true, errors: [], value: { hook, script, title, description, hashtags }, words };
}

export interface ScriptPromptInput {
  projectName: string;
  businessContext?: string | null;
  topic: string;
  description?: string | null;
  wishes?: string | null;
  category?: string | null;
  language?: string | null;
  wordsMin: number;
  wordsMax: number;
  toneOfVoice?: string | null;
  forbiddenPhrases?: string[] | null;
  previousRejectionComment?: string | null;
  promptVersion?: string;
}

/** Сообщения для chat completion. Детерминированно — версия промпта в metadata. */
export function buildScriptPrompt(input: ScriptPromptInput): {
  system: string;
  user: string;
  promptVersion: string;
} {
  const lang = input.language || "ru";
  const forbidden = (input.forbiddenPhrases ?? []).map((p) => `«${p}»`).join(", ");
  const system = [
    "Ты сценарист коротких вертикальных видео (Reels) для бизнеса.",
    `Пиши на языке: ${lang}. Формат — говорящая голова, одна мысль на ролик, живой разговорный стиль.`,
    `Объём поля script: ${input.wordsMin}–${input.wordsMax} слов. Поле hook — первые 1–2 фразы, они же начинают script.`,
    "Нельзя выдумывать цены, гарантии, кейсы, цифры, имена клиентов и медицинские утверждения. Если фактов нет — говори общо.",
    input.toneOfVoice ? `Tone of voice: ${input.toneOfVoice}.` : "",
    forbidden ? `Запрещённые слова и утверждения: ${forbidden}.` : "",
    "Заголовок — до 80 символов. Описание — 2–4 предложения с призывом к действию без выдуманных обещаний. Хештеги — 5–10 штук, без пробелов.",
    "Отвечай строго JSON по схеме: hook, script, title, description, hashtags[]. Никакого текста вне JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Проект: ${input.projectName}`,
    input.businessContext ? `Контекст бизнеса: ${input.businessContext}` : "",
    input.category ? `Рубрика: ${input.category}` : "",
    `Тема: ${input.topic}`,
    input.description ? `Описание: ${input.description}` : "",
    input.wishes ? `Пожелания: ${input.wishes}` : "",
    input.previousRejectionComment
      ? `Предыдущий вариант отклонён с комментарием: «${input.previousRejectionComment}». Учти это.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user, promptVersion: input.promptVersion ?? "v5.0" };
}

/* ───────────────────────────── стоимость ───────────────────────────── */

/** Цена за 1M токенов (input, output), USD. Неизвестная модель → 0 (считаем по факту вручную). */
const OPENAI_PRICES: Record<string, [number, number]> = {
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
  "gpt-5": [1.25, 10],
  "gpt-5-mini": [0.25, 2],
  "gpt-5-nano": [0.05, 0.4],
};

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export function estimateOpenAiCostUsd(model: string, usage: TokenUsage | null | undefined): number {
  const key = Object.keys(OPENAI_PRICES).find((m) => model === m || model.startsWith(`${m}-`));
  if (!key || !usage) return 0;
  const [inP, outP] = OPENAI_PRICES[key];
  const cost = ((usage.prompt_tokens ?? 0) * inP + (usage.completion_tokens ?? 0) * outP) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** HeyGen тарифицируется за минуту готового видео; ставка — конфиг проекта/окружения. */
export function estimateHeygenCostUsd(durationSeconds: number | null | undefined, usdPerMinute: number): number {
  if (!durationSeconds || durationSeconds <= 0 || !usdPerMinute) return 0;
  return Math.round((durationSeconds / 60) * usdPerMinute * 10_000) / 10_000;
}

/* ───────────────────────────── подпись callback ───────────────────────────── */

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Строка для подписи: timestamp.nonce.body — заголовки не участвуют. */
export function callbackSigningString(timestamp: string | number, nonce: string, body: string): string {
  return `${timestamp}.${nonce}.${body}`;
}

export async function signCallback(
  secret: string,
  timestamp: string | number,
  nonce: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(callbackSigningString(timestamp, nonce, body)));
  return toHex(sig);
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface CallbackVerifyInput {
  secret: string;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  body: string;
  nowMs?: number;
  maxSkewSeconds?: number;
}

export type CallbackVerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "timestamp" | "skew" | "signature" | "nonce" };

/**
 * Проверка подписи закрытого callback. Replay по nonce решает вызывающий код
 * (таблица pipeline_callback_nonces) — здесь только формат, окно времени и HMAC.
 */
export async function verifyCallbackSignature(input: CallbackVerifyInput): Promise<CallbackVerifyResult> {
  const { secret, timestamp, nonce, signature, body } = input;
  if (!secret || !timestamp || !nonce || !signature) return { ok: false, reason: "missing" };
  if (!/^\d{10,13}$/.test(timestamp)) return { ok: false, reason: "timestamp" };
  if (nonce.length < 8 || nonce.length > 128) return { ok: false, reason: "nonce" };
  const tsMs = timestamp.length === 13 ? Number(timestamp) : Number(timestamp) * 1000;
  const now = input.nowMs ?? Date.now();
  const skew = (input.maxSkewSeconds ?? 300) * 1000;
  if (Math.abs(now - tsMs) > skew) return { ok: false, reason: "skew" };
  const expected = await signCallback(secret, timestamp, nonce, body);
  if (!timingSafeEqualHex(expected, signature.toLowerCase())) return { ok: false, reason: "signature" };
  return { ok: true };
}

export function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

/* ───────────────────────────── защита загрузчика ───────────────────────────── */

export const DEFAULT_MEDIA_ALLOWLIST = [
  "files2.heygen.ai",
  "files.heygen.ai",
  "resource2.heygen.ai",
  "resource.heygen.ai",
  "static.heygen.ai",
  "app.heygen.com",
];

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

export function isPrivateHost(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const m172 = /^172\.(\d+)\./.exec(host);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true; // CGNAT
  if (/^fc|^fd|^fe80/i.test(host)) return true; // IPv6 ULA / link-local
  if (/^::ffff:/i.test(host)) return true;
  return false;
}

export type SourceUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Источник для FFmpeg-worker: только https, только allowlist доменов
 * (точное совпадение или поддомен), никаких IP-литералов, private/loopback/
 * link-local, учётных данных и нестандартных портов.
 */
export function checkSourceUrl(raw: string, allowlist: readonly string[] = DEFAULT_MEDIA_ALLOWLIST): SourceUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && url.port !== "443") return { ok: false, reason: "port" };
  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) return { ok: false, reason: "ip_literal" };
  if (isPrivateHost(host)) return { ok: false, reason: "private_host" };
  const allowed = allowlist.some((d) => {
    const dom = d.toLowerCase().replace(/^\*\./, "");
    return host === dom || host.endsWith(`.${dom}`);
  });
  if (!allowed) return { ok: false, reason: "not_allowlisted" };
  return { ok: true, url };
}

/* ───────────────────────────── Telegram ───────────────────────────── */

export const TG_CALLBACK_PREFIX = "cp:";

export function makeCallbackData(token: string): string {
  // Лимит Telegram — 64 байта callback_data.
  return `${TG_CALLBACK_PREFIX}${token}`.slice(0, 64);
}

export function parseCallbackData(data: unknown): string | null {
  if (typeof data !== "string" || !data.startsWith(TG_CALLBACK_PREFIX)) return null;
  const token = data.slice(TG_CALLBACK_PREFIX.length);
  return /^[a-f0-9]{16,64}$/i.test(token) ? token : null;
}

export function reviewKeyboard(approveToken: string, rejectToken: string) {
  return {
    inline_keyboard: [[
      { text: "✅ Одобрить", callback_data: makeCallbackData(approveToken) },
      { text: "❌ Отклонить", callback_data: makeCallbackData(rejectToken) },
    ]],
  };
}

export function formatReviewCaption(input: {
  projectName: string;
  title: string;
  script: string;
  attempt: number;
  itemUrl?: string | null;
}): string {
  const script = input.script.length > 600 ? `${input.script.slice(0, 600)}…` : input.script;
  return [
    `🎬 ${input.projectName}: ролик на согласование (попытка ${input.attempt})`,
    `«${input.title}»`,
    "",
    script,
    input.itemUrl ? `\n${input.itemUrl}` : "",
  ]
    .join("\n")
    .slice(0, 1024); // лимит caption Telegram
}
