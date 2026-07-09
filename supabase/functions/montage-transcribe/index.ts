// Транскрипция видео с пословными таймкодами — фундамент для динамичных
// субтитров без HeyGen. Переиспользует тот же Whisper-путь (Lovable AI
// Gateway), что уже работает в ai-rop-analyze-call, только просит
// word-level timestamps вместо посегментных.
//
// Вход: { video_url: string }
// Auth: JWT пользователя.
import { requireUser, AUTH_CORS_HEADERS } from "../_lib/auth.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const LOVABLE_BASE = "https://ai.gateway.lovable.dev/v1";
const STT_MODEL = "openai/whisper-1";
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 МБ — тот же лимит, что у whisper-загрузки в ai-rop-analyze-call

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: AUTH_CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY не задан в секретах" }, 500);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const videoUrl = String(body?.video_url ?? "").trim();
  if (!videoUrl) return json({ error: "video_url обязателен" }, 400);

  try {
    // Whisper принимает видео-контейнеры (mp4/webm) напрямую — сама
    // распаковка аудиодорожки на его стороне, ffmpeg тут не нужен.
    const videoRes = await fetchWithTimeout(videoUrl, { redirect: "follow" }, 30_000);
    if (!videoRes.ok) return json({ error: `Не удалось скачать видео (HTTP ${videoRes.status})` }, 502);
    const len = Number(videoRes.headers.get("content-length") ?? 0);
    if (len && len > MAX_VIDEO_BYTES) return json({ error: `Видео больше ${MAX_VIDEO_BYTES / 1024 / 1024} МБ` }, 400);
    const buf = await videoRes.arrayBuffer();
    if (buf.byteLength > MAX_VIDEO_BYTES) return json({ error: `Видео больше ${MAX_VIDEO_BYTES / 1024 / 1024} МБ` }, 400);
    const contentType = videoRes.headers.get("content-type") || "video/mp4";
    const ext = contentType.includes("webm") ? "webm" : "mp4";

    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: contentType }), `source.${ext}`);
    fd.append("model", STT_MODEL);
    fd.append("response_format", "verbose_json");
    fd.append("language", "ru");
    fd.append("timestamp_granularities[]", "word");

    const whisperRes = await fetchWithTimeout(
      `${LOVABLE_BASE}/audio/transcriptions`,
      { method: "POST", headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` }, body: fd },
      90_000,
    );
    const text = await whisperRes.text();
    if (!whisperRes.ok) {
      return json({ error: `whisper HTTP ${whisperRes.status}: ${text.slice(0, 400)}` }, 502);
    }
    const j = JSON.parse(text);
    const words: WhisperWord[] = Array.isArray(j?.words)
      ? j.words.map((w: Record<string, unknown>) => ({
          word: String(w.word ?? ""),
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
        }))
      : [];
    return json({ text: j?.text ?? "", words, duration: j?.duration ?? null, raw_has_words: Array.isArray(j?.words) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort")) return json({ error: "Таймаут при обработке видео" }, 504);
    return json({ error: msg }, 500);
  }
});
