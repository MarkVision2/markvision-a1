/**
 * Разбор очереди публикаций: publish_jobs → пост в аккаунте площадки.
 *
 * Вызывается кроном `publish-worker-minutely` (заголовок x-automation-key) и
 * пинком из publish-intake сразу после постановки заданий. Забор заданий —
 * rpc claim_publish_jobs: аренда, статус аккаунта и дневная норма проверяются
 * в SQL, поэтому два параллельных вызова не возьмут одно задание.
 *
 * Второй проход того же тика — верификация: задания в статусе verifying
 * (площадка приняла пост) читаются обратно у площадки (claim_publish_verifications
 * → verifyPublishJob) и только после этого становятся published.
 *
 * Переходы статусов — _lib/publishRunner.ts, площадки — _lib/connectors/.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { automationKeyValid, CORS_HEADERS, json, type PublishJob } from "../_lib/publishing.ts";
import { runPublishJob, verifyPublishJob } from "../_lib/publishRunner.ts";

/** Сколько работаем за один вызов: остаток доберёт следующий тик крона. */
const WALL_CLOCK_BUDGET_MS = 45_000;
/** Бюджет ожидания обработки медиа на одном задании. */
const JOB_BUDGET_MS = 20_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!(await automationKeyValid(req, admin))) {
    // Ручной прогон очереди из интерфейса — по роли пользователя.
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) {
      return json({ error: "forbidden" }, 403);
    }
  }

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(Math.max(Number(body?.batch_size ?? 5), 1), 25);
  // Партиции по аккаунту: крон запускает три воркера в минуту, каждый берёт
  // свою треть аккаунтов и не спорит с соседями за одни и те же строки.
  const partitions = Math.min(Math.max(Number(body?.partitions ?? 1), 1), 16);
  const partition = body?.partition == null ? null : Math.min(Math.max(Number(body.partition), 0), partitions - 1);

  try {
  const { data, error } = await admin.rpc("claim_publish_jobs", {
    p_batch: batchSize,
    p_lock_timeout: "10 minutes",
    p_partition: partition,
    p_partitions: partitions,
  });
  if (error) return json({ error: error.message }, 500);

  const jobs = (data ?? []) as PublishJob[];
  const out = { claimed: jobs.length, published: 0, verifying: 0, processing: 0, retry: 0, failed: 0, manual_review: 0, verified: 0, unverified: 0, verify_pending: 0 };
  const results: unknown[] = [];
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;

  for (const job of jobs) {
    if (Date.now() > deadline) {
      // Не успели — вернём задание в очередь, не тратя попытку зря.
      await admin.from("publish_jobs")
        .update({ status: "retry", locked_at: null, attempts: Math.max(job.attempts - 1, 0) })
        .eq("id", job.id);
      out.retry++;
      continue;
    }
    const result = await runPublishJob(admin, job, { budgetMs: JOB_BUDGET_MS });
    results.push(result);
    if (result.status === "published") out.published++;
    else if (result.status === "verifying") out.verifying++;
    else if (result.status === "processing") out.processing++;
    else if (result.status === "retry") out.retry++;
    else if (result.status === "manual_review") out.manual_review++;
    else out.failed++;
  }

  // Второй проход: верификация принятых площадкой постов. Партиция 0 (или без
  // партиций) — чтобы три воркера в минуту не читали одни и те же посты.
  if ((partition ?? 0) === 0 && Date.now() < deadline) {
    const { data: due } = await admin.rpc("claim_publish_verifications", { p_batch: 20, p_lock_timeout: "5 minutes" });
    for (const job of (due ?? []) as PublishJob[]) {
      if (Date.now() > deadline) {
        await admin.from("publish_jobs").update({ locked_at: null }).eq("id", job.id);
        continue;
      }
      const v = await verifyPublishJob(admin, job);
      results.push(v);
      if (v.verification === "verified") out.verified++;
      else if (v.verification === "unverified") out.unverified++;
      else if (v.verification === "pending") out.verify_pending++;
    }
  }

  return json({ ok: true, partition, partitions, ...out, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
