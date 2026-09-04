/**
 * Публикация видео (Shorts) на YouTube через Data API v3 videos.insert.
 *
 * YouTube не принимает видео по ссылке: файл скачивается с publish_videos.file_url
 * и заливается resumable upload (init → PUT тела). Адрес сессии загрузки
 * сохраняется как containerId — повтор продолжает ту же сессию (запрос со
 * звёздочкой в Content-Range → 308 с уже принятым диапазоном), а не начинает
 * новую. Квота: 1600 единиц на загрузку при дневных 10 000 — примерно 6 роликов
 * в день на проект Google Cloud до расширения квоты; quotaExceeded → limit.
 *
 * Токен — OAuth пользователя (publish-oauth, scope youtube.upload), обновляется
 * refresh_token'ом перед публикацией (publishRunner.ensureFreshToken).
 */
import type { FailureKind, PublishOutcome, PublishRequest } from "./types.ts";

const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
export const YOUTUBE_TITLE_LIMIT = 100;
export const YOUTUBE_DESCRIPTION_LIMIT = 5000;
/** Без известного размера файл буферизуется — не больше этого. */
export const YOUTUBE_MAX_BUFFER_BYTES = 200 * 1024 * 1024;

export function youtubeTitle(title: string | null | undefined, caption: string): string {
  const base = (title ?? "").trim() || caption.split(/\n/)[0].trim() || "Shorts";
  const clean = base.replace(/[<>]/g, "").trim();
  return clean.length <= YOUTUBE_TITLE_LIMIT ? clean : `${clean.slice(0, YOUTUBE_TITLE_LIMIT - 1).trimEnd()}…`;
}

export function youtubeDescription(caption: string): string {
  const d = caption.replace(/[<>]/g, "").trim();
  return d.length <= YOUTUBE_DESCRIPTION_LIMIT ? d : d.slice(0, YOUTUBE_DESCRIPTION_LIMIT);
}

/** Ошибка Google API → тип отказа (чистая функция, покрыта тестами). */
export function classifyYouTubeError(status: number, body: unknown): { kind: FailureKind; code: string; message: string } {
  const err = ((body as { error?: Record<string, unknown> } | null)?.error ?? {}) as Record<string, unknown>;
  const reason = String(((err.errors as Record<string, unknown>[] | undefined)?.[0]?.reason) ?? err.status ?? "");
  const message = String(err.message ?? `HTTP ${status}`);
  if (status === 401 || reason === "authError" || /invalid credentials|invalid_grant/i.test(message)) {
    return { kind: "token", code: reason || "401", message: `Токен YouTube недействителен: ${message}` };
  }
  if (["quotaExceeded", "uploadLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"].includes(reason) || status === 429) {
    return { kind: "limit", code: reason || "429", message: `Лимит YouTube: ${message}` };
  }
  if (status >= 500 || status === 0 || reason === "backendError") return { kind: "temporary", code: reason || String(status), message };
  return { kind: "fatal", code: reason || String(status), message };
}

export function youtubeUrl(videoId: string): string {
  return `https://www.youtube.com/shorts/${videoId}`;
}

async function readJson(r: Response): Promise<unknown> {
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 300) }; }
}

export async function publishYouTube(req: PublishRequest): Promise<PublishOutcome> {
  const { token } = req;
  // Deno через globalThis — модуль тянут vitest-тесты вне Deno.
  const envGet = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get;
  const privacy = (envGet?.("YOUTUBE_PRIVACY_STATUS") ?? "public").toLowerCase();

  // 1. Источник: размер нужен для resumable upload.
  let source: Response;
  try {
    source = await fetch(req.videoUrl);
  } catch (e) {
    return { status: "failed", kind: "temporary", code: "source_fetch", message: `не скачать видео: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!source.ok || !source.body) {
    return { status: "failed", kind: "fatal", code: "source_http", message: `источник видео ответил HTTP ${source.status}` };
  }
  let total = Number(source.headers.get("content-length") ?? 0);
  let body: BodyInit = source.body;
  if (!total) {
    const buf = new Uint8Array(await source.arrayBuffer());
    if (buf.byteLength > YOUTUBE_MAX_BUFFER_BYTES) {
      return { status: "failed", kind: "fatal", code: "too_large", message: `файл без Content-Length больше ${YOUTUBE_MAX_BUFFER_BYTES / 1024 / 1024} МБ — нужен размер или меньший файл` };
    }
    total = buf.byteLength;
    body = buf;
  }

  // 2. Сессия загрузки (или продолжение прошлой).
  let uploadUrl = req.containerId ?? null;
  let offset = 0;
  if (uploadUrl) {
    const probe = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes */${total}` } });
    if (probe.status === 308) {
      const range = probe.headers.get("Range"); // bytes=0-12345
      offset = range ? Number(range.split("-")[1]) + 1 : 0;
    } else if (probe.ok) {
      const done = (await readJson(probe)) as { id?: string };
      if (done.id) return { status: "published", externalPostId: done.id, externalPostUrl: youtubeUrl(done.id), raw: done };
      uploadUrl = null;
    } else {
      uploadUrl = null; // сессия истекла — начнём новую
    }
  }
  if (!uploadUrl) {
    const init = await fetch(UPLOAD, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(total),
      },
      body: JSON.stringify({
        snippet: { title: youtubeTitle(req.title, req.caption), description: youtubeDescription(req.caption), categoryId: "22" },
        status: { privacyStatus: ["public", "unlisted", "private"].includes(privacy) ? privacy : "public", selfDeclaredMadeForKids: false },
      }),
    });
    if (!init.ok) {
      const b = await readJson(init);
      const c = classifyYouTubeError(init.status, b);
      return { status: "failed", kind: c.kind, code: c.code, message: c.message, raw: b };
    }
    uploadUrl = init.headers.get("Location");
    if (!uploadUrl) return { status: "failed", kind: "temporary", code: "no_upload_url", message: "YouTube не вернул адрес загрузки" };
  }

  // 3. Тело. Буфер продолжаем с принятого смещения; поток читать с позиции
  //    нельзя — тогда заливаем заново с нуля в ту же сессию (она это допускает).
  if (offset > 0) {
    if (body instanceof Uint8Array) {
      // slice, а не subarray: под новыми lib-типами Deno subarray отдаёт
      // Uint8Array<ArrayBufferLike>, который fetch в BodyInit не принимает.
      body = body.slice(offset);
    } else {
      const again = await fetch(req.videoUrl);
      body = again.body ?? body;
      offset = 0;
    }
  }
  let put: Response;
  try {
    put = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(total - offset),
        ...(offset ? { "Content-Range": `bytes ${offset}-${total - 1}/${total}` } : {}),
      },
      body,
    });
  } catch (e) {
    return { status: "processing", containerId: uploadUrl, raw: { error: e instanceof Error ? e.message : String(e) } };
  }
  if (put.status === 308) return { status: "processing", containerId: uploadUrl };
  const result = (await readJson(put)) as { id?: string };
  if (!put.ok || !result.id) {
    const c = classifyYouTubeError(put.status, result);
    return { status: "failed", kind: c.kind, code: c.code, message: c.message, raw: result };
  }
  return { status: "published", externalPostId: result.id, externalPostUrl: youtubeUrl(result.id), raw: result };
}
