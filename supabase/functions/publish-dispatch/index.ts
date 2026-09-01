/**
 * HTTP-точка публикации: `POST /publish-dispatch/<platform>`.
 *
 * Это контракт из ТЗ (`POST /publish/instagram`) — им пользуется n8n и ручной
 * повтор из интерфейса. Очередь ходит не сюда, а напрямую в _lib/publishRunner,
 * поэтому оба пути публикуют одним и тем же кодом.
 *
 * Тело:
 *   { job_id?, account_id?, video_url?, caption?, hashtags?[] }
 * С job_id — публикуется задание очереди со всеми переходами статусов.
 * Без job_id — разовая публикация в аккаунт (account_id + video_url).
 *
 * Ответ: { success, status, external_post_id, external_post_url }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import {
  automationKeyValid,
  composeCaption,
  CORS_HEADERS,
  decryptSecret,
  isPlatform,
  json,
  logJob,
  markAccountFailure,
  markAccountSuccess,
  type Platform,
  type PublishAccount,
  type PublishJob,
} from "../_lib/publishing.ts";
import { publisherFor } from "../_lib/publishers/index.ts";
import { runPublishJob } from "../_lib/publishRunner.ts";

function platformFromUrl(url: URL): Platform | null {
  // .../functions/v1/publish-dispatch/instagram
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  return isPlatform(last) ? last : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!(await automationKeyValid(req, admin))) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) {
      return json({ error: "forbidden" }, 403);
    }
  }

  const body = await req.json().catch(() => ({}));

  /* ── путь 1: задание очереди ── */
  const jobId = typeof body?.job_id === "string" ? body.job_id : null;
  if (jobId) {
    const { data } = await admin.from("publish_jobs").select("*").eq("id", jobId).maybeSingle();
    const job = data as PublishJob | null;
    if (!job) return json({ success: false, error: "job not found" }, 404);

    const result = await runPublishJob(admin, job, { budgetMs: 25_000 });
    return json({
      success: result.status === "published",
      status: result.status,
      external_post_id: result.externalPostId ?? null,
      external_post_url: result.externalPostUrl ?? null,
      message: result.message ?? null,
    });
  }

  /* ── путь 2: разовая публикация в аккаунт ── */
  const url = new URL(req.url);
  const platform = platformFromUrl(url) ?? (isPlatform(body?.platform) ? body.platform : null);
  const accountId = typeof body?.account_id === "string" ? body.account_id : null;
  const videoUrl = typeof body?.video_url === "string" ? body.video_url : null;
  if (!platform) return json({ success: false, error: "platform required: /publish-dispatch/<platform>" }, 400);
  if (!accountId || !videoUrl) return json({ success: false, error: "account_id и video_url обязательны" }, 400);

  const { data: accountRow } = await admin
    .from("publish_accounts").select("*").eq("id", accountId).maybeSingle();
  const account = accountRow as PublishAccount | null;
  if (!account) return json({ success: false, error: "account not found" }, 404);
  if (account.platform !== platform) {
    return json({ success: false, error: `аккаунт принадлежит площадке ${account.platform}` }, 400);
  }

  let token: string | null;
  try {
    token = await decryptSecret(account.access_token_encrypted);
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
  if (!token) return json({ success: false, error: "у аккаунта нет токена — нужен reconnect" }, 409);

  const hashtags = Array.isArray(body?.hashtags) ? body.hashtags.map(String) : [];
  const outcome = await publisherFor(platform)({
    account,
    token,
    videoUrl,
    thumbnailUrl: typeof body?.thumbnail_url === "string" ? body.thumbnail_url : null,
    caption: composeCaption(typeof body?.caption === "string" ? body.caption : "", hashtags),
    title: typeof body?.title === "string" ? body.title : null,
    containerId: typeof body?.container_id === "string" ? body.container_id : null,
    budgetMs: 25_000,
  });

  if (outcome.status === "published") {
    await markAccountSuccess(admin, account.id);
    await logJob(admin, {
      accountId: account.id,
      message: `разовая публикация: ${outcome.externalPostUrl ?? outcome.externalPostId}`,
      raw: outcome.raw,
    });
    return json({
      success: true,
      status: "published",
      external_post_id: outcome.externalPostId,
      external_post_url: outcome.externalPostUrl,
    });
  }

  if (outcome.status === "processing") {
    await logJob(admin, {
      accountId: account.id,
      message: `медиа обрабатывается, контейнер ${outcome.containerId}`,
    });
    return json({
      success: false,
      status: "processing",
      container_id: outcome.containerId,
      message: "медиа принято площадкой, публикация ещё не завершена — повторите вызов с container_id",
    });
  }

  await markAccountFailure(admin, account, outcome.kind, outcome.message);
  await logJob(admin, {
    accountId: account.id, level: "error",
    message: `${outcome.kind}/${outcome.code}: ${outcome.message}`, raw: outcome.raw,
  });
  return json({
    success: false,
    status: "failed",
    error_kind: outcome.kind,
    error_code: outcome.code,
    error_message: outcome.message,
  }, 422);
});
