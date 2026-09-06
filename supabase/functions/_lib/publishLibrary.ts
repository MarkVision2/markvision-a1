/**
 * Шов между цехами и очередью публикации.
 *
 * Готовый ролик рождается в трёх местах — контент-завод, AI-монтаж, Reels — и до сих пор
 * только контент-завод клал его в `publish_videos`. Монтаж и Reels писали в свои витрины
 * «Готовые» (`heygen_usage`, `reels_usage`), а в очередь публикации не попадали вовсе:
 * ролик был, а опубликовать его можно было только перезалив руками.
 *
 * Кладём со статусом `ready` — то есть в библиотеку, а не сразу в эфир: раскладку по
 * аккаунтам человек запускает сам (или контент-завод по своей ветке). Автоматически
 * публиковать всё подряд, что отрендерилось, — не то, чего от системы ждут.
 */
// Версия клиента та же, что у вызывающих функций (montage-worker, reels-tts): типы
// supabase-js между версиями несовместимы, и общий модуль обязан совпадать с ними.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export interface LibraryInput {
  projectId: string;
  fileUrl: string;
  title: string;
  /** Описание из publish.md или сценария — станет подписью к посту. */
  caption?: string | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  /** Цех-источник: montage | montage-short | reels. */
  source: string;
  /** Идентификатор ролика в цехе — по нему и ловим повтор. */
  sourceRef: string;
}

/**
 * Положить ролик в библиотеку публикации. Идемпотентно по паре источник + ссылка на него:
 * повторный прогон того же рендера не плодит вторую карточку, иначе один ролик разошёлся бы
 * по аккаунтам дважды.
 */
export async function addToPublishLibrary(
  db: SupabaseClient,
  input: LibraryInput,
): Promise<{ videoId: string | null; warning?: string }> {
  const { data: existing } = await db.from("publish_videos")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("source", input.source)
    .eq("source_ref", input.sourceRef)
    .maybeSingle();
  if (existing) return { videoId: (existing as { id: string }).id };

  const { data, error } = await db.from("publish_videos").insert({
    project_id: input.projectId,
    file_url: input.fileUrl,
    title: input.title.slice(0, 200),
    base_caption: input.caption ?? null,
    thumbnail_url: input.thumbnailUrl ?? null,
    duration_sec: input.durationSec ?? null,
    source: input.source,
    source_ref: input.sourceRef,
    status: "ready",
  }).select("id").maybeSingle();

  if (error || !data) return { videoId: null, warning: `publish_videos: ${error?.message ?? "не создан"}` };
  return { videoId: (data as { id: string }).id };
}
