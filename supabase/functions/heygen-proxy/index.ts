// Прокси для HeyGen API — раздел «Монтаж».
// Браузер не ходит на HeyGen напрямую: ключ HEYGEN_API_KEY хранится в секретах
// Supabase и в клиент не попадает. Роутинг по полю `action` в теле запроса.
import { AUTH_CORS_HEADERS, requireUser } from "../_lib/auth.ts";

const HEYGEN_BASE = "https://api.heygen.com";
const HEYGEN_UPLOAD = "https://upload.heygen.com";
const TIMEOUT_MS = 120_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type HeygenCall = {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
};

// Описываем, как каждое действие раздела «Монтаж» ложится на HeyGen API.
function resolveCall(action: string, payload: Record<string, unknown>): HeygenCall | { error: string } {
  switch (action) {
    // Диагностика: доступ к API и остаток кредитов на текущем плане.
    case "quota":
      return { method: "GET", url: `${HEYGEN_BASE}/v2/user/remaining_quota` };

    // Справочники для пикеров в UI.
    case "list_avatars":
      return { method: "GET", url: `${HEYGEN_BASE}/v2/avatars` };
    case "list_voices":
      return { method: "GET", url: `${HEYGEN_BASE}/v2/voices` };
    case "list_templates":
      return { method: "GET", url: `${HEYGEN_BASE}/v2/templates` };

    // Аватар + сценарий (talking head).
    case "generate_avatar":
      return { method: "POST", url: `${HEYGEN_BASE}/v2/video/generate`, body: payload.video ?? payload };

    // Монтаж по шаблону с подстановкой переменных/клипов.
    case "generate_template": {
      const templateId = String(payload.template_id ?? "").trim();
      if (!templateId) return { error: "template_id required" };
      return {
        method: "POST",
        url: `${HEYGEN_BASE}/v2/template/${encodeURIComponent(templateId)}/generate`,
        body: payload.template ?? payload,
      };
    }

    // Опрос рендера → готовый MP4.
    case "status": {
      const videoId = String(payload.video_id ?? "").trim();
      if (!videoId) return { error: "video_id required" };
      return {
        method: "GET",
        url: `${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      };
    }

    // Загрузка готового клипа как HeyGen-ассета (для сборки из своих видео).
    case "upload_asset":
      return { method: "POST", url: `${HEYGEN_UPLOAD}/v1/asset` };

    default:
      return { error: `Unknown action: ${action}` };
  }
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

  const apiKey = Deno.env.get("HEYGEN_API_KEY");
  if (!apiKey) {
    return json(
      { error: "HEYGEN_API_KEY не задан в секретах Supabase (Edge Functions → Secrets)." },
      500,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(payload.action ?? "").trim();
  if (!action) return json({ error: "action required" }, 400);

  const call = resolveCall(action, payload);
  if ("error" in call) return json({ error: call.error }, 400);

  try {
    const res = await fetch(call.url, {
      method: call.method,
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
        ...(call.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: call.method === "POST" ? JSON.stringify(call.body ?? {}) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return json(
          { error: "HeyGen отклонил ключ (401/403). Проверь HEYGEN_API_KEY и доступ к API на плане." },
          502,
        );
      }
      return json(
        { error: `HeyGen вернул ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}` },
        502,
      );
    }

    return new Response(text || "null", {
      status: 200,
      headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? "network error";
    if (msg.includes("aborted") || msg.includes("timeout")) {
      return json(
        { error: `Таймаут (${Math.round(TIMEOUT_MS / 1000)}s) — HeyGen не ответил` },
        504,
      );
    }
    return json({ error: `Не удалось связаться с HeyGen: ${msg}` }, 502);
  }
});
