/**
 * Контент-конвейер (Reels: тема → сценарий → HeyGen → FFmpeg → согласование).
 * Клиент edge-функции content-pipeline и словари для интерфейса.
 * Контракт ответов — supabase/functions/content-pipeline/index.ts,
 * описание — docs/CONTENT-PIPELINE.md.
 */
import { supabase } from "@/integrations/supabase/client";

export type PipelineRunState =
  | "queued"
  | "claimed"
  | "script_generating"
  | "script_ready"
  | "video_requested"
  | "video_rendering"
  | "video_ready"
  | "normalizing"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "retry_wait"
  | "failed"
  | "cancelled";

export const PIPELINE_STATE_META: Record<PipelineRunState, { label: string; cls: string; step: number }> = {
  queued: { label: "В очереди", cls: "bg-muted text-muted-foreground", step: 0 },
  claimed: { label: "Взято в работу", cls: "bg-amber-500/10 text-amber-700", step: 1 },
  script_generating: { label: "Пишем сценарий", cls: "bg-amber-500/10 text-amber-700", step: 1 },
  script_ready: { label: "Сценарий готов", cls: "bg-amber-500/10 text-amber-700", step: 2 },
  video_requested: { label: "Видео заказано", cls: "bg-amber-500/10 text-amber-700", step: 2 },
  video_rendering: { label: "Рендер видео", cls: "bg-amber-500/10 text-amber-700", step: 3 },
  video_ready: { label: "Видео получено", cls: "bg-amber-500/10 text-amber-700", step: 3 },
  normalizing: { label: "Нормализация", cls: "bg-amber-500/10 text-amber-700", step: 4 },
  awaiting_review: { label: "Ждёт согласования", cls: "bg-sky-500/10 text-sky-700", step: 5 },
  approved: { label: "Одобрено", cls: "bg-emerald-500/10 text-emerald-700", step: 6 },
  rejected: { label: "Отклонено", cls: "bg-orange-500/10 text-orange-700", step: 6 },
  retry_wait: { label: "Ждёт повтора", cls: "bg-violet-500/10 text-violet-700", step: 1 },
  failed: { label: "Ошибка", cls: "bg-destructive/10 text-destructive", step: 6 },
  cancelled: { label: "Отменено", cls: "bg-muted text-muted-foreground", step: 6 },
};

/** Шаги прогресса в карточке. */
export const PIPELINE_STEPS = ["Очередь", "Сценарий", "Видео", "Рендер", "Файл", "Согласование"] as const;

export const ACTIVE_PIPELINE_STATES: readonly PipelineRunState[] = [
  "queued",
  "claimed",
  "script_generating",
  "script_ready",
  "video_requested",
  "video_rendering",
  "video_ready",
  "normalizing",
  "retry_wait",
];

export function isActivePipelineState(state: PipelineRunState | null | undefined): boolean {
  return !!state && ACTIVE_PIPELINE_STATES.includes(state);
}

export interface PipelineScript {
  hook: string;
  script: string;
  title: string;
  description: string;
  hashtags: string[];
}

export interface PipelineRun {
  id: string;
  state: PipelineRunState;
  state_label: string;
  attempt: number;
  provider: string | null;
  provider_job_id: string | null;
  started_at: string;
  finished_at: string | null;
  state_changed_at: string;
  heartbeat_at: string | null;
  next_retry_at: string | null;
  error_code: string | null;
  error_user: string | null;
  error_at: string | null;
  cost_usd: number;
  script: PipelineScript | null;
  model: string | null;
  prompt_version: string | null;
  created_at: string;
  events?: PipelineEvent[];
}

export interface PipelineEvent {
  from_state: PipelineRunState | null;
  to_state: PipelineRunState;
  note: Record<string, unknown>;
  created_at: string;
}

export interface PipelineAsset {
  id: string;
  pipeline_run_id: string;
  asset_type: "provider_video" | "normalized_video" | "thumbnail" | "script";
  version: number;
  public_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  checksum_sha256: string | null;
  created_at: string;
}

export interface PipelineReview {
  id: string;
  pipeline_run_id: string;
  decision: "approved" | "rejected";
  comment: string | null;
  reviewer_id: string | null;
  reviewer_label: string | null;
  source: "markvision" | "telegram";
  created_at: string;
}

export interface PipelineDetail {
  item: {
    id: string;
    project_id: string;
    title: string;
    description: string | null;
    prompts: string | null;
    category: string;
    hashtags: string | null;
    status: string;
    media_url: string | null;
    created_at: string;
    updated_at: string;
  };
  current_run: PipelineRun | null;
  script: PipelineScript | null;
  runs: PipelineRun[];
  assets: PipelineAsset[];
  reviews: PipelineReview[];
  can: { generate: boolean; review: boolean; retry: boolean; cancel: boolean };
  already_running?: boolean;
  queued?: boolean;
  kicked?: boolean;
}

/** Длительность запуска: от старта до финиша или до текущего момента. */
export function runDurationSeconds(run: Pick<PipelineRun, "started_at" | "finished_at">, now = Date.now()): number {
  const start = Date.parse(run.started_at);
  if (Number.isNaN(start)) return 0;
  const end = run.finished_at ? Date.parse(run.finished_at) : now;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} с`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m} мин ${s} с` : `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}

/** Индекс активного шага для прогресс-бара (0..PIPELINE_STEPS.length). */
export function pipelineStepIndex(state: PipelineRunState | null | undefined): number {
  if (!state) return 0;
  return PIPELINE_STATE_META[state]?.step ?? 0;
}

/* ───────────────────────────── API ───────────────────────────── */

async function call<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`content-pipeline/${path}`, {
    method,
    ...(body ? { body } : {}),
  });
  if (error) {
    // FunctionsHttpError несёт тело ответа с человекочитаемой ошибкой.
    const ctx = (error as { context?: Response }).context;
    let message = error.message || "Ошибка запроса";
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) message = j.error;
      } catch {
        /* ignore */
      }
    }
    throw new Error(message);
  }
  const payload = data as (T & { error?: string }) | null;
  if (!payload) throw new Error("Пустой ответ");
  if (payload.error) throw new Error(payload.error);
  return payload;
}

export const contentPipelineApi = {
  get: (itemId: string) => call<PipelineDetail>(`items/${itemId}`, "GET"),
  create: (input: { project_id: string; title: string; description?: string; prompts?: string; category?: string }) =>
    call<PipelineDetail>("items", "POST", input),
  generate: (itemId: string) => call<PipelineDetail>(`items/${itemId}/generate`, "POST", {}),
  review: (itemId: string, decision: "approved" | "rejected", comment?: string) =>
    call<PipelineDetail>(`items/${itemId}/review`, "POST", { decision, comment: comment ?? null }),
  retry: (itemId: string, comment?: string) =>
    call<PipelineDetail>(`items/${itemId}/retry`, "POST", { comment: comment ?? null }),
  cancel: (itemId: string) => call<PipelineDetail>(`items/${itemId}/cancel`, "POST", {}),
};
