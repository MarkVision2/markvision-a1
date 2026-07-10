// Очередь рендера Reels-видео (Reels Factory) — на проект.
// Фронт кладёт задачу в reels_jobs через RLS-клиент (как heygen_jobs);
// воркер на VPS её докручивает и пишет готовое видео в reels_usage —
// даже если закрыть вкладку. Ключи (ElevenLabs/Pexels/FAL) в config НЕ кладём —
// их подставляет воркер из секретов. См. docs/TZ-reels-factory-integration.md.
import { supabase } from "@/integrations/supabase/client";

// Таблиц нет в сгенерированных типах — нетипизированный клиент (как в heygenUsage).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type VoiceProvider = "elevenlabs" | "freedom";
export type VideoMode = "faceless" | "avatar";
export type GenProvider = "none" | "fal";

// Настройки рендера БЕЗ ключей — то, что задаёт пользователь в форме.
export interface ReelsConfig {
  voiceProvider: VoiceProvider;
  freedomVoice?: string; // голос Freedom Speech (каз/рус), если voiceProvider=freedom
  videoMode: VideoMode;
  format?: string; // творческий формат (auto/testimonial/expert…) → template движка
  music: boolean; // подкладывать музыку
  genProvider: GenProvider; // ИИ-генерация кадров (fal) или только сток/локальные (none)
  genMax?: number; // лимит ИИ-клипов на ролик
}

export interface ReelsJobRow {
  id: string;
  status: string; // queued | rendering | done | error
  progress: number | null;
  stage: string | null;
  script: string | null;
  error: string | null;
  created_at: string;
}

export interface ReelsResultRow {
  id: string;
  mode: string;
  duration_sec: number | null;
  cost_usd: number | null;
  created_at: string;
  title: string | null;
  video_url: string | null;
  cover_url: string | null;
  thumbnail_url: string | null;
  description: string | null;
}

export function makeSessionId(): string {
  return `reel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ставит задачу Reels в очередь reels_jobs. RLS скоупит по проекту. */
export async function enqueueReelsJob(
  projectId: string,
  script: string,
  config: ReelsConfig,
): Promise<{ ok: boolean; error?: string }> {
  if (!projectId) return { ok: false, error: "Не выбран проект" };
  if (!script.trim()) return { ok: false, error: "Пустой сценарий" };
  try {
    const { error } = await db.from("reels_jobs").insert({
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

/** Активные/упавшие задачи проекта — для индикатора прогресса «в очереди / рендерится N%». */
export async function fetchActiveReelsJobs(projectId: string): Promise<ReelsJobRow[]> {
  if (!projectId) return [];
  try {
    const { data } = await db
      .from("reels_jobs")
      .select("id,status,progress,stage,script,error,created_at")
      .eq("project_id", projectId)
      .in("status", ["queued", "rendering", "error"])
      .order("created_at", { ascending: false })
      .limit(20);
    return (data ?? []) as ReelsJobRow[];
  } catch {
    return [];
  }
}

/** Готовые Reels проекта (для галереи). */
export async function fetchFinishedReels(projectId: string): Promise<ReelsResultRow[]> {
  if (!projectId) return [];
  try {
    const { data } = await db
      .from("reels_usage")
      .select("id,mode,duration_sec,cost_usd,created_at,title,video_url,cover_url,thumbnail_url,description")
      .eq("project_id", projectId)
      .not("video_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as ReelsResultRow[];
  } catch {
    return [];
  }
}
