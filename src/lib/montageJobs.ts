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

export type MontageFormat = "16:9" | "shorts";

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
  source_url: string;
  source_name: string | null;
  notify_telegram: boolean;
  result_video_url: string | null;
  result: { shorts?: { url: string; title?: string }[]; warnings?: string[] } | null;
  error: string | null;
  created_at: string;
  updated_at: string;
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

const sanitize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video";

/** Заливает исходник в bucket montage-uploads и возвращает публичный URL. */
export async function uploadMontageSource(
  projectId: string,
  file: File,
): Promise<{ url: string; path: string }> {
  const path = `${projectId}/${Date.now()}-${sanitize(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "video/mp4",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(`Не удалось загрузить видео: ${error.message}`);
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
  },
): Promise<void> {
  if (!projectId) throw new Error("Сначала выберите проект (клиента) вверху");
  const { error } = await db.from("montage_jobs").insert({
    project_id: projectId,
    source_url: params.sourceUrl,
    source_name: params.sourceName.slice(0, 120),
    formats: params.formats,
    shorts_count: params.formats.includes("shorts") ? params.shortsCount ?? 3 : null,
    brief: params.brief?.trim() ? params.brief.trim().slice(0, 4000) : null,
    notify_telegram: params.notifyTelegram,
  });
  if (error) throw new Error(`Не удалось создать заявку: ${error.message}`);
}

export async function fetchMontageJobs(projectId: string): Promise<MontageJob[]> {
  if (!projectId) return [];
  const { data, error } = await db
    .from("montage_jobs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
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
