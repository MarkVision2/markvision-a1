/**
 * Content-factory workflow (n8n «Clony AI»).
 * Запросы идут через Edge Function `content-factory-proxy`, чтобы не ловить
 * CORS / Failed to fetch в Lovable preview и на мобильных сетях.
 */
import { supabase } from "@/integrations/supabase/client";

/** Fallback URL — только если edge function ещё не задеплоена. */
export const N8N_CONTENT_WEBHOOK =
  "https://n8n.zapoinov.com/webhook/clony-yurii";

/** Hard timeout for a single style generation request (ms). */
export const N8N_TIMEOUT_MS = 120_000;

function formatFetchError(e: unknown): string {
  const msg = (e as Error)?.message ?? "network error";
  if (msg.includes("aborted") || msg.includes("timeout")) {
    return `Таймаут (${Math.round(N8N_TIMEOUT_MS / 1000)}s) — генератор не ответил`;
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Нет связи с сервером. Проверьте интернет и повторите. Если ошибка в Lovable preview — нажмите Publish и откройте опубликованный сайт.";
  }
  return msg;
}

async function postViaEdgeFunction(payload: unknown): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("content-factory-proxy", {
    body: payload,
  });
  if (error) {
    throw new Error(formatFetchError(error));
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data;
}

async function postDirect(payload: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(N8N_CONTENT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`Не удалось связаться с генератором: ${formatFetchError(e)}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    if (res.status === 404) {
      throw new Error(
        "Workflow в n8n не активен (404). Откройте n8n и нажмите «Execute workflow» или переключитесь на production-вебхук.",
      );
    }
    throw new Error(`n8n вернул ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Send a single style payload to the n8n workflow.
 * Throws an Error with a human-readable message on failure.
 */
export async function postContentFactory(
  payload: unknown | FormData,
): Promise<unknown> {
  if (typeof FormData !== "undefined" && payload instanceof FormData) {
    throw new Error("multipart не поддерживается — загрузите фото в Storage и отправьте image_urls");
  }

  try {
    return await postViaEdgeFunction(payload);
  } catch (edgeErr) {
    const edgeMsg = (edgeErr as Error).message ?? "";
    // Edge function не задеплоена или временно недоступна — пробуем прямой вызов.
    if (
      /not found|404|function.*does not exist|failed to send a request/i.test(edgeMsg)
    ) {
      return postDirect(payload);
    }
    throw new Error(`Не удалось связаться с генератором: ${edgeMsg}`);
  }
}
