// Разбор ответов kie.ai — перепродажи моделей Google (Nano Banana).
//
// API асинхронный: createTask отдаёт taskId, дальше опрашивается recordInfo,
// пока state не станет success или fail. Результат — ссылки на картинки,
// причём лежат они не полем, а JSON-строкой внутри resultJson.
//
// Форматы взяты из документации kie.ai. Проверить их запросом из этой среды
// нельзя — домен закрыт сетевой политикой, — поэтому разбор терпимый:
// проверяются оба правдоподобных места и обе формы записи. Промах здесь
// означал бы «задача выполнена, а картинки нет».
//
// Чистые функции — покрыты src/test/kieParse.test.ts.

/** Состояния задачи. waiting/queuing/generating — ещё не готово. */
export type KieState = "waiting" | "queuing" | "generating" | "success" | "fail" | "unknown";

export interface KieTaskStatus {
  state: KieState;
  /** Ссылки на готовые картинки (для success). */
  urls: string[];
  /** Текст ошибки для fail. */
  error: string | null;
  /** Прогресс 0..1, если сервис его вернул. */
  progress: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Код ответа: kie.ai кладёт его и в тело (code), и в HTTP-статус. */
export function kieCode(body: Record<string, unknown> | null): number | null {
  const code = body?.code;
  if (typeof code === "number") return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return null;
}

/** Сообщение об ошибке из тела ответа. */
export function kieMessage(body: Record<string, unknown> | null): string {
  for (const key of ["msg", "message", "error"]) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** taskId из ответа createTask. */
export function taskIdOf(body: Record<string, unknown> | null): string | null {
  const data = asRecord(body?.data);
  for (const source of [data, body]) {
    const id = source?.taskId ?? source?.task_id ?? source?.id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

/**
 * Ссылки на результат. По документации они в resultJson — строке с JSON,
 * внутри которой массив resultUrls. Но в ответах встречается и уже
 * разобранный объект, и массив прямо в data, поэтому проверяем всё.
 */
export function resultUrlsOf(data: Record<string, unknown> | null): string[] {
  const collect = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((v) => {
          if (typeof v === "string") return v;
          const obj = asRecord(v);
          const url = obj?.url ?? obj?.resultUrl ?? obj?.imageUrl;
          return typeof url === "string" ? url : "";
        })
        .filter((u) => /^https?:\/\//i.test(u));
    }
    return [];
  };

  const raw = data?.resultJson ?? data?.result_json;
  let parsed: Record<string, unknown> | null = asRecord(raw);
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = asRecord(JSON.parse(raw));
    } catch {
      parsed = null;
    }
  }

  for (const source of [parsed, data]) {
    if (!source) continue;
    for (const key of ["resultUrls", "result_urls", "urls", "images"]) {
      const found = collect(source[key]);
      if (found.length) return found;
    }
  }
  return [];
}

/** Приведение state к известному набору. */
export function normalizeState(value: unknown): KieState {
  const s = String(value ?? "").trim().toLowerCase();
  if (["success", "succeeded", "completed", "done"].includes(s)) return "success";
  if (["fail", "failed", "error"].includes(s)) return "fail";
  if (["waiting", "queuing", "queued", "pending"].includes(s)) return "queuing";
  if (["generating", "processing", "running"].includes(s)) return "generating";
  return s ? "unknown" : "unknown";
}

/** Ответ recordInfo → понятный статус. */
export function parseTaskStatus(body: Record<string, unknown> | null): KieTaskStatus {
  const data = asRecord(body?.data) ?? body;
  const state = normalizeState(data?.state ?? data?.status);
  const urls = resultUrlsOf(data);

  // Иногда сервис не выставляет state, но результат уже лежит — считаем успехом.
  if (state !== "success" && urls.length) {
    return { state: "success", urls, error: null, progress: 1 };
  }

  const failMsg = data?.failMsg ?? data?.fail_msg ?? data?.errorMessage;
  const progressRaw = Number(data?.progress);

  return {
    state,
    urls,
    error: state === "fail"
      ? (typeof failMsg === "string" && failMsg.trim() ? failMsg.trim() : "Задача завершилась ошибкой")
      : null,
    progress: Number.isFinite(progressRaw) ? progressRaw : null,
  };
}

/** Задача ещё выполняется — надо ждать. */
export function isPending(state: KieState): boolean {
  return state === "waiting" || state === "queuing" || state === "generating";
}

/**
 * Ошибка kie.ai фатальна или её стоит повторить.
 * 401/403 — ключ; 402 и «insufficient credits» — деньги кончились: в обоих
 * случаях повтор ничего не изменит, и человеку нужно сказать прямо.
 */
export function classifyKieError(
  httpStatus: number,
  body: Record<string, unknown> | null,
  fallback: string,
): { retryable: boolean; message: string } {
  const code = kieCode(body) ?? httpStatus;
  const text = (kieMessage(body) || fallback || "").trim();
  const lower = text.toLowerCase();

  if (code === 401 || code === 403) {
    return { retryable: false, message: `kie.ai не принял ключ: ${text || "unauthorized"}` };
  }
  if (code === 402 || /insufficient|no credit|balance/i.test(lower)) {
    return {
      retryable: false,
      message: `На балансе kie.ai недостаточно кредитов${text ? `: ${text}` : ""}`,
    };
  }
  if (code === 429 || httpStatus === 429) {
    return { retryable: true, message: "kie.ai ограничил частоту запросов — повторим позже" };
  }
  if (code >= 500 || httpStatus >= 500) {
    return { retryable: true, message: text || "kie.ai временно недоступен" };
  }
  // 400 и прочее — битый запрос, повтор не поможет.
  return { retryable: false, message: text || `kie.ai вернул код ${code}` };
}

/**
 * Формат кадра для kie.ai: там аспект задаётся строкой вида "1:1".
 * Наши брифы приходят и как "4:5", и как "1080x1350" — приводим к первому.
 */
export function toKieImageSize(aspect: string | null | undefined): string {
  const value = (aspect ?? "").trim();
  if (/^\d+:\d+$/.test(value)) return value;
  const wh = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(value);
  if (wh) {
    const w = Number(wh[1]);
    const h = Number(wh[2]);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const d = gcd(w, h) || 1;
    return `${Math.round(w / d)}:${Math.round(h / d)}`;
  }
  return "1:1";
}
