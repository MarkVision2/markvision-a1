// Очередь вертикальных VoiceOver-креативов (video-creative-system) — на проект.
// Фронт кладёт задачу в vcs_jobs через RLS-клиент (как reels_jobs); Claude-сессия
// разбирает очередь (scripts/vcs-worker.mjs + пайплайн video-creative-system) и
// публикует готовый ролик в heygen_usage → «AI монтаж → Готовые». Ключи
// провайдеров (ElevenLabs/Google) в config НЕ кладём — их подставляет воркер из
// секретов. См. docs/VCS-PIPELINE.md.
import { supabase } from "@/integrations/supabase/client";

// Таблиц нет в сгенерированных типах — нетипизированный клиент (как в reelsQueue).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// Профиль рендера video-creative-system: classic (видео-хук + титры) или
// kinetic_clipart_v4 (кинетические титры + клипарт/инфографика).
export type VcsProfile = "classic" | "kinetic_clipart_v4";

// Настройки рендера БЕЗ ключей — то, что задаёт пользователь в форме.
export interface VcsConfig {
  profile: VcsProfile;
  elevenVoice?: string; // voice_id ElevenLabs (из ELEVEN_VOICES)
  voiceGenerationSpeed?: number; // скорость озвучки при генерации (1.0–1.3)
  music: boolean; // подкладывать музыку
  format?: "9:16"; // пока только вертикаль
}

export interface VcsJobRow {
  id: string;
  status: string; // queued | processing | rendering | done | failed
  progress: string | null;
  script: string | null;
  error: string | null;
  created_at: string;
}

export interface VcsResultRow {
  id: string;
  mode: string;
  duration_sec: number | null;
  created_at: string;
  title: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  description: string | null;
}

export function makeSessionId(): string {
  return `vcs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ставит задачу вертикального креатива в очередь vcs_jobs. RLS скоупит по проекту. */
export async function enqueueVcsJob(
  projectId: string,
  script: string,
  config: VcsConfig,
): Promise<{ ok: boolean; error?: string }> {
  if (!projectId) return { ok: false, error: "Не выбран проект" };
  if (!script.trim()) return { ok: false, error: "Пустой сценарий" };
  try {
    const { error } = await db.from("vcs_jobs").insert({
      project_id: projectId,
      session_id: makeSessionId(),
      source: "web",
      status: "queued",
      script: script.slice(0, 4000),
      config,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Ошибка постановки задачи" };
  }
}

/** Активные/упавшие задачи проекта — для индикатора «в очереди / рендерится». */
export async function fetchActiveVcsJobs(projectId: string): Promise<VcsJobRow[]> {
  if (!projectId) return [];
  try {
    const { data } = await db
      .from("vcs_jobs")
      .select("id,status,progress,script,error,created_at")
      .eq("project_id", projectId)
      .in("status", ["queued", "processing", "rendering", "failed"])
      .order("created_at", { ascending: false })
      .limit(20);
    return (data ?? []) as VcsJobRow[];
  } catch {
    return [];
  }
}

/** Готовые вертикальные креативы проекта (heygen_usage, mode=vcs) — для галереи. */
export async function fetchFinishedVcs(projectId: string): Promise<VcsResultRow[]> {
  if (!projectId) return [];
  try {
    const { data } = await db
      .from("heygen_usage")
      .select("id,mode,duration_sec,created_at,title,video_url,thumbnail_url,description")
      .eq("project_id", projectId)
      .eq("mode", "vcs")
      .not("video_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as VcsResultRow[];
  } catch {
    return [];
  }
}
