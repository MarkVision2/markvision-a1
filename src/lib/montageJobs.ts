/**
 * Монтаж-конвейер (Контент-завод → «Монтаж съёмки»).
 *
 * Заявка = строка в `montage_jobs`: исходник («говорящая голова») заливается
 * в bucket `montage-uploads`, дальше очередь разбирает Claude-воркер
 * (скилл montage-pipeline + scripts/montage-worker.mjs): монтирует в Remotion,
 * публикует результат в heygen_usage («AI монтаж → Готовые») и, если включено,
 * присылает видео в привязанный Telegram-чат проекта.
 */
import { supabase } from "@/integrations/supabase/client";
import { clientSupabaseUrl, clientSupabasePublishableKey } from "@/lib/supabaseConfig";
import type { MontageStyleId } from "@/lib/montageTemplates";
import { getMontageStyle } from "@/lib/montageTemplates";

export type MontageFormat = "16:9" | "9:16" | "shorts" | string;

// "standard" — обычный монтаж; "5050" — сплит-скрин (спикер + запись экрана
// в важных моментах), требует второго видео (source2).
export type MontageMode = "standard" | "5050";

/** Источник B-roll — те же режимы, что у Reels-видео. */
export type MontageBrollMode = "auto" | "library" | "pexels" | "kie";

export type MontageJobStatus =
  | "queued"
  | "processing"
  | "rendering"
  | "done"
  | "failed"
  | "canceled";

export interface MontageJob {
  id: string;
  project_id: string;
  status: MontageJobStatus;
  progress: string | null;
  formats: MontageFormat[];
  shorts_count: number | null;
  brief: string | null;
  broll_mode: MontageBrollMode | null;
  asset_folder_ids: string[] | null;
  source_url: string;
  source_name: string | null;
  mode: MontageMode;
  source2_url: string | null;
  source2_name: string | null;
  notify_telegram: boolean;
  result_video_url: string | null;
  result: { shorts?: { url: string; title?: string }[]; warnings?: string[] } | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export const MONTAGE_STATUS_LABEL: Record<MontageJobStatus, string> = {
  queued: "В очереди",
  processing: "Монтируется",
  rendering: "Рендер",
  done: "Готово",
  failed: "Ошибка",
  canceled: "Отменена",
};

// Таблицы нет в сгенерированных типах — нетипизированный клиент (как heygen_usage).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const BUCKET = "montage-uploads";
const ACTIVE_MONTAGE_STATUSES: MontageJobStatus[] = ["queued", "processing", "rendering"];
const TERMINAL_MONTAGE_STATUSES: MontageJobStatus[] = ["done", "failed", "canceled"];

export function canArchiveMontageJob(job: Pick<MontageJob, "status">): boolean {
  return TERMINAL_MONTAGE_STATUSES.includes(job.status);
}

export function partitionMontageJobs(jobs: MontageJob[]): {
  active: MontageJob[];
  history: MontageJob[];
} {
  return {
    active: jobs.filter((job) => ACTIVE_MONTAGE_STATUSES.includes(job.status)),
    history: jobs.filter((job) => TERMINAL_MONTAGE_STATUSES.includes(job.status)),
  };
}

const sanitize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video";

// Supabase Storage на Free-плане жёстко режет файлы больше 50 МБ (лимит
// платформы, бакетом не поднимается). Видео со съёмки почти всегда больше,
// поэтому крупные исходники едут напрямую в Cloudflare R2 через presigned URL
// (та же схема и та же edge-функция r2-presign-upload, что у автопостинга).
const SUPABASE_UPLOAD_LIMIT = 45 * 1024 * 1024;

async function presignR2(filename: string, contentType: string, size: number): Promise<{ uploadUrl: string; publicUrl: string }> {
  const res = await fetch(`${clientSupabaseUrl}/functions/v1/r2-presign-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-key": clientSupabasePublishableKey },
    body: JSON.stringify({ filename, contentType, size }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Не удалось получить ссылку для загрузки (HTTP ${res.status})`);
  return { uploadUrl: j.uploadUrl as string, publicUrl: j.publicUrl as string };
}

// PUT через XHR ради onprogress: у fetch прогресса загрузки нет, а заливать
// гигабайтное видео с голым спиннером — значит выглядеть зависшим.
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

/** Заливает исходник (мелкие — Supabase Storage, крупные — R2) и возвращает публичный URL. */
export async function uploadMontageSource(
  projectId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; path: string }> {
  const contentType = file.type || "video/mp4";

  if (file.size > SUPABASE_UPLOAD_LIMIT) {
    const { uploadUrl, publicUrl } = await presignR2(`montage-${projectId}-${sanitize(file.name)}`, contentType, file.size);
    await putWithProgress(uploadUrl, file, contentType, onProgress);
    return { url: publicUrl, path: publicUrl };
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
  return { url: data.publicUrl, path };
}

export async function createMontageJob(
  projectId: string,
  params: {
    sourceUrl: string;
    sourceName: string;
    formats: MontageFormat[];
    shortsCount?: number | null;
    brief?: string;
    notifyTelegram: boolean;
    mode?: MontageMode;
    source2Url?: string | null;
    source2Name?: string | null;
    brollMode?: MontageBrollMode;
    assetFolderIds?: string[];
    styleId?: MontageStyleId;
  },
): Promise<void> {
  if (!projectId) throw new Error("Сначала выберите проект (клиента) вверху");
  const mode: MontageMode = params.mode ?? "standard";
  if (mode === "5050" && !params.source2Url) {
    throw new Error("Для режима 50/50 загрузите второе видео (запись экрана)");
  }
  const brollMode: MontageBrollMode = params.brollMode ?? "auto";
  const style = getMontageStyle(params.styleId);
  const folderIds = Array.from(
    new Set((params.assetFolderIds ?? []).map(String).filter(Boolean)),
  ).slice(0, 20);
  // formats — единственное поле, которое точно есть на проде.
  // Колонки broll_* могли ещё не приехать миграцией → дублируем режим сюда.
  const formats: MontageFormat[] = ["9:16"];
  if (brollMode !== "auto") {
    (formats as string[]).push(`broll:${brollMode}`);
  }
  (formats as string[]).push(`style:${style.id}`);
  for (const fid of brollMode === "library" ? folderIds : []) {
    (formats as string[]).push(`folder:${fid}`);
  }
  const briefParts = [
    params.brief?.trim() ? params.brief.trim().slice(0, 3600) : "",
    `[STYLE=${style.id}]`,
    brollMode !== "auto" ? `[BROLL_MODE=${brollMode}]` : "",
  ].filter(Boolean);
  const row: Record<string, unknown> = {
    project_id: projectId,
    source_url: params.sourceUrl,
    source_name: params.sourceName.slice(0, 120),
    // Только цельный 9:16 — без шортсов и без нарезки исходника на куски.
    formats,
    shorts_count: null,
    brief: briefParts.length ? briefParts.join("\n") : null,
    notify_telegram: params.notifyTelegram,
    broll_mode: brollMode,
    asset_folder_ids: brollMode === "library" ? folderIds : [],
  };
  // Поля 50/50 добавляем только для этого режима — стандартный монтаж не зависит
  // от наличия миграции (mode/source2_*) в БД.
  if (mode === "5050") {
    row.mode = mode;
    row.source2_url = params.source2Url ?? null;
    row.source2_name = params.source2Name ? params.source2Name.slice(0, 120) : null;
  }
  const { error } = await db.from("montage_jobs").insert(row);
  if (error) {
    // Фоллбек: колонки broll_* ещё не на проде — заявка всё равно уходит.
    if (/broll_mode|asset_folder_ids|schema cache|PGRST204/i.test(error.message)) {
      delete row.broll_mode;
      delete row.asset_folder_ids;
      const retry = await db.from("montage_jobs").insert(row);
      if (retry.error) throw new Error(`Не удалось создать заявку: ${retry.error.message}`);
      return;
    }
    throw new Error(`Не удалось создать заявку: ${error.message}`);
  }
}

export async function fetchMontageJobs(projectId: string): Promise<MontageJob[]> {
  if (!projectId) return [];
  const { data, error } = await db
    .from("montage_jobs")
    .select("*")
    .eq("project_id", projectId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as MontageJob[];
}

/** Отмена возможна, пока заявку не взял воркер. */
export async function cancelMontageJob(id: string): Promise<void> {
  const { error } = await db
    .from("montage_jobs")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued");
  if (error) throw new Error(error.message);
}

/** Убирает завершённую заявку из интерфейса, сохраняя запись и результат для аудита. */
export async function archiveMontageJob(id: string): Promise<void> {
  const { data, error } = await db
    .from("montage_jobs")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", TERMINAL_MONTAGE_STATUSES)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Можно убрать только завершённую заявку");
}

/** Убирает всю завершённую историю проекта одним действием. */
export async function archiveCompletedMontageJobs(projectId: string): Promise<void> {
  if (!projectId) return;
  const { error } = await db
    .from("montage_jobs")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .in("status", TERMINAL_MONTAGE_STATUSES)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
}
