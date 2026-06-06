/**
 * Загрузка пользовательских фото в Supabase Storage (`content-factory-uploads`,
 * public bucket в проекте `szfgdruhlebfvcmlvxdk`) и получение публичных URL.
 *
 * Зачем: n8n воркфлоу читает референсные изображения из
 * `body.image_urls: string[]`, multipart-файлы он не парсит. Поэтому
 * фронт сначала аплоадит фото и шлёт n8n уже массив URL.
 */
import { clientConfigSupabase } from "@/integrations/clientConfig/client";

const BUCKET = "content-factory-uploads";

const sanitize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface UploadedAsset {
  url: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Заливает массив File в bucket и возвращает массив объектов с публичным URL.
 * Все ошибки логируются, но НЕ роняют батч — что удалось залить, то и едет.
 */
export type UploadSubfolder = "assets" | "logo" | "people";

export async function uploadContentFactoryPhotos(
  files: File[],
  requestId: string,
  subfolder: UploadSubfolder = "assets",
): Promise<UploadedAsset[]> {
  if (!clientConfigSupabase) {
    // eslint-disable-next-line no-console
    console.warn("[content-factory] clientConfigSupabase не сконфигурирован — фото пропущены");
    return [];
  }
  if (!files.length) return [];

  const sb = clientConfigSupabase;
  const folder = `requests/${requestId}/${subfolder}`;

  const tasks = files.map(async (file, idx): Promise<UploadedAsset | null> => {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${folder}/${String(idx).padStart(2, "0")}-${newId()}.${ext}`;
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, file, {
        contentType: file.type || `image/${ext}`,
        cacheControl: "3600",
        upsert: false,
      });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[content-factory] upload failed", file.name, error);
      return null;
    }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return {
      url: data.publicUrl,
      path,
      name: sanitize(file.name),
      mimeType: file.type || `image/${ext}`,
      size: file.size,
    };
  });

  const settled = await Promise.all(tasks);
  return settled.filter((x): x is UploadedAsset => x !== null);
}
