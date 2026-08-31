// Сборка промпта и разбор ответа модели для Контент-завода.
//
// Порт логики n8n: нода «image» (Set) собирала контекст из тела вебхука,
// ветка Switch1 подставляла его в свой промпт, а нода «Parse Strategy v3.0»
// вытаскивала из ответа модели список слайдов. Модель регулярно отвечает
// с ```json-обёрткой, висячими запятыми и разными именами массива — поэтому
// парсер здесь такой же терпимый, как в оригинале.
//
// Чистые функции — покрыты src/test/contentFactoryGen.test.ts.

import { promptForContentType } from "./contentFactoryPrompts.ts";

export interface GenerationSlide {
  slide_number: number;
  slide_type: string;
  image_prompt: string;
  aspect_ratio: string;
}

/** Поля тела вебхука, которые нода «image» отдавала в промпт. */
const CONTEXT_KEYS = [
  "name",
  "description",
  "prompt",
  "content_type",
  "style",
  "color",
  "language",
  "aspect",
  "platform",
  "slides",
  "ctas",
  "fb_niche",
  "chat_id",
] as const;

/**
 * all_data — весь бриф JSON-ом без служебных полей.
 * Список исключений взят из ноды «image» n8n: эти ключи не несут смысла для
 * модели и только сбивают её.
 */
const ALL_DATA_SKIP = new Set([
  "slug",
  "chat_id",
  "telegram_id",
  "session_id",
  "request_id",
  "timestamp",
]);

export function buildAllData(body: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (ALL_DATA_SKIP.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    clean[key] = value;
  }
  return JSON.stringify(clean);
}

export interface PromptContext {
  image_analysis: string;
  text_analysis: string;
  site_data: string;
}

/**
 * Подстановка {{token}}. Неизвестный или пустой токен заменяется пустой
 * строкой — в n8n отсутствующее выражение давало то же самое, и промпт
 * не должен ломаться из-за незаполненного поля брифа.
 */
export function renderPrompt(
  template: string,
  body: Record<string, unknown>,
  context: Partial<PromptContext> = {},
): string {
  const values: Record<string, string> = {
    all_data: buildAllData(body),
    image_analysis: context.image_analysis ?? "",
    text_analysis: context.text_analysis ?? "",
    site_data: context.site_data ?? "",
  };
  for (const key of CONTEXT_KEYS) {
    const raw = body?.[key];
    values[key] = raw === null || raw === undefined
      ? ""
      : (typeof raw === "object" ? JSON.stringify(raw) : String(raw));
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => values[key] ?? "");
}

/** Промпт ветки с уже подставленным контекстом. */
export function buildBranchPrompt(
  body: Record<string, unknown>,
  context: Partial<PromptContext> = {},
): string {
  const contentType = typeof body?.content_type === "string" ? body.content_type : "";
  return renderPrompt(promptForContentType(contentType), body, context);
}

// ============================================================
// Разбор ответа модели (порт «Parse Strategy v3.0»)
// ============================================================

/** Снимает ```json-обёртку и обрезает всё вне внешних фигурных скобок. */
export function cleanJsonBlock(raw: string): string {
  let str = typeof raw === "string" ? raw : JSON.stringify(raw);
  str = str.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  const first = str.indexOf("{");
  const last = str.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) str = str.substring(first, last + 1);
  return str.trim();
}

/** Разбор с одной попыткой починки: висячие запятые модель ставит регулярно. */
export function parseJsonSafe(raw: string): Record<string, unknown> | null {
  const cleaned = cleanJsonBlock(raw);
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(cleaned.replace(/,\s*([\]}])/g, "$1")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/**
 * Массив слайдов лежит под разными именами в зависимости от ветки промпта —
 * список тот же, что перебирал n8n.
 */
const SLIDE_KEYS = ["slides", "creatives", "thumbnails", "ads_creatives", "images"];

function extractSlides(parsed: Record<string, unknown>): Array<Record<string, unknown>> {
  for (const key of SLIDE_KEYS) {
    const value = parsed[key];
    if (Array.isArray(value) && value.length) return value as Array<Record<string, unknown>>;
  }
  // Ответ про один слайд приходит плоским объектом.
  if (parsed.image_prompt) return [parsed];
  return [];
}

/**
 * Ответ модели → слайды к генерации.
 * `fallbackAspect` — аспект из брифа: если модель его не вернула, кадр всё
 * равно должен получиться нужного формата.
 */
export function parseStrategy(
  raw: string,
  fallbackAspect = "4:5",
  limit = 10,
): GenerationSlide[] {
  const parsed = parseJsonSafe(raw);
  if (!parsed) return [];

  return extractSlides(parsed)
    .slice(0, Math.max(1, limit))
    .map((slide, index) => {
      const promptRaw = slide.image_prompt ?? slide.prompt ?? slide.description ?? "";
      const image_prompt = typeof promptRaw === "string"
        ? promptRaw.trim()
        : JSON.stringify(promptRaw);
      const num = Number(slide.slide_number);
      return {
        slide_number: Number.isFinite(num) && num > 0 ? Math.round(num) : index + 1,
        slide_type: typeof slide.slide_type === "string" ? slide.slide_type : "slide",
        image_prompt,
        aspect_ratio: typeof slide.aspect_ratio === "string" && slide.aspect_ratio.trim()
          ? slide.aspect_ratio.trim()
          : fallbackAspect,
      };
    })
    .filter((s) => s.image_prompt.length > 0);
}

/**
 * Финальный промпт кадра — как собирала нода «Prepare Final Payload»:
 * JSON слайда плюс технический блок с аспектом и требованием держать
 * товар консистентным с референсами.
 */
export function buildSlidePrompt(slide: GenerationSlide, referenceCount: number): string {
  const slideJson = JSON.stringify(
    {
      slide_number: slide.slide_number,
      slide_type: slide.slide_type,
      image_prompt: slide.image_prompt,
      aspect_ratio: slide.aspect_ratio,
      imageSize: "1K",
    },
    null,
    2,
  );
  const referenceLine = referenceCount > 0
    ? "- Use the attached reference images to maintain product consistency"
    : "- No reference images provided, generate from the description alone";
  return `${slideJson}

[TECHNICAL REQUIREMENTS]
- Aspect Ratio: ${slide.aspect_ratio}
${referenceLine}
- Generate high quality professional image`;
}
