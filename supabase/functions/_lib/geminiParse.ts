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
