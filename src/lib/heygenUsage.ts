// Учёт расходов на генерацию видео HeyGen (на проект).
import { supabase } from "@/integrations/supabase/client";

// Тарифы HeyGen (USD за минуту готового видео), pay-as-you-go.
export const RATE_USD_PER_MIN: Record<string, number> = {
  agent: 2, // Video Agent (авто-монтаж)
  avatar: 1, // talking head (Avatar III)
  clips: 1,
  template: 1,
};

export interface UsageRow {
  id: string;
  mode: string;
  source: string;
  duration_sec: number | null;
  cost_usd: number | null;
  created_at: string;
  title?: string | null;
  ref_id?: string | null;
  render_time_sec?: number | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  cover_url?: string | null;
  description?: string | null;
}

// Таблицы нет в сгенерированных типах — нетипизированный клиент.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Оценка стоимости ролика по режиму и длительности (сек). null — если длительность неизвестна. */
export function estimateCost(mode: string, durationSec?: number | null): number | null {
  if (!durationSec || durationSec <= 0) return null;
  const rate = RATE_USD_PER_MIN[mode] ?? 1;
  return Math.round((durationSec / 60) * rate * 100) / 100;
}

export async function recordUsage(
  projectId: string,
  u: {
    source: string;
    mode: string;
    ref_id?: string;
    duration_sec?: number | null;
    cost_usd?: number | null;
    title?: string | null;
    video_url?: string | null;
    thumbnail_url?: string | null;
  },
): Promise<void> {
  if (!projectId) return;
  try {
    // upsert по (project_id, ref_id) — защита от повторной записи одного и того
    // же ролика (например, при повторном срабатывании эффекта на ремаунте страницы).
    await db
      .from("heygen_usage")
      .upsert({ project_id: projectId, ...u }, { onConflict: "project_id,ref_id", ignoreDuplicates: true });
  } catch {
    /* учёт не критичен для генерации */
  }
}

export type EnqueueAgentJobResult = { ok: true } | { ok: false; error: string };

/** Ставит веб-задачу Video Agent в очередь heygen_jobs. Серверный воркер докрутит
 *  её и запишет в «Готовый контент» со статистикой — даже если закрыть вкладку.
 *  montageBrief (ТЗ на монтаж) сохраняем отдельно — воркер строит по нему
 *  обложку и описание, а не только по сценарию озвучки.
 *
 *  Важно: страница «Быстро» больше не поллит session_id сама — без успешного
 *  insert в heygen_jobs готовое видео не попадёт во вкладку «Готовые». Ошибку
 *  нужно показывать пользователю, а не глотать. */
export async function enqueueAgentJob(
  projectId: string,
  sessionId: string,
  script: string,
  aspect?: string,
  montageBrief?: string,
): Promise<EnqueueAgentJobResult> {
  if (!projectId) return { ok: false, error: "Не выбран проект" };
  if (!sessionId) return { ok: false, error: "HeyGen не вернул session_id" };
  try {
    const { error } = await db.from("heygen_jobs").insert({
      project_id: projectId,
      session_id: sessionId,
      source: "web",
      script: script.slice(0, 2000),
      montage_brief: montageBrief ? montageBrief.slice(0, 4000) : null,
      aspect: aspect ?? null,
    });
    if (error) return { ok: false, error: error.message || "Не удалось поставить в очередь" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Не удалось поставить в очередь" };
  }
}

export interface AgentJobRow {
  id: string;
  status: string | null;
  delivered: boolean | null;
  error: string | null;
  script: string | null;
  montage_brief: string | null;
  session_id: string | null;
  video_url: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Недавние заявки Video Agent (очередь + ошибки) — чтобы видеть, почему нет ролика в «Готовые». */
export async function fetchRecentAgentJobs(projectId: string): Promise<AgentJobRow[]> {
  if (!projectId) return [];
  try {
    const { data, error } = await db
      .from("heygen_jobs")
      .select("id,status,delivered,error,script,montage_brief,session_id,video_url,created_at,updated_at")
      .eq("project_id", projectId)
      .eq("source", "web")
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) return [];
    return (data ?? []) as AgentJobRow[];
  } catch {
    return [];
  }
}

export async function fetchUsage(projectId: string): Promise<UsageRow[]> {
  if (!projectId) return [];
  try {
    const { data } = await db
      .from("heygen_usage")
      .select("id,mode,source,duration_sec,cost_usd,created_at,title,ref_id,render_time_sec")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    return (data ?? []) as UsageRow[];
  } catch {
    return [];
  }
}

/** Готовые видео проекта (для раздела «Готовый контент»). */
export async function fetchFinishedVideos(projectId: string): Promise<UsageRow[]> {
  if (!projectId) return [];
  try {
    const { data } = await db
      .from("heygen_usage")
      .select("id,mode,source,duration_sec,cost_usd,created_at,title,video_url,thumbnail_url,cover_url,description")
      .eq("project_id", projectId)
      .not("video_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as UsageRow[];
  } catch {
    return [];
  }
}

// ── Недавние голоса на проект (для удобного выбора) ─────────────────────────
const recentKey = (projectId: string) => `markvision.heygen.recentVoices.${projectId || "none"}`;

export function loadRecentVoices(projectId: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(recentKey(projectId)) || "[]");
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

export function pushRecentVoice(projectId: string, voiceId: string): void {
  if (!projectId || !voiceId) return;
  try {
    const next = [voiceId, ...loadRecentVoices(projectId).filter((v) => v !== voiceId)].slice(0, 8);
    localStorage.setItem(recentKey(projectId), JSON.stringify(next));
  } catch {
    /* не критично */
  }
}
