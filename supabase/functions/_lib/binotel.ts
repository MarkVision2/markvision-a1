// Тонкий клиент Binotel REST API 4.0.
//
// Авторизация: key + secret прямо в теле raw-JSON POST-запроса.
// Формат: POST https://api.binotel.com/api/4.0/<section>/<method>.json
// Ответ: { status: "success", ... } либо { status: "error", code, message }.
//
// Ключи никогда не покидают сервер — читаются из automation_settings
// service-role клиентом (колонки binotel_key / binotel_secret отозваны у authenticated).

export const BINOTEL_API_BASE = "https://api.binotel.com/api/4.0";

/** Таймаут: edge-функция умирает по wall-clock, висящий upstream съест весь бюджет. */
const DEFAULT_TIMEOUT_MS = 15_000;

export type BinotelCredentials = { key: string; secret: string };

export type BinotelResponse = Record<string, unknown> & {
  status?: string;
  code?: number | string;
  message?: string;
};

export type BinotelCallResult =
  | { ok: true; data: BinotelResponse }
  | { ok: false; error: string; code?: number | string; data?: BinotelResponse };

/** Коды ошибок Binotel — в человекочитаемый текст (см. REST API: List of errors). */
export const BINOTEL_ERRORS: Record<string, string> = {
  "102": "Метод не существует",
  "103": "Недостаточно данных",
  "104": "Некорректные данные",
  "105": "Что-то пошло не так на стороне Binotel",
  "106": "Слишком частые запросы",
  "120": "Компания отключена",
  "121": "Неверный key или secret",
  "150": "Не удаётся дозвониться на внутренний номер",
  "151": "Не удаётся дозвониться на внешний номер",
};

export function binotelErrorText(res: BinotelResponse): string {
  const code = res?.code != null ? String(res.code) : "";
  const known = BINOTEL_ERRORS[code];
  const msg = typeof res?.message === "string" ? res.message : "";
  if (known && msg) return `${known} (${code}: ${msg})`;
  if (known) return `${known} (${code})`;
  return msg || `Binotel вернул статус ${String(res?.status ?? "unknown")}`;
}

/**
 * Вызов метода Binotel REST API.
 * @param method путь вида "calls/internal-number-to-external-number"
 */
export async function binotelRequest(
  method: string,
  payload: Record<string, unknown>,
  creds: BinotelCredentials,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<BinotelCallResult> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BINOTEL_API_BASE}/${method}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, key: creds.key, secret: creds.secret }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: BinotelResponse;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, error: `Не JSON от Binotel (HTTP ${res.status}): ${text.slice(0, 200)}` };
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${binotelErrorText(data)}`, code: data.code, data };
    }
    if (data.status !== "success") {
      return { ok: false, error: binotelErrorText(data), code: data.code, data };
    }
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: ctrl.signal.aborted ? `таймаут ${timeoutMs} мс` : msg };
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Номер для Binotel: только цифры.
 * Украинскую АТС Binotel обслуживает в национальном формате (0XXXXXXXXX), а в CRM
 * номер лежит как +380XXXXXXXXX — приводим. Номера остальных стран (в т.ч. казахские
 * +7 7XX ...) отдаём как есть: там национальный формат совпадает с международным
 * без плюса.
 */
export function toBinotelPhone(raw: string): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("380") && d.length === 12) d = `0${d.slice(3)}`;
  return d;
}

/**
 * Номер клиента для записи в CRM. Binotel отдаёт украинские номера в
 * национальном формате (0XXXXXXXXX) — приводим к E.164, чтобы карточка,
 * созданная из звонка, выглядела как остальные лиды.
 */
export function toE164(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  // Казахстан / Россия: 8 700 606 88 69 — местный транковый префикс вместо +7.
  if (d.length === 11 && d.startsWith("8")) return `+7${d.slice(1)}`;
  if (d.length === 11 && d.startsWith("7")) return `+${d}`;      // 77006068869 → +77006068869
  if (d.length === 10 && d.startsWith("7")) return `+7${d}`;     // 7006068869  → +77006068869
  // Украина: 0XX XXX XX XX либо уже 380...
  if (d.length === 12 && d.startsWith("380")) return `+${d}`;
  if (d.length === 10 && d.startsWith("0")) return `+38${d}`;    // 0671234567  → +380671234567
  if (d.length === 9) return `+380${d}`;                         // 671234567   → +380671234567
  return `+${d}`;
}

/** Последние 9 цифр — общий знаменатель форматов +380XXXXXXXXX и 0XXXXXXXXX. */
export function phoneTail(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-9);
}

/** Ссылка на запись разговора живёт 15 минут — забирать сразу. */
export async function fetchCallRecordUrl(
  generalCallID: string | number,
  creds: BinotelCredentials,
): Promise<string | null> {
  const r = await binotelRequest("stats/call-record", { generalCallID: String(generalCallID) }, creds);
  if (!r.ok) return null;
  const d = r.data as Record<string, unknown>;
  const candidates = [d.url, d.link, d.recordUrl, d.record, d.callRecord, d.fileUrl];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return null;
}

// ── Разбор callDetails (apiCallCompleted) ───────────────────────────────────
// Всё ниже — чистые функции без сети и Deno API: они покрыты тестами
// (src/test/binotel.test.ts), потому и живут отдельно от тела webhook-а.

export type CallDisposition =
  | "ANSWER" | "TRANSFER" | "ONLINE" | "BUSY" | "NOANSWER" | "CANCEL"
  | "CONGESTION" | "CHANUNAVAIL" | "VM" | "VM-SUCCESS"
  | "SMS-SENDING" | "SMS-SUCCESS" | "SMS-FAILED" | "SUCCESS" | "FAILED" | string;

/** Разговор состоялся — звонок идёт в CRM как «отвечен». */
export function isAnswered(disposition: string): boolean {
  return ["ANSWER", "TRANSFER"].includes(disposition);
}

/** У таких звонков может быть запись (см. примечание к stats/call-record). */
export function isRecordable(disposition: string): boolean {
  return ["ANSWER", "TRANSFER", "VM-SUCCESS", "SUCCESS"].includes(disposition);
}

/** Человекочитаемая причина, почему звонок не состоялся. */
export function dispositionLabel(disposition: string): string {
  const map: Record<string, string> = {
    BUSY: "занято",
    NOANSWER: "нет ответа",
    CANCEL: "отменён",
    CONGESTION: "не прошёл",
    CHANUNAVAIL: "линия недоступна",
    VM: "голосовая почта без сообщения",
    "VM-SUCCESS": "голосовая почта",
    ONLINE: "в разговоре",
    FAILED: "ошибка",
  };
  return map[disposition] ?? (disposition ? disposition.toLowerCase() : "нет ответа");
}

/**
 * callDetails приходит либо объектом звонка, либо картой { <generalCallID>: {...} }
 * (как в разделе STATS). Плюс form-encoded вариант, где вложенность плоская.
 */
export function parseCallDetails(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const raw = payload?.callDetails;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if ("generalCallID" in obj || "externalNumber" in obj || "disposition" in obj) return obj;
  const first = Object.values(obj)[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    return first as Record<string, unknown>;
  }
  return null;
}

/** callType: 0 — входящий, 1 — исходящий. */
export function callDirection(callType: unknown): "in" | "out" {
  return String(callType ?? "") === "1" ? "out" : "in";
}

/** Целое число из строки/числа; всё остальное — null. */
export function toInt(v: unknown): number | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** startTime приходит в unix-секундах; на всякий случай терпим и миллисекунды. */
export function callStartedAt(startTime: unknown, now = Date.now()): string {
  const n = toInt(startTime);
  if (n == null || n <= 0) return new Date(now).toISOString();
  return new Date(n < 1e12 ? n * 1000 : n).toISOString();
}

/** Текст коммуникации в ленте лида. */
export function callContent(opts: {
  answered: boolean;
  disposition: string;
  durationSec: number | null;
  recordingArchived: boolean;
}): string {
  const lines: string[] = [];
  if (!opts.answered) lines.push(`Не дозвонились: ${dispositionLabel(opts.disposition)}`);
  if (opts.durationSec != null && opts.durationSec > 0) {
    const m = Math.floor(opts.durationSec / 60);
    const sec = opts.durationSec % 60;
    lines.push(`Длительность: ${m > 0 ? `${m} мин ${sec} с` : `${sec} с`}`);
  }
  if (opts.recordingArchived) lines.push("🎙 Запись разговора приложена");
  return lines.join("\n");
}
