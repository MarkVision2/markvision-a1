// Клиент Google Gemini REST для Контент-завода.
//
// Воспроизводит ровно то, что делал n8n: анализ референсного фото
// (models/gemini-pro-latest), текстовая стратегия слайдов и генерация
// изображений через gemini-3-pro-image-preview с responseModalities
// ["TEXT","IMAGE"] — картинка приходит base64 в inline_data.
//
// Ключ — GEMINI_API_KEY (в n8n это была credential googlePalmApi).
//
// Чистые функции разбора ответа покрыты src/test/gemini.test.ts: именно они
// ломаются молча, когда модель отвечает не в том формате.

import {
  base64ToBytes,
  blockReasonOf,
  buildImageRequest,
  type GeminiPart,
  imageOf,
  partsOf,
  textOf,
} from "./geminiParse.ts";

// Реэкспорт, чтобы вызывающий код брал всё из одного места.
export { base64ToBytes, blockReasonOf, buildImageRequest, imageOf, partsOf, textOf };
export type { GeminiPart };

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Модель генерации изображений — та же, что стояла в n8n. */
export const IMAGE_MODEL = "gemini-3-pro-image-preview";
/** Модель для анализа фото и текстовых цепочек. */
export const TEXT_MODEL = "gemini-pro-latest";

export interface GeminiResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  /** true — ошибка временная, задание стоит повторить. */
  retryable: boolean;
}

export function hasGeminiKey(): boolean {
  return Boolean(Deno.env.get("GEMINI_API_KEY"));
}

/** Сырой вызов generateContent. */
async function generateContent(
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<GeminiResult<Record<string, unknown>>> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    return { ok: false, data: null, error: "Не задан GEMINI_API_KEY", retryable: false };
  }
  try {
    const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) {
      const message = ((json?.error as { message?: string } | undefined)?.message)
        ?? `HTTP ${res.status}`;
      // 429 и 5xx — перегрузка на стороне Google, имеет смысл повторить.
      // 400/403 — битый запрос или ключ, повтор не поможет.
      return {
        ok: false,
        data: null,
        error: message,
        retryable: res.status === 429 || res.status >= 500,
      };
    }
    return { ok: true, data: json ?? {}, error: null, retryable: false };
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: (e as Error)?.message ?? "network error",
      retryable: true,
    };
  }
}

// ============================================================
// Операции
// ============================================================

/** Текстовая генерация — стратегия слайдов по промпту ветки. */
export async function geminiText(
  prompt: string,
  timeoutMs = 120_000,
): Promise<GeminiResult<string>> {
  const res = await generateContent(
    TEXT_MODEL,
    { contents: [{ parts: [{ text: prompt }] }] },
    timeoutMs,
  );
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
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  }
  const res = await generateContent(TEXT_MODEL, { contents: [{ parts }] }, timeoutMs);
  if (!res.ok) return { ...res, data: null };
  return { ok: true, data: textOf(res.data), error: null, retryable: false };
}

export async function geminiImage(
  prompt: string,
  references: Array<{ data: string; mime: string }>,
  timeoutMs = 180_000,
): Promise<GeminiResult<{ data: string; mime: string }>> {
  const res = await generateContent(
    IMAGE_MODEL,
    buildImageRequest(prompt, references),
    timeoutMs,
  );
  if (!res.ok) return { ...res, data: null };

  const image = imageOf(res.data);
  if (!image) {
    const blocked = blockReasonOf(res.data);
    return {
      ok: false,
      data: null,
      // Отказ фильтра повторять бессмысленно — промпт не изменится сам.
      error: blocked
        ? `Модель не сгенерировала изображение: ${blocked}`
        : "Модель вернула ответ без изображения",
      retryable: !blocked,
    };
  }
  return { ok: true, data: image, error: null, retryable: false };
}
