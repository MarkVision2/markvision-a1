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

// HeyGen отдаёт ссылку на видео по-разному; Video Agent часто возвращает только
// video_id, а сам MP4 (и длительность) забираются вторым запросом к /v1.
function nestedOf(d: Record<string, unknown>, k: string, s: string) {
  const v = d[k];
  return v && typeof v === "object" ? (v as Record<string, unknown>)[s] : undefined;
}
function pickUrl(d: Record<string, unknown>): string | undefined {
  return [
    d.video_url, d.url, d.download_url, d.mp4_url,
    nestedOf(d, "video", "url"), nestedOf(d, "video", "video_url"), nestedOf(d, "video", "download_url"),
    nestedOf(d, "output", "video_url"), nestedOf(d, "result", "video_url"), nestedOf(d, "data", "video_url"),
  ].find((x) => typeof x === "string" && (x as string).length > 0) as string | undefined;
}
function pickVideoId(d: Record<string, unknown>): string | undefined {
  return [d.video_id, nestedOf(d, "video", "video_id"), nestedOf(d, "video", "id"), nestedOf(d, "result", "video_id")]
    .find((x) => typeof x === "string" && (x as string).length > 0) as string | undefined;
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
    // Только СВОИ аватары (группы: «Юрий Кат» и т.п.), без публичных.
    case "list_avatar_groups":
      return { method: "GET", url: `${HEYGEN_BASE}/v2/avatar_group.list?include_public=false` };
    // «Взгляды» (looks) внутри группы аватара.
    case "list_group_avatars": {
      const gid = String(payload.group_id ?? "").trim();
      if (!gid) return { error: "group_id required" };
      return { method: "GET", url: `${HEYGEN_BASE}/v2/avatar_group/${encodeURIComponent(gid)}/avatars` };
    }
    case "list_voices":
      return { method: "GET", url: `${HEYGEN_BASE}/v2/voices` };
    case "list_templates":
      return { method: "GET", url: `${HEYGEN_BASE}/v2/templates` };
    // Детали шаблона: переменные (поля) для подстановки перед сборкой.
    case "template_detail": {
      const tid = String(payload.template_id ?? "").trim();
      if (!tid) return { error: "template_id required" };
      return { method: "GET", url: `${HEYGEN_BASE}/v2/template/${encodeURIComponent(tid)}` };
    }

    // Быстрое создание (Video Agent v3): промпт/сценарий → авто-монтаж с б-роллом.
    case "video_agent":
      return { method: "POST", url: `${HEYGEN_BASE}/v3/video-agents`, body: payload.agent ?? { prompt: payload.prompt } };

    case "video_agent_status": {
      const sessionId = String(payload.session_id ?? "").trim();
      if (!sessionId) return { error: "session_id required" };
      return { method: "GET", url: `${HEYGEN_BASE}/v3/video-agents/${encodeURIComponent(sessionId)}` };
    }

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

    // upload_asset обрабатывается отдельно (бинарный passthrough, action в query).

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

  // Загрузка готового клипа — бинарный passthrough (файл в теле, action в query).
  const queryAction = new URL(req.url).searchParams.get("action");
  if (queryAction === "upload_asset") {
    const contentType = req.headers.get("content-type") || "application/octet-stream";
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength === 0) return json({ error: "Пустое тело файла" }, 400);
    try {
      const res = await fetch(`${HEYGEN_UPLOAD}/v1/asset`, {
        method: "POST",
        headers: { "X-Api-Key": apiKey, "Content-Type": contentType },
        body: bytes,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) {
        return json({ error: `HeyGen upload вернул ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}` }, 502);
      }
      return new Response(text || "null", {
        status: 200,
        headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (e) {
      return json({ error: `Загрузка в HeyGen не удалась: ${(e as Error)?.message ?? "network error"}` }, 502);
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(payload.action ?? "").trim();
  if (!action) return json({ error: "action required" }, 400);

  // Статус Video Agent: авторитетен статус самого ВИДЕО (/v3/videos/{id}), а не
  // сессии агента (она бывает «failed», пока видео ещё рендерится). Как только у
  // сессии есть video_id — подменяем статус/ссылку данными видео.
  if (action === "video_agent_status") {
    const sessionId = String(payload.session_id ?? "").trim();
    if (!sessionId) return json({ error: "session_id required" }, 400);
    try {
      const r = await fetch(`${HEYGEN_BASE}/v3/video-agents/${encodeURIComponent(sessionId)}`, {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: `HeyGen вернул ${r.status}` }, 502);
      const d = (body?.data ?? body ?? {}) as Record<string, unknown>;
      const vid = pickVideoId(d);
      if (vid) {
        let vd: Record<string, unknown> = {};
        try {
          const vr = await fetch(`${HEYGEN_BASE}/v3/videos/${encodeURIComponent(vid)}`, {
            headers: { "X-Api-Key": apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          vd = ((await vr.json().catch(() => ({})))?.data ?? {}) as Record<string, unknown>;
        } catch { /* ignore */ }
        if (!pickUrl(vd) && !vd.status) {
          const vr1 = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(vid)}`, {
            headers: { "X-Api-Key": apiKey, Accept: "application/json" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          vd = ((await vr1.json().catch(() => ({})))?.data ?? vd) as Record<string, unknown>;
        }
        if (vd.status) d.status = vd.status; // статус видео важнее статуса сессии
        const url = pickUrl(vd);
        if (url) {
          d.video_url = url;
          if (d.duration == null && vd.duration != null) d.duration = vd.duration;
          if (!d.thumbnail_url && vd.thumbnail_url) d.thumbnail_url = vd.thumbnail_url;
          if (!d.video_id) d.video_id = vid;
        }
      }
      return json({ data: d });
    } catch (e) {
      const msg = (e as Error)?.message ?? "network error";
      if (msg.includes("aborted") || msg.includes("timeout")) {
        return json({ error: `Таймаут (${Math.round(TIMEOUT_MS / 1000)}s) — HeyGen не ответил` }, 504);
      }
      return json({ error: `Не удалось связаться с HeyGen: ${msg}` }, 502);
    }
  }

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
