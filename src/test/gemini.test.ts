/**
 * Разбор ответа Gemini.
 *
 * Картинка приходит base64 внутри inline_data, и ключи бывают в двух
 * регистрах — snake_case в REST и camelCase в некоторых ответах. Если
 * промахнуться, генерация «успешна», но кадра нет, и пользователь видит
 * пустую карточку без объяснения.
 */
import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  blockReasonOf,
  classifyQuotaError,
  buildImageRequest,
  imageFromChatResponse,
  imageOf,
  parseDataUrl,
  partsOf,
  textFromChatResponse,
  textOf,
} from "../../supabase/functions/_lib/geminiParse.ts";

const withParts = (parts: unknown[]) => ({ candidates: [{ content: { parts } }] });

describe("partsOf / textOf", () => {
  it("склеивает текстовые части", () => {
    expect(textOf(withParts([{ text: "первая" }, { text: "вторая" }]))).toBe("первая\nвторая");
  });

  it("пустой или битый ответ не роняет разбор", () => {
    expect(textOf(null)).toBe("");
    expect(textOf({})).toBe("");
    expect(partsOf({ candidates: [] })).toEqual([]);
    expect(partsOf({ candidates: [{ content: { parts: "не массив" } }] })).toEqual([]);
  });
});

describe("imageOf", () => {
  it("находит картинку в snake_case", () => {
    const res = imageOf(withParts([
      { text: "описание" },
      { inline_data: { mime_type: "image/png", data: "AAAA" } },
    ]));
    expect(res).toEqual({ data: "AAAA", mime: "image/png" });
  });

  it("находит картинку в camelCase", () => {
    const res = imageOf(withParts([{ inlineData: { mimeType: "image/jpeg", data: "BBBB" } }]));
    expect(res).toEqual({ data: "BBBB", mime: "image/jpeg" });
  });

  it("без mime подставляет png, а не undefined", () => {
    expect(imageOf(withParts([{ inline_data: { mime_type: "", data: "CC" } }]))?.mime).toBe("image/png");
  });

  it("ответ без картинки даёт null", () => {
    expect(imageOf(withParts([{ text: "только текст" }]))).toBeNull();
    expect(imageOf(null)).toBeNull();
  });
});

describe("blockReasonOf", () => {
  it("видит блокировку фильтром", () => {
    expect(blockReasonOf({ promptFeedback: { blockReason: "SAFETY" } })).toBe("SAFETY");
  });

  it("видит нештатный finishReason", () => {
    expect(blockReasonOf({ candidates: [{ finishReason: "RECITATION" }] })).toBe("RECITATION");
  });

  it("нормальное завершение не считается блокировкой", () => {
    expect(blockReasonOf({ candidates: [{ finishReason: "STOP" }] })).toBeNull();
    expect(blockReasonOf({ candidates: [{ finishReason: "MAX_TOKENS" }] })).toBeNull();
    expect(blockReasonOf(null)).toBeNull();
  });
});

describe("buildImageRequest", () => {
  it("текст идёт первым, референсы следом — как в ноде n8n", () => {
    const req = buildImageRequest("промпт", [
      { data: "AAA", mime: "image/jpeg" },
      { data: "BBB", mime: "image/png" },
    ]);
    const parts = (req.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0].parts;
    expect(parts[0]).toEqual({ text: "промпт" });
    expect(parts).toHaveLength(3);
    expect(req.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
  });

  it("срезает префикс data-URL у референса", () => {
    const req = buildImageRequest("p", [{ data: "data:image/png;base64,ZZZ", mime: "image/png" }]);
    const parts = (req.contents as Array<{ parts: Array<{ inline_data?: { data: string } }> }>)[0].parts;
    expect(parts[1].inline_data?.data).toBe("ZZZ");
  });

  it("без референсов остаётся один текстовый блок", () => {
    const req = buildImageRequest("p", []);
    expect((req.contents as Array<{ parts: unknown[] }>)[0].parts).toHaveLength(1);
  });
});

describe("base64ToBytes", () => {
  it("декодирует и с префиксом data-URL, и без него", () => {
    expect(Array.from(base64ToBytes("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(base64ToBytes("data:image/png;base64,AQID"))).toEqual([1, 2, 3]);
  });
});

describe("ответы OpenAI-совместимого шлюза", () => {
  const chat = (message: Record<string, unknown>) => ({ choices: [{ message }] });

  it("берёт текст из строкового content", () => {
    expect(textFromChatResponse(chat({ content: "  ответ  " }))).toBe("ответ");
  });

  it("берёт текст из мультимодального content", () => {
    expect(textFromChatResponse(chat({
      content: [{ type: "text", text: "первая" }, { type: "text", text: "вторая" }],
    }))).toBe("первая\nвторая");
  });

  it("пустой ответ не роняет разбор", () => {
    expect(textFromChatResponse(null)).toBe("");
    expect(textFromChatResponse({ choices: [] })).toBe("");
  });

  it("разбирает data-URL", () => {
    expect(parseDataUrl("data:image/jpeg;base64,QUJD")).toEqual({
      mime: "image/jpeg",
      data: "QUJD",
    });
    expect(parseDataUrl("https://example.com/x.jpg")).toBeNull();
    expect(parseDataUrl("")).toBeNull();
  });

  it("находит картинку в message.images — так отдаёт шлюз", () => {
    const res = imageFromChatResponse(chat({
      images: [{ image_url: { url: "data:image/png;base64,AAA" } }],
    }));
    expect(res).toEqual({ mime: "image/png", data: "AAA" });
  });

  it("находит картинку в мультимодальном content", () => {
    const res = imageFromChatResponse(chat({
      content: [
        { type: "text", text: "вот кадр" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB" } },
      ],
    }));
    expect(res).toEqual({ mime: "image/jpeg", data: "BBB" });
  });

  it("подбирает data-URL прямо из текста — запасной вариант", () => {
    const res = imageFromChatResponse(chat({
      content: "готово: data:image/png;base64,CCC=",
    }));
    expect(res?.data).toBe("CCC=");
  });

  it("ответ без картинки даёт null, а не пустую строку", () => {
    expect(imageFromChatResponse(chat({ content: "не смог" }))).toBeNull();
    expect(imageFromChatResponse(null)).toBeNull();
  });
});

describe("classifyQuotaError", () => {
  const freeTierZero = {
    error: {
      code: 429,
      message: "You exceeded your current quota. Quota exceeded for metric: " +
        "generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, " +
        "limit: 0, model: gemini-3-pro-image",
      details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
    },
  };

  it("квота 0 на бесплатном плане — не ретраить, объяснить человеку", () => {
    const v = classifyQuotaError(freeTierZero, freeTierZero.error.message, "gemini-3-pro-image-preview");
    expect(v.retryable).toBe(false);
    expect(v.message).toContain("бесплатном плане");
    expect(v.message).toContain("gemini-3-pro-image-preview");
  });

  it("исчерпанная бесплатная квота — повторить позже", () => {
    const body = {
      error: {
        message: "Quota exceeded for generate_content_free_tier_requests, limit: 50",
        details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
      },
    };
    const v = classifyQuotaError(body, body.error.message, "m");
    expect(v.retryable).toBe(true);
  });

  it("обычный rate limit остаётся повторяемым и сохраняет текст", () => {
    const v = classifyQuotaError({}, "Too many requests", "m");
    expect(v.retryable).toBe(true);
    expect(v.message).toBe("Too many requests");
  });

  it("пустой ответ не роняет разбор", () => {
    const v = classifyQuotaError(null, "", "m");
    expect(v.retryable).toBe(true);
    expect(v.message.length).toBeGreaterThan(0);
  });
});
