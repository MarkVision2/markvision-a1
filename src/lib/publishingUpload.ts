/**
 * Заливка видеофайла для массовой публикации.
 *
 * Мелкие файлы едут в Supabase Storage (bucket `publish-uploads`), крупные —
 * напрямую в Cloudflare R2 через presigned URL: на Free-плане Storage жёстко
 * режет всё, что больше 50 МБ, а ролик со съёмки почти всегда тяжелее.
 * Схема и edge-функция те же, что у монтажа и автопостинга.
 */
import { supabase } from "@/integrations/supabase/client";
import { clientSupabaseUrl, clientSupabasePublishableKey } from "@/lib/supabaseConfig";

const BUCKET = "publish-uploads";
const SUPABASE_UPLOAD_LIMIT = 45 * 1024 * 1024;
/** Потолок r2-presign-upload — дальше площадки всё равно не примут. */
export const MAX_UPLOAD_BYTES = 2048 * 1024 * 1024;

/** Площадки принимают mp4/mov; всё остальное отсекаем до заливки. */
export const ACCEPT_VIDEO = "video/mp4,video/quicktime,.mp4,.mov,.m4v";

const EXT_RE = /\.(mp4|mov|m4v)$/i;

const sanitize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video.mp4";

/** «412,3 МБ» — размер файла для строки под именем. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ГБ`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** Проверка файла до заливки: null — годится, строка — что не так. */
export function validateVideoFile(file: File): string | null {
  const okType = file.type.startsWith("video/");
  const okExt = EXT_RE.test(file.name);
  if (!okType && !okExt) return "Нужен видеофайл .mp4 или .mov";
  if (okType && !okExt && !/^video\/(mp4|quicktime|x-m4v)$/.test(file.type)) {
    return "Площадки принимают только .mp4 и .mov — переконвертируйте файл";
  }
  if (file.size === 0) return "Файл пустой";
  if (file.size > MAX_UPLOAD_BYTES) return `Файл больше ${formatBytes(MAX_UPLOAD_BYTES)} — сожмите ролик перед заливкой`;
  return null;
}

async function presignR2(filename: string, contentType: string, size: number): Promise<{ uploadUrl: string; publicUrl: string }> {
  const res = await fetch(`${clientSupabaseUrl}/functions/v1/r2-presign-upload`, {
    method: "POST",
    // Authorization обязателен: шлюз Supabase с verify_jwt=true отбрасывает запрос
    // до функции, а publishable-ключ он принимает как anon-JWT.
    headers: {
      "Content-Type": "application/json",
      "x-app-key": clientSupabasePublishableKey,
      apikey: clientSupabasePublishableKey,
      Authorization: `Bearer ${clientSupabasePublishableKey}`,
    },
    body: JSON.stringify({ filename, contentType, size }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Не удалось получить ссылку для загрузки (HTTP ${res.status})`);
  return { uploadUrl: j.uploadUrl as string, publicUrl: j.publicUrl as string };
}

// PUT через XHR ради onprogress: у fetch прогресса загрузки нет, а заливать
// гигабайтный ролик с голым спиннером — значит выглядеть зависшим.
function putWithProgress(url: string, file: File, contentType: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Загрузка в хранилище не удалась (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Сетевая ошибка при загрузке — проверьте соединение и попробуйте ещё раз"));
    xhr.send(file);
  });
}

/** Заливает ролик и возвращает публичный https-URL для publish_video. */
export async function uploadPublishVideo(
  projectId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ url: string }> {
  const invalid = validateVideoFile(file);
  if (invalid) throw new Error(invalid);
  const contentType = file.type || "video/mp4";

  if (file.size > SUPABASE_UPLOAD_LIMIT) {
    const { uploadUrl, publicUrl } = await presignR2(`publish-${projectId}-${sanitize(file.name)}`, contentType, file.size);
    try {
      await putWithProgress(uploadUrl, file, contentType, onProgress);
    } catch (e) {
      // Один повтор на обрыв сети: гигабайтный ролик не должен падать от одного разрыва.
      if (!(e instanceof Error) || !/Сетевая ошибка/.test(e.message)) throw e;
      onProgress?.(0);
      await putWithProgress(uploadUrl, file, contentType, onProgress);
    }
    return { url: publicUrl };
  }

  const path = `${projectId}/${Date.now()}-${sanitize(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(`Не удалось загрузить видео: ${error.message}`);
  onProgress?.(100);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
