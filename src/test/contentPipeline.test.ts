/**
 * Контент-конвейер: чистая логика из supabase/functions/_lib/contentPipeline.ts.
 * Здесь то, что ломается тихо: переходы состояний, backoff, валидация
 * сценария, подпись callback и защита загрузчика от SSRF.
 */
import { describe, expect, it } from "vitest";
import {
  backoffSeconds,
  buildScriptPrompt,
  canTransition,
  checkSourceUrl,
  classifyHttpStatus,
  countWords,
  estimateHeygenCostUsd,
  estimateOpenAiCostUsd,
  formatReviewCaption,
  itemStatusForRunState,
  makeCallbackData,
  maskSecrets,
  parseCallbackData,
  parseRetryAfter,
  parseScriptJson,
  reviewKeyboard,
  RUN_STATES,
  signCallback,
  userFacingError,
  validateScript,
  verifyCallbackSignature,
} from "../../supabase/functions/_lib/contentPipeline.ts";

describe("машина состояний запуска", () => {
  it("разрешает только осмысленные переходы", () => {
    expect(canTransition("claimed", "script_generating")).toBe(true);
    expect(canTransition("script_ready", "video_requested")).toBe(true);
    expect(canTransition("video_rendering", "video_ready")).toBe(true);
    expect(canTransition("normalizing", "awaiting_review")).toBe(true);
    expect(canTransition("awaiting_review", "approved")).toBe(true);
    expect(canTransition("awaiting_review", "rejected")).toBe(true);
    // Нельзя: назад из терминальных и перепрыгивать согласование.
    expect(canTransition("approved", "awaiting_review")).toBe(false);
    expect(canTransition("failed", "claimed")).toBe(false);
    expect(canTransition("script_ready", "awaiting_review")).toBe(false);
    expect(canTransition("video_requested", "approved")).toBe(false);
  });

  it("возобновление из retry_wait — только в claimed", () => {
    expect(canTransition("retry_wait", "claimed")).toBe(true);
    expect(canTransition("retry_wait", "video_requested")).toBe(false);
  });

  it("каждый этап отображается в пользовательский статус", () => {
    for (const s of RUN_STATES) expect(itemStatusForRunState(s)).toBeTruthy();
    expect(itemStatusForRunState("awaiting_review")).toBe("ready");
    expect(itemStatusForRunState("approved")).toBe("ready");
    expect(itemStatusForRunState("rejected")).toBe("idea");
    expect(itemStatusForRunState("failed")).toBe("failed");
    expect(itemStatusForRunState("video_rendering")).toBe("in_progress");
  });
});

describe("классификация ошибок и backoff", () => {
  it("HTTP-статусы", () => {
    expect(classifyHttpStatus(429)).toBe("rate_limited");
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(503)).toBe("server");
    expect(classifyHttpStatus(422)).toBe("validation");
    expect(classifyHttpStatus(504)).toBe("provider_timeout");
  });

  it("сеть и 5xx: 5 → 30 → 120, затем стоп", () => {
    expect(backoffSeconds("server", 1)).toBe(5);
    expect(backoffSeconds("network", 2)).toBe(30);
    expect(backoffSeconds("server", 3)).toBe(120);
    expect(backoffSeconds("server", 4)).toBeNull();
  });

  it("429 уважает Retry-After, валидацию не повторяет", () => {
    expect(backoffSeconds("rate_limited", 1, "17")).toBe(17);
    expect(backoffSeconds("rate_limited", 1, null)).toBe(60);
    expect(backoffSeconds("validation", 1)).toBeNull();
    expect(backoffSeconds("auth", 1)).toBeNull();
  });

  it("provider timeout → retry_wait, а не новый заказ", () => {
    expect(backoffSeconds("provider_timeout", 1)).toBe(300);
    expect(backoffSeconds("provider_timeout", 4)).toBeNull();
  });

  it("Retry-After как дата и как секунды, с потолком в час", () => {
    const now = Date.parse("2026-09-04T10:00:00Z");
    expect(parseRetryAfter("Thu, 04 Sep 2026 10:00:45 GMT", now)).toBe(45);
    expect(parseRetryAfter("99999")).toBe(3600);
    expect(parseRetryAfter("не число")).toBeNull();
  });

  it("безопасный текст пользователю не содержит техники", () => {
    expect(userFacingError("budget_exceeded")).toMatch(/бюджет/i);
    expect(userFacingError("что-то-неизвестное")).toMatch(/повторить/i);
  });
});

describe("маскирование секретов", () => {
  it("прячет ключи, JWT, токены бота и Authorization", () => {
    const raw = [
      "Authorization: Bearer abc.def.ghi",
      "x-api-key: sk-proj-1234567890abcdef",
      "bot123456789:AAHf-abcdefghijklmnopqrstuvwxyz1234",
      "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      '{"api_key":"hg_super_secret_value"}',
      "service_role_key=sb_secret_ABCDEFGHIJKLMNOP",
    ].join("\n");
    const masked = maskSecrets(raw);
    expect(masked).not.toContain("abc.def.ghi");
    expect(masked).not.toContain("1234567890abcdef");
    expect(masked).not.toContain("AAHf-abcdefghijklmnopqrstuvwxyz1234");
    expect(masked).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    expect(masked).not.toContain("hg_super_secret_value");
    expect(masked).not.toContain("ABCDEFGHIJKLMNOP");
    expect(masked).toContain("***");
  });

  it("не трогает обычный текст ошибки", () => {
    expect(maskSecrets("HeyGen HTTP 500: internal error")).toBe("HeyGen HTTP 500: internal error");
  });
});

describe("сценарий", () => {
  const limits = { wordsMin: 90, wordsMax: 130, forbiddenPhrases: ["гарантируем результат"] };
  const words = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(" ");
  const good = {
    hook: "Вы теряете клиентов каждый день.",
    script: words(100),
    title: "Почему клиенты уходят",
    description: "Разбираем три причины. Напишите нам, если узнали себя.",
    hashtags: ["маркетинг", "#продажи", "# бизнес", "bad tag!"],
  };

  it("считает слова с кириллицей и дефисами", () => {
    expect(countWords("Как-то раз, в общем-то, было — три слова")).toBe(7);
    expect(countWords("")).toBe(0);
  });

  it("принимает валидный ответ и нормализует хештеги", () => {
    const v = validateScript(good, limits);
    expect(v.ok).toBe(true);
    expect(v.words).toBe(100);
    expect(v.value?.hashtags).toEqual(["#маркетинг", "#продажи", "#бизнес", "#badtag"]);
  });

  it("отклоняет короткий/длинный сценарий и пустые поля", () => {
    expect(validateScript({ ...good, script: words(40) }, limits).errors[0]).toMatch(/40 слов/);
    expect(validateScript({ ...good, script: words(200) }, limits).ok).toBe(false);
    const missing = validateScript({ ...good, title: "" }, limits);
    expect(missing.ok).toBe(false);
    expect(missing.errors.join()).toMatch(/title/);
  });

  it("ловит запрещённые формулировки без учёта регистра", () => {
    const v = validateScript({ ...good, description: "Мы ГАРАНТИРУЕМ результат за неделю" }, limits);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/запрещённая/);
  });

  it("требует минимум 3 хештега", () => {
    expect(validateScript({ ...good, hashtags: ["#a"] }, limits).errors.join()).toMatch(/3 хештега/);
  });

  it("разбирает JSON из текста с ```json обвязкой и мусором вокруг", () => {
    expect(parseScriptJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseScriptJson('Вот ответ: {"a":2} — готово')).toEqual({ a: 2 });
    expect(parseScriptJson("не json")).toBeNull();
    expect(parseScriptJson({ a: 3 })).toEqual({ a: 3 });
  });

  it("промпт содержит ограничения, запреты и комментарий отклонения", () => {
    const p = buildScriptPrompt({
      projectName: "Клиника",
      topic: "Отбеливание зубов",
      wordsMin: 90,
      wordsMax: 130,
      toneOfVoice: "дружелюбно",
      forbiddenPhrases: ["без боли"],
      previousRejectionComment: "слишком длинно",
      language: "ru",
    });
    expect(p.system).toMatch(/90–130 слов/);
    expect(p.system).toMatch(/«без боли»/);
    expect(p.system).toMatch(/цены, гарантии/);
    expect(p.user).toMatch(/Отбеливание зубов/);
    expect(p.user).toMatch(/слишком длинно/);
    expect(p.promptVersion).toBe("v5.0");
  });
});

describe("стоимость", () => {
  it("OpenAI по прайсу за 1M токенов, неизвестная модель → 0", () => {
    expect(estimateOpenAiCostUsd("gpt-4o-mini", { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBe(0.15);
    expect(estimateOpenAiCostUsd("gpt-4o-mini-2024-07-18", { prompt_tokens: 0, completion_tokens: 1_000_000 })).toBe(0.6);
    expect(estimateOpenAiCostUsd("какая-то-модель", { prompt_tokens: 100 })).toBe(0);
  });

  it("HeyGen — за минуту ролика", () => {
    expect(estimateHeygenCostUsd(90, 1)).toBe(1.5);
    expect(estimateHeygenCostUsd(null, 1)).toBe(0);
  });
});

describe("подпись закрытого callback", () => {
  const secret = "тестовый-секрет";
  const body = JSON.stringify({ event: "state", run_id: "r1" });

  it("подпись проверяется, чужой секрет и изменённое тело — нет", async () => {
    const ts = String(Date.now());
    const nonce = "nonce-1234567890";
    const sig = await signCallback(secret, ts, nonce, body);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyCallbackSignature({ secret, timestamp: ts, nonce, signature: sig, body })).toEqual({ ok: true });
    expect(
      await verifyCallbackSignature({ secret: "другой", timestamp: ts, nonce, signature: sig, body }),
    ).toEqual({ ok: false, reason: "signature" });
    expect(
      await verifyCallbackSignature({ secret, timestamp: ts, nonce, signature: sig, body: body + " " }),
    ).toEqual({ ok: false, reason: "signature" });
  });

  it("окно времени 5 минут и обязательные заголовки", async () => {
    const old = String(Date.now() - 10 * 60 * 1000);
    const nonce = "nonce-1234567890";
    const sig = await signCallback(secret, old, nonce, body);
    expect(await verifyCallbackSignature({ secret, timestamp: old, nonce, signature: sig, body })).toEqual({
      ok: false,
      reason: "skew",
    });
    expect(await verifyCallbackSignature({ secret, timestamp: null, nonce, signature: sig, body })).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(
      await verifyCallbackSignature({ secret, timestamp: "abc", nonce, signature: sig, body }),
    ).toEqual({ ok: false, reason: "timestamp" });
  });

  it("принимает timestamp в секундах", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce-1234567890";
    const sig = await signCallback(secret, ts, nonce, body);
    expect(await verifyCallbackSignature({ secret, timestamp: ts, nonce, signature: sig, body })).toEqual({ ok: true });
  });
});

describe("защита загрузчика FFmpeg-worker", () => {
  it("пропускает только https на allowlist-доменах HeyGen", () => {
    expect(checkSourceUrl("https://files2.heygen.ai/aws_pacific/avatar_tmp/x.mp4").ok).toBe(true);
    expect(checkSourceUrl("https://cdn.files2.heygen.ai/x.mp4").ok).toBe(true);
    expect(checkSourceUrl("http://files2.heygen.ai/x.mp4")).toEqual({ ok: false, reason: "scheme" });
    expect(checkSourceUrl("https://evil.com/x.mp4")).toEqual({ ok: false, reason: "not_allowlisted" });
    expect(checkSourceUrl("https://files2.heygen.ai.evil.com/x.mp4")).toEqual({ ok: false, reason: "not_allowlisted" });
    expect(checkSourceUrl("https://user:pw@files2.heygen.ai/x.mp4")).toEqual({ ok: false, reason: "credentials" });
    expect(checkSourceUrl("https://files2.heygen.ai:8443/x.mp4")).toEqual({ ok: false, reason: "port" });
    expect(checkSourceUrl("мусор")).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("режет private, loopback, link-local и IP-литералы даже при своём allowlist", () => {
    const allow = ["*"]; // явно разрешаем всё — SSRF-проверка всё равно должна сработать
    expect(checkSourceUrl("https://127.0.0.1/x.mp4", allow)).toEqual({ ok: false, reason: "ip_literal" });
    expect(checkSourceUrl("https://[::1]/x.mp4", allow)).toEqual({ ok: false, reason: "ip_literal" });
    expect(checkSourceUrl("https://172.18.0.1:443/x.mp4", allow)).toEqual({ ok: false, reason: "ip_literal" });
    expect(checkSourceUrl("https://localhost/x.mp4", allow)).toEqual({ ok: false, reason: "private_host" });
    expect(checkSourceUrl("https://worker.internal/x.mp4", allow)).toEqual({ ok: false, reason: "private_host" });
  });
});

describe("Telegram", () => {
  it("callback_data укладывается в 64 байта и разбирается обратно", () => {
    const token = "a".repeat(48);
    const data = makeCallbackData(token);
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
    expect(parseCallbackData(data)).toBe(token);
    expect(parseCallbackData("cp:not hex")).toBeNull();
    expect(parseCallbackData("other:abc")).toBeNull();
  });

  it("клавиатура с двумя кнопками и подпись в лимите", () => {
    const kb = reviewKeyboard("1".repeat(32), "2".repeat(32));
    expect(kb.inline_keyboard[0]).toHaveLength(2);
    const caption = formatReviewCaption({
      projectName: "Клиника",
      title: "Тест",
      script: "x".repeat(2000),
      attempt: 2,
      itemUrl: "https://app.example/marketing/content-plan/1",
    });
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toMatch(/попытка 2/);
  });
});
