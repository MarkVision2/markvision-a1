// Клиент kie.ai — перепродажа картиночных моделей Google (Nano Banana).
//
// Зачем он вообще: у Gemini API на бесплатном плане квота 0, а кредиты
// Google Cloud с марта 2026 на Gemini API не распространяются. kie.ai даёт
// те же модели заметно дешевле и по обычному ключу.
//
// API асинхронный: createTask → taskId → опрос recordInfo до success.
// taskId сохраняется в задании: если кадр не успел за отведённое время,
// следующий проход крона продолжит опрос той же задачи, а не создаст
// (и не оплатит) новую.
//
// Разбор ответов — в kieParse.ts, под тестами.

import {
  classifyKieError,
  isPending,
  kieMessage,
  parseTaskStatus,
  taskIdOf,
  toKieImageSize,
} from "./kieParse.ts";
import { isPublicHttpUrl } from "./safeUrl.ts";

const KIE_BASE = "https://api.kie.ai/api/v1";

/** Модель генерации. Меняется переменной окружения без правки кода. */
export const KIE_MODEL = Deno.env.get("CONTENT_FACTORY_KIE_MODEL") ?? "google/nano-banana";

/** Пауза между опросами статуса задачи. */
const POLL_INTERVAL_MS = 5_000;

export function hasKieKey(): boolean {
  return Boolean(Deno.env.get("KIE_API_KEY"));
}

export interface KieResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  retryable: boolean;
  /** Задача создана, но ещё не готова — продолжить на следующем проходе. */
  pending?: boolean;
  taskId?: string;
}

async function kieFetch(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: Record<string, unknown> | null; networkError: string | null }> {
  try {
    const res = await fetch(`${KIE_BASE}/${path.replace(/^\/+/, "")}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("KIE_API_KEY")}`,
        ...(init.headers as Record<string, string> ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    return { status: res.status, body, networkError: null };
  } catch (e) {
    return { status: 0, body: null, networkError: (e as Error)?.message ?? "network error" };
  }
}

/** Постановка задачи на генерацию. Возвращает taskId. */
export async function kieCreateTask(
  prompt: string,
  references: string[],
  aspect: string,
): Promise<KieResult<string>> {
  const input: Record<string, unknown> = {
    prompt,
    output_format: "png",
    image_size: toKieImageSize(aspect),
  };
  // Референсы отдаются ссылками — модель работает по ним как по образцам.
  if (references.length) input.image_urls = references;

  const { status, body, networkError } = await kieFetch(
    "jobs/createTask",
    { method: "POST", body: JSON.stringify({ model: KIE_MODEL, input }) },
    60_000,
  );
  if (networkError) {
    return { ok: false, data: null, error: networkError, retryable: true };
  }

  const taskId = taskIdOf(body);
  if (status >= 400 || !taskId) {
    const verdict = classifyKieError(status, body, kieMessage(body) || `HTTP ${status}`);
    return { ok: false, data: null, error: verdict.message, retryable: verdict.retryable };
  }
  return { ok: true, data: taskId, error: null, retryable: false, taskId };
}

/** Один опрос статуса задачи. */
export async function kieCheckTask(taskId: string): Promise<
  KieResult<{ urls: string[] }>
> {
  const { status, body, networkError } = await kieFetch(
    `jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { method: "GET" },
    30_000,
  );
  if (networkError) {
    return { ok: false, data: null, error: networkError, retryable: true, taskId };
  }
  if (status >= 400) {
    const verdict = classifyKieError(status, body, `HTTP ${status}`);
    return { ok: false, data: null, error: verdict.message, retryable: verdict.retryable, taskId };
  }

  const parsed = parseTaskStatus(body);
  if (parsed.state === "success") {
    return { ok: true, data: { urls: parsed.urls }, error: null, retryable: false, taskId };
  }
  if (parsed.state === "fail") {
    // Модель отказалась или не смогла — повтор с тем же промптом не поможет.
    return { ok: false, data: null, error: parsed.error ?? "kie.ai: задача упала", retryable: false, taskId };
  }
  return {
    ok: false,
    data: null,
    error: `kie.ai обрабатывает кадр${parsed.progress != null ? ` (${Math.round(parsed.progress * 100)}%)` : ""}`,
    retryable: true,
    pending: true,
    taskId,
  };
}

/** Скачивание готового кадра в base64 — дальше он ложится в Storage. */
async function downloadAsBase64(
  url: string,
): Promise<{ data: string; mime: string } | null> {
  // Ссылка пришла от сервиса, к которому мы сами обратились, поэтому
  // allowlist пользовательских хранилищ тут не при чём. Но внутренние
  // адреса всё равно закрыты — на случай, если ответ подменят.
  if (!isPublicHttpUrl(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.byteLength) return null;
    let binary = "";
    for (let i = 0; i < buf.length; i += 8192) {
      binary += String.fromCharCode(...buf.subarray(i, i + 8192));
    }
    return {
      data: btoa(binary),
      mime: res.headers.get("content-type")?.split(";")[0] || "image/png",
    };
  } catch {
    return null;
  }
}

export interface KieImageOptions {
  /** Уже созданная задача — продолжаем её вместо новой. */
  taskId?: string | null;
  /** Вызывается сразу после createTask, чтобы задание запомнило taskId. */
  onTask?: (taskId: string) => Promise<void>;
  /** До какого момента можно ждать (Date.now() + бюджет). */
  deadline?: number;
  aspect?: string;
}

/**
 * Генерация кадра целиком: задача → ожидание → скачивание.
 *
 * Если не успели до дедлайна, возвращается pending с taskId — воркер
 * сохранит его и продолжит опрос следующим проходом, не оплачивая
 * генерацию второй раз.
 */
export async function kieImage(
  prompt: string,
  references: string[],
  options: KieImageOptions = {},
): Promise<KieResult<{ data: string; mime: string }>> {
  const deadline = options.deadline ?? (Date.now() + 180_000);

  let taskId = options.taskId ?? null;
  if (!taskId) {
    const created = await kieCreateTask(prompt, references, options.aspect ?? "1:1");
    if (!created.ok || !created.data) {
      return { ok: false, data: null, error: created.error, retryable: created.retryable };
    }
    taskId = created.data;
    if (options.onTask) await options.onTask(taskId);
  }

  while (Date.now() < deadline) {
    const status = await kieCheckTask(taskId);

    if (status.ok && status.data) {
      const url = status.data.urls[0];
      if (!url) {
        return {
          ok: false,
          data: null,
          error: "kie.ai сообщил об успехе, но не вернул ссылку на картинку",
          retryable: false,
          taskId,
        };
      }
      const image = await downloadAsBase64(url);
      return image
        ? { ok: true, data: image, error: null, retryable: false, taskId }
        : {
          ok: false,
          data: null,
          error: `Не удалось скачать готовый кадр: ${url}`,
          retryable: true,
          taskId,
        };
    }

    if (!status.pending) {
      return { ok: false, data: null, error: status.error, retryable: status.retryable, taskId };
    }

    // Ждём следующего опроса, но не перешагиваем дедлайн.
    const wait = Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
    if (wait <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  return {
    ok: false,
    data: null,
    error: "kie.ai ещё обрабатывает кадр — продолжим на следующем проходе",
    retryable: true,
    pending: true,
    taskId: taskId ?? undefined,
  };
}

export { isPending, toKieImageSize };
