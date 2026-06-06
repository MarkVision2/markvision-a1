/**
 * Загрузка файлов бренд-шаблонов в Clony Supabase Storage (bucket content-factory).
 */
import { getContentFactoryDb } from "@/lib/contentFactoryDb";

const BUCKET = "content-factory";

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function uploadBrandAsset(
  file: File,
  projectId: string,
  templateId: string,
  kind: "logo" | "reference" | "brandbook",
): Promise<string | null> {
  const sb = getContentFactoryDb();
  if (!sb) {
    console.warn("[content-factory] Clony Supabase не настроен — brand upload пропущен");
    return null;
  }

  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const folder =
    kind === "logo"
      ? `brand/${projectId}/${templateId}`
      : `brand/${projectId}/${templateId}/${kind}s`;
  const path =
    kind === "logo"
      ? `${folder}/logo-${newId()}.${ext}`
      : `${folder}/${newId()}.${ext}`;

  const { error } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) {
    console.error("[content-factory] brand upload failed", file.name, error);
    return null;
  }
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadBrandAssets(
  files: File[],
  projectId: string,
  templateId: string,
  kind: "reference" | "brandbook",
): Promise<string[]> {
  const tasks = files.map((f) => uploadBrandAsset(f, projectId, templateId, kind));
  const settled = await Promise.all(tasks);
  return settled.filter((u): u is string => Boolean(u));
}
