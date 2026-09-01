// Доступ к моделям Google для Контент-завода — двумя путями.
//
// 1. Прямой Google API по GEMINI_API_KEY — ровно то, что делал n8n
//    (credential googlePalmApi, модель gemini-3-pro-image-preview,
//    responseModalities ["TEXT","IMAGE"], картинка base64 в inline_data).
// 2. Lovable AI Gateway по LOVABLE_API_KEY — OpenAI-совместимый шлюз,
//    который проксирует те же модели Google. Этот ключ в проекте уже есть
//    (им пользуются функции ai-rop и content-scheduler), поэтому генерация
//    работает без заведения нового секрета.
//
// Прямой ключ приоритетнее: он ближе к тому, на чём подбирались промпты.
// Модели можно переопределить переменными окружения, не трогая код, —
// preview-модели Google периодически переименовывает.
//
// Чистые функции разбора ответов — в geminiParse.ts, под тестами.

import {
  base64ToBytes,
  blockReasonOf,
  buildImageRequest,
  type GeminiPart,
  classifyQuotaError,
  imageFromChatResponse,
  imageOf,
  parseDataUrl,
  partsOf,
  textFromChatResponse,
  textOf,
} from "./geminiParse.ts";
import { hasKieKey, kieImage, type KieImageOptions } from "./kie.ts";

export {
  base64ToBytes,
  classifyQuotaError,
  blockReasonOf,
  buildImageRequest,
  imageFromChatResponse,
  imageOf,
  parseDataUrl,
  partsOf,
  textFromChatResponse,
  textOf,
};
export type { GeminiPart };

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";

/** Модель генерации изображений у прямого Google API — как в n8n. */
export const IMAGE_MODEL = Deno.env.get("CONTENT_FACTORY_IMAGE_MODEL")
  ?? "gemini-3-pro-image-preview";
/** Модель анализа и текстовых цепочек у прямого Google API. */
export const TEXT_MODEL = Deno.env.get("CONTENT_FACTORY_TEXT_MODEL")
  ?? "gemini-pro-latest";
/** Те же роли на шлюзе — там имена моделей с префиксом провайдера. */
export const GATEWAY_IMAGE_MODEL = Deno.env.get("CONTENT_FACTORY_GATEWAY_IMAGE_MODEL")
  ?? "google/gemini-2.5-flash-image-preview";
export const GATEWAY_TEXT_MODEL = Deno.env.get("CONTENT_FACTORY_GATEWAY_TEXT_MODEL")
  ?? "google/gemini-2.5-flash";

export interface GeminiResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  /** true — ошибка временная, задание стоит повторить. */
  retryable: boolean;
  /** Задача поставлена, но ещё не готова (асинхронный провайдер). */
  pending?: boolean;
  /** Идентификатор задачи у асинхронного провайдера. */
  taskId?: string;
}

export type ImageProvider = "kie" | "google" | "gateway" | null;
export type TextProvider = "google" | "gateway" | null;

/** Явное указание провайдера переменной окружения — сильнее автоподбора. */
function forced(name: string): string {
  return (Deno.env.get(name) ?? "").trim().toLowerCase();
}

/**
 * Провайдер картинок. По умолчанию: kie.ai → прямой Google → шлюз.
 *
 * kie.ai впереди намеренно: у Gemini API на бесплатном плане квота 0,
 * а кредиты Google Cloud с марта 2026 на него не распространяются, — то есть
 * ключ Google без предоплаты картинок не даст, а kie.ai даст.
 * Порядок переопределяется CONTENT_FACTORY_IMAGE_PROVIDER.
 */
export function imageProvider(): ImageProvider {
  const pick = forced("CONTENT_FACTORY_IMAGE_PROVIDER");
  if (pick === "kie" && hasKieKey()) return "kie";
  if (pick === "google" && Deno.env.get("GEMINI_API_KEY")) return "google";
  if (pick === "gateway" && Deno.env.get("LOVABLE_API_KEY")) return "gateway";

  if (hasKieKey()) return "kie";
  if (Deno.env.get("GEMINI_API_KEY")) return "google";
  if (Deno.env.get("LOVABLE_API_KEY")) return "gateway";
  return null;
}

/**
 * Провайдер текста (анализ фото и стратегия слайдов). kie.ai сюда не годится —
 * он про картинки. Переопределяется CONTENT_FACTORY_TEXT_PROVIDER: это нужно,
 * когда ключ Google задан, но без квоты, а работать должен шлюз.
 */
export function textProvider(): TextProvider {
  const pick = forced("CONTENT_FACTORY_TEXT_PROVIDER");
  if (pick === "google" && Deno.env.get("GEMINI_API_KEY")) return "google";
  if (pick === "gateway" && Deno.env.get("LOVABLE_API_KEY")) return "gateway";

  if (Deno.env.get("GEMINI_API_KEY")) return "google";
  if (Deno.env.get("LOVABLE_API_KEY")) return "gateway";
  return null;
}

export function hasImageProvider(): boolean {
  return imageProvider() !== null && textProvider() !== null;
}

/** Человекочитаемое объяснение, чего не хватает. */
export const NO_PROVIDER_MESSAGE =
  "Генерация недоступна: нужен ключ для картинок (KIE_API_KEY или GEMINI_API_KEY) " +
  "и ключ для текста (GEMINI_API_KEY или LOVABLE_API_KEY)";

function httpFailure(
  status: number,
  message: string,
  body: Record<string, unknown> | null,
  model: string,
): GeminiResult<never> {
  // 429 разбираем отдельно: «нет квоты на бесплатном плане» ретраями
  // не лечится, и человеку нужно сказать это прямо.
  if (status === 429) {
    const verdict = classifyQuotaError(body, message, model);
    return { ok: false, data: null, error: verdict.message, retryable: verdict.retryable };
  }
  return {
    ok: false,
    data: null,
    error: message,
    // 5xx — перегрузка на стороне провайдера, повтор осмыслен.
    // 400/401/403 — битый запрос или ключ, повтор не поможет.
    retryable: status >= 500,
  };
}

function networkFailure(e: unknown): GeminiResult<never> {
  return {
    ok: false,
    data: null,
    error: (e as Error)?.message ?? "network error",
    retryable: true,
  };
}

// ============================================================
// Транспорт
// ============================================================

/** Прямой вызов Google generateContent. */
async function googleCall(
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<GeminiResult<Record<string, unknown>>> {
  try {
    const res = await fetch(`${GOOGLE_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": Deno.env.get("GEMINI_API_KEY")!,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) {
      const message = ((json?.error as { message?: string } | undefined)?.message)
        ?? `HTTP ${res.status}`;
      return httpFailure(res.status, message, json, model);
    }
    return { ok: true, data: json ?? {}, error: null, retryable: false };
  } catch (e) {
    return networkFailure(e);
  }
}

interface GatewayPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

/** Вызов OpenAI-совместимого шлюза. */
async function gatewayCall(
  model: string,
  parts: GatewayPart[],
  timeoutMs: number,
  extra: Record<string, unknown> = {},
): Promise<GeminiResult<Record<string, unknown>>> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: parts }],
        ...extra,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) {
      const message = ((json?.error as { message?: string } | undefined)?.message)
        ?? `HTTP ${res.status}`;
      return httpFailure(res.status, message, json, model);
    }
    return { ok: true, data: json ?? {}, error: null, retryable: false };
  } catch (e) {
    return networkFailure(e);
  }
}

/** Референс → часть сообщения шлюза (тот же data-URL, что понимает OpenAI). */
function toGatewayImage(img: { data: string; mime: string }): GatewayPart {
  const clean = img.data.replace(/^data:[^;]+;base64,/, "");
  return { type: "image_url", image_url: { url: `data:${img.mime || "image/jpeg"};base64,${clean}` } };
}

// ============================================================
// Операции
// ============================================================

/** Текстовая генерация — стратегия слайдов по промпту ветки. */
export async function geminiText(
  prompt: string,
  timeoutMs = 120_000,
): Promise<GeminiResult<string>> {
  const provider = textProvider();
  if (!provider) {
    return { ok: false, data: null, error: NO_PROVIDER_MESSAGE, retryable: false };
  }

  if (provider === "gateway") {
    const res = await gatewayCall(GATEWAY_TEXT_MODEL, [{ type: "text", text: prompt }], timeoutMs);
    if (!res.ok) return { ...res, data: null };
    const text = textFromChatResponse(res.data);
    return text
      ? { ok: true, data: text, error: null, retryable: false }
      : { ok: false, data: null, error: "Пустой ответ модели", retryable: true };
  }

  const res = await googleCall(TEXT_MODEL, { contents: [{ parts: [{ text: prompt }] }] }, timeoutMs);
  if (!res.ok) return { ...res, data: null };
  const text = textOf(res.data);
  if (!text) {
    const blocked = blockReasonOf(res.data);
    return {
      ok: false,
      data: null,
      error: blocked ? `Модель отказалась отвечать: ${blocked}` : "Пустой ответ модели",
      retryable: !blocked,
    };
  }
  return { ok: true, data: text, error: null, retryable: false };
}

/** Анализ референсного фото: картинка + промпт → текстовое описание. */
export async function geminiVision(
  prompt: string,
  images: Array<{ data: string; mime: string }>,
  timeoutMs = 120_000,
): Promise<GeminiResult<string>> {
  const provider = textProvider();
  if (!provider) {
    return { ok: false, data: null, error: NO_PROVIDER_MESSAGE, retryable: false };
  }

  if (provider === "gateway") {
    const parts: GatewayPart[] = [{ type: "text", text: prompt }, ...images.map(toGatewayImage)];
    const res = await gatewayCall(GATEWAY_TEXT_MODEL, parts, timeoutMs);
    if (!res.ok) return { ...res, data: null };
    return { ok: true, data: textFromChatResponse(res.data), error: null, retryable: false };
  }

  const parts: GeminiPart[] = [{ text: prompt }];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  }
  const res = await googleCall(TEXT_MODEL, { contents: [{ parts }] }, timeoutMs);
  if (!res.ok) return { ...res, data: null };
  return { ok: true, data: textOf(res.data), error: null, retryable: false };
}

export interface ImageOptions {
  timeoutMs?: number;
  /** Аспект кадра — нужен kie.ai, там он задаётся отдельным полем. */
  aspect?: string;
  /** Ссылки на референсы: kie.ai принимает их URL-ами, а не байтами. */
  referenceUrls?: string[];
  /** Продолжение уже созданной задачи асинхронного провайдера. */
  taskId?: string | null;
  /** Колбэк сохранения taskId, чтобы ретрай не оплачивал генерацию дважды. */
  onTask?: KieImageOptions["onTask"];
}

/** Генерация кадра. Референсы уходят вместе с промптом — как в n8n. */
export async function geminiImage(
  prompt: string,
  references: Array<{ data: string; mime: string }>,
  options: ImageOptions = {},
): Promise<GeminiResult<{ data: string; mime: string }>> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const provider = imageProvider();
  if (!provider) {
    return { ok: false, data: null, error: NO_PROVIDER_MESSAGE, retryable: false };
  }

  if (provider === "kie") {
    // kie.ai работает по ссылкам на референсы, а не по байтам: наши картинки
    // и так лежат в публичном Storage, лишняя перекодировка не нужна.
    const res = await kieImage(prompt, options.referenceUrls ?? [], {
      taskId: options.taskId,
      onTask: options.onTask,
      deadline: Date.now() + timeoutMs,
      aspect: options.aspect,
    });
    return {
      ok: res.ok,
      data: res.data,
      error: res.error,
      retryable: res.retryable,
      pending: res.pending,
      taskId: res.taskId,
    };
  }

  if (provider === "gateway") {
    const parts: GatewayPart[] = [{ type: "text", text: prompt }, ...references.map(toGatewayImage)];
    const res = await gatewayCall(GATEWAY_IMAGE_MODEL, parts, timeoutMs, {
      modalities: ["image", "text"],
    });
    if (!res.ok) return { ...res, data: null };
    const image = imageFromChatResponse(res.data);
    return image
      ? { ok: true, data: image, error: null, retryable: false }
      : {
        ok: false,
        data: null,
        error: "Шлюз вернул ответ без изображения",
        retryable: true,
      };
  }

  const res = await googleCall(IMAGE_MODEL, buildImageRequest(prompt, references), timeoutMs);
  if (!res.ok) return { ...res, data: null };

  const image = imageOf(res.data);
  if (!image) {
    const blocked = blockReasonOf(res.data);
    return {
      ok: false,
      data: null,
      // Отказ фильтра повторять бессмысленно — промпт сам не изменится.
      error: blocked
        ? `Модель не сгенерировала изображение: ${blocked}`
        : "Модель вернула ответ без изображения",
      retryable: !blocked,
    };
  }
  return { ok: true, data: image, error: null, retryable: false };
}
