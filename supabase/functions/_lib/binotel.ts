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
 * Номер для Binotel: только цифры. Украинские номера АТС отдаёт как 0XXXXXXXXX,
 * из CRM же приходит +380XXXXXXXXX — приводим к национальному формату.
 */
export function toBinotelPhone(raw: string): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("380") && d.length === 12) d = `0${d.slice(3)}`;
  return d;
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
