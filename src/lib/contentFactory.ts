/**
 * Configuration for the content-factory workflow that runs on n8n.
 * Keeping the URL here (instead of hardcoded inside CreateStep3) makes it
 * trivial to flip from the test endpoint to a production one.
 *
 * Note: `webhook-test/...` is the n8n test endpoint and gets disabled every
 * time the workflow is reopened in the editor. For production, replace with
 * `webhook/...` (without the `-test` suffix).
 */
export const N8N_CONTENT_WEBHOOK =
  "https://n8n.srv1602169.hstgr.cloud/webhook-test/581d3819-a0c2-43b3-8c89-e3efe65b15bd-neuro-test";

/** Hard timeout for a single style generation request (ms). */
export const N8N_TIMEOUT_MS = 120_000;

/**
 * Send a single style payload to the n8n workflow.
 * Throws an Error with a human-readable message on non-2xx or timeout.
 */
export async function postContentFactory(payload: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(N8N_CONTENT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? "network error";
    if (msg.includes("aborted") || msg.includes("timeout")) {
      throw new Error(`Таймаут (${Math.round(N8N_TIMEOUT_MS / 1000)}s) — n8n не ответил`);
    }
    throw new Error(`Не удалось связаться с генератором: ${msg}`);
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
