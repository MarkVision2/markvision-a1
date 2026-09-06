/**
 * Трасса задания публикации: шаги в publish_job_events + структурный лог в
 * stdout (JSON с trace_id). По trace_id восстанавливается вся цепочка:
 * api → intake → worker → площадка → верификация.
 *
 * Токены и сырые ответы площадок сюда не пишутся — только шаги и короткие
 * данные (коды, идентификаторы, длительности). Сырые ответы остаются в
 * publish_logs (logJob), как и раньше.
 */
/**
 * Минимальный контракт клиента: модуль импортируется и вне Deno (vitest), поэтому
 * не тянет типы supabase-js по URL; клиент Supabase подходит структурно.
 */
export interface TraceAdmin {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<unknown>;
    upsert(values: Record<string, unknown>, options?: { onConflict?: string; ignoreDuplicates?: boolean }): PromiseLike<unknown>;
  };
}

export type TraceStep =
  | "JOB_CREATED" | "JOB_CLAIMED" | "AUTH_OK" | "AUTH_REFRESHED" | "AUTH_FAILED"
  | "CAPABILITY_OK" | "CAPABILITY_MISSING" | "MEDIA_OK"
  | "UPLOAD_STARTED" | "PROVIDER_PROCESSING" | "MEDIA_CREATED"
  | "VERIFY_STARTED" | "VERIFIED" | "VERIFY_PENDING" | "VERIFY_SKIPPED" | "UNVERIFIED"
  | "SUCCESS" | "RETRY" | "FAILED" | "MANUAL_REVIEW" | "CANCELLED" | "BUDGET_EXCEEDED";

export interface TraceContext {
  jobId: string;
  projectId: string;
  accountId?: string | null;
  traceId?: string | null;
}

export interface TraceEntry {
  step: TraceStep;
  level?: "info" | "warning" | "error";
  message?: string;
  data?: Record<string, unknown>;
}

const SECRET_KEYS = /token|secret|authorization|password|cookie/i;

/** Данные шага без ключей, похожих на секреты, и без длинных строк. */
export function sanitizeTraceData(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SECRET_KEYS.test(k)) continue;
    out[k] = typeof v === "string" && v.length > 500 ? `${v.slice(0, 500)}…` : v;
  }
  return out;
}

/** Структурная строка лога для Supabase Logs (фильтруется по trace_id / job_id). */
export function traceLine(ctx: TraceContext, entry: TraceEntry, at = new Date()): string {
  return JSON.stringify({
    at: at.toISOString(),
    scope: "publish",
    trace_id: ctx.traceId ?? null,
    job_id: ctx.jobId,
    project_id: ctx.projectId,
    account_id: ctx.accountId ?? null,
    step: entry.step,
    level: entry.level ?? "info",
    message: entry.message ?? null,
    data: sanitizeTraceData(entry.data),
  });
}

/**
 * Записать шаг. Никогда не роняет публикацию: ошибка записи — молча в консоль.
 * Возвращает промис, который безопасно не ждать (fire-and-forget) — но в
 * раннере мы ждём, чтобы порядок шагов в журнале совпадал с реальным.
 */
export async function traceStep(admin: TraceAdmin, ctx: TraceContext, entry: TraceEntry): Promise<void> {
  const line = traceLine(ctx, entry);
  if (entry.level === "error") console.error(line); else console.log(line);
  try {
    await admin.from("publish_job_events").insert({
      job_id: ctx.jobId,
      project_id: ctx.projectId,
      account_id: ctx.accountId ?? null,
      trace_id: ctx.traceId ?? null,
      step: entry.step,
      level: entry.level ?? "info",
      message: entry.message?.slice(0, 1000) ?? null,
      data: sanitizeTraceData(entry.data),
    });
  } catch {
    // журнал не должен мешать работе
  }
}

/** Уведомление проекта в центр уведомлений; dedupe_key защищает от дублей (unique index). */
export async function notifyCenter(
  admin: TraceAdmin,
  n: {
    projectId: string;
    kind: string;
    severity?: "info" | "warning" | "error";
    title: string;
    body?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    dedupeKey?: string | null;
  },
): Promise<void> {
  try {
    await admin.from("publish_notifications").upsert({
      project_id: n.projectId,
      kind: n.kind,
      severity: n.severity ?? "info",
      title: n.title.slice(0, 300),
      body: n.body?.slice(0, 2000) ?? null,
      entity_type: n.entityType ?? null,
      entity_id: n.entityId ?? null,
      dedupe_key: n.dedupeKey ?? null,
    }, n.dedupeKey ? { onConflict: "project_id,dedupe_key", ignoreDuplicates: true } : undefined);
  } catch {
    // уведомление не должно мешать работе
  }
}
