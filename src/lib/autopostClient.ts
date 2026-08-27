// Shared Autopost upload + scheduler client (used by AutoPost and Content Plan composer).
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { supabase } from "@/integrations/supabase/client";
import { clientSupabasePublishableKey, clientSupabaseUrl } from "@/lib/supabaseConfig";

const CLIENT_URL = clientSupabaseUrl;
const CLIENT_KEY = clientSupabasePublishableKey;
const BUCKET = "autopost";
const SUPABASE_DIRECT_MAX_BYTES = 50 * 1024 * 1024;
export const AUTOPOST_MAX_FILE_MB = 500;
export const AUTOPOST_MAX_FILE_BYTES = AUTOPOST_MAX_FILE_MB * 1024 * 1024;

const pad = (n: number) => String(n).padStart(2, "0");

export const isVideoFile = (f: File) => f.type.startsWith("video/");

export function buildAutopostISO(ymd: string, hour: number, minute: number): string {
  return new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00+05:00`).toISOString();
}

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Сетевая ошибка");
}

/**
 * Заголовки для edge-функций контент-завода.
 *
 * Раньше сюда уходил x-app-key = публикуемый ключ проекта, вшитый в бандл:
 * планировщик постов и выдача presigned-URL в R2 были фактически открыты
 * наружу. Теперь функции требуют JWT пользователя.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Сессия истекла — войдите заново");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (CLIENT_KEY) headers.apikey = CLIENT_KEY;
  return headers;
}

export async function schedulerApi<T = unknown>(
  action: string,
  payload: Record<string, unknown> = {},
  projectId?: string | null,
): Promise<T> {
  if (!CLIENT_URL) throw new Error("VITE_CLIENT_SUPABASE_URL не задан");
  const r = await fetch(`${CLIENT_URL}/functions/v1/content-scheduler`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...(projectId ? { project_id: projectId } : {}), ...payload }),
  });
  const j = await r.json().catch(() => ({} as Record<string, unknown>));
  if (!r.ok || !(j as { ok?: boolean }).ok) {
    const err = (j as { error?: string }).error;
    const detail = (j as { detail?: unknown }).detail;
    let detailMsg = "";
    if (typeof detail === "string") detailMsg = detail;
    else if (detail && typeof detail === "object" && "message" in detail) {
      detailMsg = String((detail as { message?: string }).message ?? "");
    }
    throw new Error([err, detailMsg].filter(Boolean).join(": ") || `HTTP ${r.status}`);
  }
  return j as T;
}

async function presignR2(filename: string, contentType: string, size: number): Promise<{ uploadUrl: string; publicUrl: string }> {
  if (!CLIENT_URL) throw new Error("VITE_CLIENT_SUPABASE_URL не задан");
  const res = await fetchWithRetry(`${CLIENT_URL}/functions/v1/r2-presign-upload`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ filename, contentType, size }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Не удалось получить ссылку для загрузки (HTTP ${res.status})`);
  return { uploadUrl: j.uploadUrl as string, publicUrl: j.publicUrl as string };
}

async function uploadToR2(file: File): Promise<string> {
  const { uploadUrl, publicUrl } = await presignR2(file.name, file.type || "application/octet-stream", file.size);
  const put = await fetchWithRetry(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`Загрузка в хранилище не удалась (HTTP ${put.status})`);
  return publicUrl;
}

export async function normalizeVideoForInstagram(sourceUrl: string, contentType: string, sizeHint: number): Promise<string> {
  try {
    const { uploadUrl, publicUrl } = await presignR2(`normalized-${Date.now()}.mp4`, contentType || "video/mp4", sizeHint);
    const res = await fetchWithRetry("/api/autopost/normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_url: sourceUrl, upload_url: uploadUrl }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j?.error) throw new Error(j?.error || `HTTP ${res.status}`);
    return publicUrl;
  } catch (e) {
    console.warn("normalizeVideoForInstagram failed, publishing raw upload instead", e);
    return sourceUrl;
  }
}

export async function uploadAutopostFile(file: File): Promise<string> {
  if (file.size > AUTOPOST_MAX_FILE_BYTES) {
    throw new Error(
      `Файл ${(file.size / 1024 / 1024).toFixed(0)} МБ — максимум ${AUTOPOST_MAX_FILE_MB} МБ. Сожмите видео или уменьшите разрешение/битрейт.`,
    );
  }
  if (file.size > SUPABASE_DIRECT_MAX_BYTES) return uploadToR2(file);
  if (!clientConfigSupabase) throw new Error("Хранилище не настроено (VITE_CLIENT_SUPABASE_*)");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const attempts = 3;
  let lastMessage = "";
  for (let i = 0; i < attempts; i++) {
    const { error } = await clientConfigSupabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || undefined,
      upsert: i > 0,
    });
    if (!error) return clientConfigSupabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    if (/exceeded the maximum allowed size/i.test(error.message)) return uploadToR2(file);
    lastMessage = error.message;
    if (/failed to fetch/i.test(error.message) && i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      continue;
    }
    break;
  }
  throw new Error(`Загрузка не удалась: ${lastMessage}`);
}

export interface CreateAutopostResult {
  id: string;
  scheduledAt: string;
  status: "scheduled" | "published";
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  childUrls: string[] | null;
  caption: string;
  mediaType: string;
}

/** Upload media + enqueue in content-scheduler. */
export async function createAutopostPublication(input: {
  projectId: string;
  mediaType: string;
  files: File[];
  caption: string;
  scheduledAt: string;
  publishNow?: boolean;
  dryRun?: boolean;
  coverFile?: File | null;
  onProgress?: (label: string) => void;
}): Promise<CreateAutopostResult> {
  const { projectId, mediaType, files, caption, scheduledAt, publishNow, dryRun, coverFile, onProgress } = input;
  if (!files.length) throw new Error("Добавьте медиа");
  if (mediaType === "CAROUSEL" && files.length < 2) throw new Error("Карусель: минимум 2 файла");
  if (mediaType === "REELS" && !isVideoFile(files[0])) throw new Error("Reels — только видео");
  if (mediaType === "IMAGE" && isVideoFile(files[0])) throw new Error("Пост — только фото (видео → Reels)");

  const urls: string[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(`Загрузка ${i + 1} из ${files.length}…`);
    const f = files[i];
    const rawUrl = await uploadAutopostFile(f);
    urls.push(isVideoFile(f) ? await normalizeVideoForInstagram(rawUrl, f.type, f.size) : rawUrl);
  }

  let coverUrl: string | null = null;
  if (mediaType === "REELS" && coverFile) {
    onProgress?.("Загрузка обложки…");
    coverUrl = await uploadAutopostFile(coverFile);
  }

  onProgress?.("Сохраняем в очередь…");
  const payload: Record<string, unknown> = {
    media_type: mediaType,
    caption: mediaType === "STORIES" ? "" : caption,
    scheduled_at: publishNow ? new Date().toISOString() : scheduledAt,
    dry_run: publishNow ? false : !!dryRun,
  };
  if (mediaType === "CAROUSEL") {
    payload.child_urls = urls;
    payload.thumbnail_url = urls.find((_, i) => !isVideoFile(files[i])) ?? urls[0];
  } else {
    payload.media_url = urls[0];
    if (mediaType === "REELS") {
      if (coverUrl) {
        payload.cover_url = coverUrl;
        payload.thumbnail_url = coverUrl;
      }
    } else {
      payload.thumbnail_url = isVideoFile(files[0]) ? null : urls[0];
    }
  }

  const res = await schedulerApi<{ post: { id: string } }>("create", payload, projectId);
  if (publishNow && res.post?.id) {
    await schedulerApi("publish_now", { id: res.post.id }, projectId);
  }
  if (!res.post?.id) throw new Error("Очередь не вернула id публикации");

  return {
    id: res.post.id,
    scheduledAt: String(payload.scheduled_at),
    status: publishNow ? "published" : "scheduled",
    mediaUrl: typeof payload.media_url === "string" ? payload.media_url : null,
    thumbnailUrl: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : null,
    childUrls: Array.isArray(payload.child_urls) ? (payload.child_urls as string[]) : null,
    caption: typeof payload.caption === "string" ? payload.caption : "",
    mediaType,
  };
}
