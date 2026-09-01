/**
 * Транспорт Контент-завода.
 *
 * По умолчанию заявка уходит в прямой контур — Edge Function
 * `content-factory-generate`: она ставит задание в очередь, а картинки
 * генерирует content-factory-worker (Gemini) и кладёт их в
 * content_factory_results, откуда фронт забирает их через realtime.
 *
 * Прежний путь через n8n (`content-factory-proxy` → webhook «Clony AI»)
 * остаётся аварийным откатом и включается VITE_CONTENT_FACTORY_MODE=n8n.
 * Наружу на n8n браузер в любом случае не ходит — только через edge.
 */
import { supabase } from "@/integrations/supabase/client";

/** direct — своя генерация; n8n — прежний вебхук. */
export function contentFactoryMode(): "direct" | "n8n" {
  return import.meta.env.VITE_CONTENT_FACTORY_MODE === "n8n" ? "n8n" : "direct";
}

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
  const fn = contentFactoryMode() === "n8n"
    ? "content-factory-proxy"
    : "content-factory-generate";
  const { data, error } = await supabase.functions.invoke(fn, {
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
 * Отправка заявки на один стиль. Ответ приходит сразу: в прямом контуре это
 * подтверждение постановки в очередь, картинки догоняют через realtime.
 * Кидает Error с текстом, который можно показать человеку.
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
