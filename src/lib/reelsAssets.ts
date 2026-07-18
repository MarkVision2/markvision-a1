import { supabase } from "@/integrations/supabase/client";

// Таблицы добавлены отдельной миграцией и пока не входят в сгенерированные типы.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ReelsBrollMode = "auto" | "library" | "pexels" | "kie";

export interface ReelsAssetFolder {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  asset_count?: number;
}

export interface ReelsAsset {
  id: string;
  project_id: string;
  folder_id: string;
  name: string;
  media_type: "video" | "image";
  storage_path: string;
  public_url: string;
  size_bytes: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ReelsSourceConfig {
  brollMode: ReelsBrollMode;
  assetFolderIds: string[];
}

export function buildReelsSourceConfig(
  mode: ReelsBrollMode,
  folderIds: string[],
): ReelsSourceConfig {
  if (mode !== "library") return { brollMode: mode, assetFolderIds: [] };
  const unique = Array.from(new Set(folderIds.filter(Boolean)));
  if (!unique.length) return { brollMode: "auto", assetFolderIds: [] };
  return { brollMode: "library", assetFolderIds: unique };
}

export function sanitizeAssetFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const rawBase = dot > 0 ? name.slice(0, dot) : name;
  const rawExt = dot > 0 ? name.slice(dot + 1) : "";
  const base = rawBase
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "asset";
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return ext ? `${base}.${ext}` : base;
}

export async function fetchReelsAssetFolders(projectId: string): Promise<ReelsAssetFolder[]> {
  if (!projectId) return [];
  const { data, error } = await db
    .from("reels_asset_folders")
    .select("id,project_id,name,created_at,reels_assets(count)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    project_id: String(row.project_id),
    name: String(row.name),
    created_at: String(row.created_at),
    asset_count: Number((row.reels_assets as { count?: number }[] | undefined)?.[0]?.count ?? 0),
  }));
}

export async function createReelsAssetFolder(projectId: string, name: string): Promise<ReelsAssetFolder> {
  const clean = name.trim().slice(0, 80);
  if (!projectId) throw new Error("Сначала выберите проект");
  if (!clean) throw new Error("Введите название папки");
  const { data, error } = await db
    .from("reels_asset_folders")
    .insert({ project_id: projectId, name: clean })
    .select("id,project_id,name,created_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Папка с таким названием уже существует");
    throw new Error(error.message);
  }
  return { ...(data as ReelsAssetFolder), asset_count: 0 };
}

export async function deleteReelsAssetFolder(folder: ReelsAssetFolder): Promise<void> {
  const { data: assets, error: listError } = await db
    .from("reels_assets")
    .select("storage_path")
    .eq("folder_id", folder.id);
  if (listError) throw new Error(listError.message);
  const paths = (assets ?? []).map((row: { storage_path: string }) => row.storage_path);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from("reels-assets").remove(paths);
    if (storageError) throw new Error(storageError.message);
  }
  const { error } = await db.from("reels_asset_folders").delete().eq("id", folder.id);
  if (error) throw new Error(error.message);
}

export async function fetchReelsAssets(folderId: string): Promise<ReelsAsset[]> {
  if (!folderId) return [];
  const { data, error } = await db
    .from("reels_assets")
    .select("*")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReelsAsset[];
}

export async function uploadReelsAsset(
  projectId: string,
  folderId: string,
  file: File,
): Promise<ReelsAsset> {
  if (!projectId || !folderId) throw new Error("Выберите папку");
  const mediaType: ReelsAsset["media_type"] = file.type.startsWith("video/")
    ? "video"
    : file.type.startsWith("image/")
      ? "image"
      : (() => { throw new Error("Поддерживаются только видео и изображения"); })();
  // На текущем тарифе Supabase один объект ограничен 50 МБ; оставляем запас.
  if (file.size > 45 * 1024 * 1024) throw new Error("Максимальный размер одного файла — 45 МБ");

  const storagePath = `${projectId}/${folderId}/${Date.now()}-${sanitizeAssetFilename(file.name)}`;
  const { error: uploadError } = await supabase.storage.from("reels-assets").upload(storagePath, file, {
    contentType: file.type || (mediaType === "video" ? "video/mp4" : "image/jpeg"),
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw new Error(`Не удалось загрузить файл: ${uploadError.message}`);

  const { data: publicData } = supabase.storage.from("reels-assets").getPublicUrl(storagePath);
  const { data, error } = await db
    .from("reels_assets")
    .insert({
      project_id: projectId,
      folder_id: folderId,
      name: file.name.slice(0, 160),
      media_type: mediaType,
      storage_path: storagePath,
      public_url: publicData.publicUrl,
      size_bytes: file.size,
      metadata: { mime_type: file.type || null },
    })
    .select("*")
    .single();
  if (error) {
    await supabase.storage.from("reels-assets").remove([storagePath]);
    throw new Error(error.message);
  }
  return data as ReelsAsset;
}

export async function deleteReelsAsset(asset: ReelsAsset): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from("reels-assets")
    .remove([asset.storage_path]);
  if (storageError) throw new Error(storageError.message);
  const { error } = await db.from("reels_assets").delete().eq("id", asset.id);
  if (error) throw new Error(error.message);
}
