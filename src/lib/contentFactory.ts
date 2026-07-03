/**
 * Content-factory workflow (n8n «Clony AI»).
 * Все запросы идут ТОЛЬКО через Edge Function `content-factory-proxy`, чтобы
 * пользовательский контент не уходил напрямую на внешний n8n без авторизации.
 */
import { supabase } from "@/integrations/supabase/client";

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

/**
 * Send a single style payload to the n8n workflow via the authenticated proxy.
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
    throw new Error(`Не удалось связаться с генератором: ${edgeMsg}`);
  }
}
