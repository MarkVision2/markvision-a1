// Прокси для n8n Content Factory (Clony AI).
// Браузер не ходит напрямую на n8n — избегаем CORS и обрывов в Lovable preview.
import { AUTH_CORS_HEADERS, requireUser } from "../_lib/auth.ts";

const N8N_WEBHOOK =
  Deno.env.get("N8N_CONTENT_WEBHOOK_URL") ??
  "https://n8n.zapoinov.com/webhook/clony-yurii";
const TIMEOUT_MS = 120_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: AUTH_CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const res = await fetch(N8N_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 404) {
        return json(
          {
            error:
              "Workflow в n8n не активен (404). Откройте n8n и активируйте production-вебхук.",
          },
          502,
        );
      }
      return json(
        { error: `n8n вернул ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` },
        502,
      );
    }

    try {
      return new Response(text, {
        status: 200,
        headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch {
      return json(null);
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? "network error";
    if (msg.includes("aborted") || msg.includes("timeout")) {
      return json(
        { error: `Таймаут (${Math.round(TIMEOUT_MS / 1000)}s) — n8n не ответил` },
        504,
      );
    }
    return json({ error: `Не удалось связаться с n8n: ${msg}` }, 502);
  }
});
