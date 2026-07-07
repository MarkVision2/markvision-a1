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
    await db.from("heygen_usage").insert({ project_id: projectId, ...u });
  } catch {
    /* учёт не критичен для генерации */
  }
}

export async function fetchUsage(projectId: string): Promise<UsageRow[]> {
  if (!projectId) return [];
  try {
    const { data } = await db
      .from("heygen_usage")
      .select("id,mode,source,duration_sec,cost_usd,created_at")
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
