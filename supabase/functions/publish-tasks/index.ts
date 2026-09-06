/**
 * Routine Engine: выполнение задач рутин вокруг публикации (docs/JOBS.md, «Рутины»).
 *
 * Шаги рутины (publish_routines.steps) материализуются триггером в publish_tasks:
 * ACCOUNT_HEALTH_CHECK / TOKEN_CHECK — до публикации (от scheduled_at), METRICS_SYNC —
 * после (от published_at). Этот воркер по крону ежеминутно забирает due-задачи
 * (claim_publish_tasks) и зовёт существующие функции: health — publish-monitor
 * {mode:"health", account_ids}, метрики — publish-metrics {job_ids, checkpoint:"r<N>m"}.
 * Отказ — до 3 попыток с паузой 5 минут, потом failed. Ничего не публикует.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { automationKeyValid, CORS_HEADERS, json } from "../_lib/publishing.ts";

const WALL_CLOCK_BUDGET_MS = 45_000;
const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = 5;

interface Task {
  id: number;
  project_id: string;
  routine_id: string | null;
  job_id: string | null;
  account_id: string | null;
  task_type: "ACCOUNT_HEALTH_CHECK" | "TOKEN_CHECK" | "METRICS_SYNC";
  run_at: string;
  attempts: number;
}

async function automationKey(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from("automation_settings").select("cron_secret").eq("id", true).maybeSingle();
  return (data as { cron_secret?: string | null } | null)?.cron_secret ?? "";
}

async function callFn(fn: string, body: unknown, key: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      "x-automation-key": key,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40_000),
  });
  const parsed = await res.json().catch(() => ({ error: `${fn}: ответ не JSON (HTTP ${res.status})` }));
  return { status: res.status, body: (parsed ?? {}) as Record<string, unknown> };
}

/** Смещение шага от публикации → метка контрольной точки r<минуты>m. */
export function routineCheckpoint(runAt: string, publishedAt: string | null): string {
  const minutes = publishedAt ? Math.max(0, Math.round((Date.parse(runAt) - Date.parse(publishedAt)) / 60_000)) : 0;
  return `r${minutes}m`;
}

async function runTask(admin: SupabaseClient, t: Task, key: string): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (t.task_type === "ACCOUNT_HEALTH_CHECK" || t.task_type === "TOKEN_CHECK") {
    if (!t.account_id) return { ok: false, error: "нет аккаунта" };
    const r = await callFn("publish-monitor", { mode: "health", project_id: t.project_id, account_ids: [t.account_id] }, key);
    if (r.status >= 400) return { ok: false, error: String(r.body.error ?? `HTTP ${r.status}`) };
    const acc = ((r.body.accounts as { id: string; alive: boolean | null; health_score: number; reasons: string[] }[] | undefined) ?? [])[0];
    return { ok: true, result: acc ? { alive: acc.alive, health_score: acc.health_score, reasons: acc.reasons } : { checked: r.body.checked } };
  }
  if (!t.job_id) return { ok: false, error: "нет задания" };
  const { data: job } = await admin.from("publish_jobs").select("status, published_at, external_post_id").eq("id", t.job_id).maybeSingle();
  const j = job as { status: string; published_at: string | null; external_post_id: string | null } | null;
  if (!j || j.status !== "published" || !j.external_post_id) return { ok: false, error: "задание не опубликовано — метрик нет" };
  const checkpoint = routineCheckpoint(t.run_at, j.published_at);
  const r = await callFn("publish-metrics", { job_ids: [t.job_id], checkpoint }, key);
  if (r.status >= 400) return { ok: false, error: String(r.body.error ?? `HTTP ${r.status}`) };
  if (Number(r.body.collected ?? 0) < 1) return { ok: false, error: `метрики не сняты: ${JSON.stringify(r.body.reasons ?? {}).slice(0, 300)}` };
  return { ok: true, result: { checkpoint, collected: r.body.collected } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (!(await automationKeyValid(req, admin))) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) return json({ error: "forbidden" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batch = Math.min(Math.max(Number(body?.batch_size ?? 20), 1), 100);
    const { data, error } = await admin.rpc("claim_publish_tasks", { p_batch: batch, p_lock_timeout: "5 minutes" });
    if (error) return json({ error: error.message }, 500);
    const tasks = (data ?? []) as Task[];
    const out = { claimed: tasks.length, done: 0, retry: 0, failed: 0, skipped: 0 };
    if (!tasks.length) return json({ ok: true, ...out });
    const key = await automationKey(admin);
    const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;

    for (const t of tasks) {
      if (Date.now() > deadline) {
        await admin.from("publish_tasks").update({ status: "pending", locked_at: null, attempts: Math.max(t.attempts - 1, 0) }).eq("id", t.id);
        out.skipped++;
        continue;
      }
      let r: { ok: boolean; result?: unknown; error?: string };
      try { r = await runTask(admin, t, key); } catch (e) { r = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
      if (r.ok) {
        await admin.from("publish_tasks").update({ status: "done", locked_at: null, result: r.result ?? null, error: null, finished_at: new Date().toISOString() }).eq("id", t.id);
        out.done++;
      } else if (t.attempts < MAX_ATTEMPTS) {
        await admin.from("publish_tasks").update({ status: "pending", locked_at: null, error: r.error?.slice(0, 500) ?? null, run_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString() }).eq("id", t.id);
        out.retry++;
      } else {
        await admin.from("publish_tasks").update({ status: "failed", locked_at: null, error: r.error?.slice(0, 500) ?? null, finished_at: new Date().toISOString() }).eq("id", t.id);
        out.failed++;
      }
    }
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
