// Разбор ответов Gemini и сборка тела запроса на генерацию.
//
// Вынесено из gemini.ts отдельным модулем без обращений к Deno: именно эти
// функции ломаются тихо (картинка приходит base64 внутри inline_data, ключи
// бывают в двух регистрах), поэтому их держим под тестами —
// src/test/gemini.test.ts.

export interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  inlineData?: { mimeType: string; data: string };
}

// ============================================================
// Разбор ответа (чистые функции)
// ============================================================

/** Все части первого кандидата, в каком бы регистре ключей ни пришёл ответ. */
export function partsOf(response: Record<string, unknown> | null): GeminiPart[] {
  const candidates = (response?.candidates as Array<Record<string, unknown>> | undefined) ?? [];
  const content = candidates[0]?.content as Record<string, unknown> | undefined;
  const parts = (content?.parts as GeminiPart[] | undefined) ?? [];
  return Array.isArray(parts) ? parts : [];
}

/** Склеенный текст ответа. */
export function textOf(response: Record<string, unknown> | null): string {
  return partsOf(response)
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Первая картинка ответа: base64 + mime. Ключи бывают snake_case и camelCase. */
export function imageOf(
  response: Record<string, unknown> | null,
): { data: string; mime: string } | null {
  for (const part of partsOf(response)) {
    const inline = part.inline_data ?? null;
    if (inline?.data) return { data: inline.data, mime: inline.mime_type || "image/png" };
    const camel = part.inlineData ?? null;
    if (camel?.data) return { data: camel.data, mime: camel.mimeType || "image/png" };
  }
  return null;
}

/** Причина, по которой модель не отдала картинку (блокировка фильтром и т.п.). */
export function blockReasonOf(response: Record<string, unknown> | null): string | null {
  const feedback = response?.promptFeedback as { blockReason?: string } | undefined;
  if (feedback?.blockReason) return String(feedback.blockReason);
  const candidates = (response?.candidates as Array<Record<string, unknown>> | undefined) ?? [];
  const finish = candidates[0]?.finishReason;
  if (typeof finish === "string" && finish !== "STOP" && finish !== "MAX_TOKENS") return finish;
  return null;
}

/** base64 → байты для заливки в Storage. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Генерация изображения. Тело собирается как в ноде n8n «Prepare Final Payload»:
 * сначала текст, затем все референсные картинки как inline_data.
 */
export function buildImageRequest(
  prompt: string,
  references: Array<{ data: string; mime: string }>,
): Record<string, unknown> {
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const ref of references) {
    parts.push({
      inline_data: {
        mime_type: ref.mime || "image/jpeg",
        data: ref.data.replace(/^data:[^;]+;base64,/, ""),
      },
    });
  }
  return {
    contents: [{ parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  };
}

// ============================================================
// Ответы OpenAI-совместимого шлюза (Lovable AI Gateway)
// ============================================================
// Шлюз проксирует те же модели Google, но отвечает в формате OpenAI.
// Где именно лежит картинка, зависит от версии шлюза, поэтому проверяем
// все правдоподобные места: молчаливый промах здесь означает «генерация
// прошла, а кадра нет».

/** Текст ответа chat/completions. */
export function textFromChatResponse(response: Record<string, unknown> | null): string {
  const choices = (response?.choices as Array<Record<string, unknown>> | undefined) ?? [];
  const message = choices[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  // Мультимодальный ответ приходит массивом частей.
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = part as Record<string, unknown>;
        return typeof p?.text === "string" ? p.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

/** base64 и mime из data-URL вида data:image/png;base64,XXXX */
export function parseDataUrl(value: string): { data: string; mime: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec((value ?? "").trim());
  if (!m) return null;
  return { mime: m[1] || "image/png", data: m[2] };
}

/**
 * Картинка из ответа шлюза. Проверяются, по убыванию вероятности:
 *   message.images[].image_url.url  — так отдаёт Lovable AI Gateway;
 *   message.content[] с частью image_url — мультимодальный формат OpenAI;
 *   data:-URL прямо в тексте ответа — запасной вариант.
 */
export function imageFromChatResponse(
  response: Record<string, unknown> | null,
): { data: string; mime: string } | null {
  const choices = (response?.choices as Array<Record<string, unknown>> | undefined) ?? [];
  const message = choices[0]?.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const urlOf = (node: unknown): string => {
    if (typeof node === "string") return node;
    const obj = node as Record<string, unknown> | null;
    const nested = obj?.image_url ?? obj?.imageUrl;
    if (typeof nested === "string") return nested;
    const url = (nested as Record<string, unknown> | undefined)?.url ?? obj?.url;
    return typeof url === "string" ? url : "";
  };

  const images = message.images;
  if (Array.isArray(images)) {
    for (const item of images) {
      const parsed = parseDataUrl(urlOf(item));
      if (parsed) return parsed;
    }
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const p = part as Record<string, unknown>;
      if (p?.type === "image_url" || p?.image_url) {
        const parsed = parseDataUrl(urlOf(p));
        if (parsed) return parsed;
      }
    }
  }

  const text = textFromChatResponse(response);
  const match = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i.exec(text);
  return match ? parseDataUrl(match[0]) : null;
}

// ============================================================
// Разбор ошибок квоты
// ============================================================

export interface QuotaVerdict {
  /** Повторять ли задание. */
  retryable: boolean;
  /** Текст для человека — на нём заканчивается разбирательство. */
  message: string;
}

/**
 * 429 бывает двух совершенно разных видов, и путать их дорого:
 *
 *   — обычный rate limit: слишком часто дёргаем, через минуту всё пройдёт;
 *   — free tier с лимитом 0: модель на бесплатном плане недоступна вообще.
 *     Ретраи тут бесполезны — задание будет полчаса тыкаться и упадёт
 *     с английским текстом Google, из которого непонятно, что делать.
 *
 * Второй случай определяем по «limit: 0» и упоминанию free tier в ответе.
 */
export function classifyQuotaError(
  body: Record<string, unknown> | null,
  rawMessage: string,
  model: string,
): QuotaVerdict {
  const text = JSON.stringify(body ?? {}) + " " + rawMessage;
  const freeTier = /free_tier|FreeTier/i.test(text);
  const zeroLimit = /limit:\s*0\b/i.test(text);

  if (freeTier && zeroLimit) {
    return {
      retryable: false,
      message:
        `Модель ${model} недоступна на бесплатном плане Google (квота 0). ` +
        "Включите оплату в Google AI Studio для проекта этого ключа " +
        "или укажите более доступную модель в CONTENT_FACTORY_IMAGE_MODEL.",
    };
  }
  if (freeTier) {
    return {
      retryable: true,
      message: `Исчерпана бесплатная квота Google для ${model} — повторим позже`,
    };
  }
  return {
    retryable: true,
    message: rawMessage || "Google временно ограничил запросы — повторим позже",
  };
}
