/**
 * Выполнение одного задания публикации: общая часть очереди (publish-worker)
 * и ручного вызова (publish-dispatch).
 *
 * Здесь живут переходы статусов — то, ради чего очередь и заводилась:
 * что считать поводом повторить, что поводом погасить аккаунт, а что
 * окончательным отказом.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  composeCaption,
  decryptSecret,
  encryptSecret,
  logJob,
  markAccountFailure,
  markAccountSuccess,
  notifyModeOf,
  notifyProject,
  type PublishAccount,
  type PublishJob,
  type PublishVideo,
} from "./publishing.ts";
import type { PublishOutcome } from "./publishers/types.ts";
import { isOAuthPlatform, parseTokenResponse, refreshRequest, tokenError, tokenNeedsRefresh } from "./publishOAuth.ts";
import { connectorFor } from "./connectors/index.ts";
import { hasCapability } from "./publishCapabilities.ts";
import { classifyError, decideRetry, MAX_VERIFY_ATTEMPTS, verifyDelayMinutes } from "./publishPolicy.ts";
import { notifyCenter, traceStep, type TraceContext } from "./publishTrace.ts";

/**
 * Короткоживущие токены (TikTok — сутки, YouTube — час) обновляются перед
 * публикацией refresh_token'ом; Threads — самим long-lived токеном за 10 дней
 * до истечения. Обновлённый токен сразу шифруется в аккаунт.
 */
export async function ensureFreshToken(
  admin: SupabaseClient,
  account: PublishAccount,
  token: string,
): Promise<{ token: string; expiresAt?: string | null; error?: string }> {
  if (!isOAuthPlatform(account.platform)) return { token };
  const margin = account.platform === "threads" ? 10 * 86_400 : 600;
  if (!tokenNeedsRefresh(account.token_expires_at, Date.now(), margin)) return { token };
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  const creds = account.platform === "tiktok"
    ? { clientId: env?.get("TIKTOK_CLIENT_KEY") ?? "", clientSecret: env?.get("TIKTOK_CLIENT_SECRET") ?? "" }
    : account.platform === "youtube"
    ? { clientId: env?.get("GOOGLE_OAUTH_CLIENT_ID") ?? "", clientSecret: env?.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "" }
    : { clientId: env?.get("THREADS_APP_ID") ?? "", clientSecret: env?.get("THREADS_APP_SECRET") ?? "" };
  let refreshToken: string | null = account.platform === "threads" ? token : null;
  if (account.platform !== "threads") {
    try { refreshToken = await decryptSecret(account.refresh_token_encrypted); } catch { refreshToken = null; }
    if (!refreshToken) return { token, error: "нет refresh_token — нужен reconnect" };
    if (!creds.clientId || !creds.clientSecret) return { token, error: `не заданы ключи приложения ${account.platform}` };
  }
  const rq = refreshRequest(account.platform, { ...creds, refreshToken: refreshToken! });
  try {
    const r = await fetch(rq.url, rq.init);
    const body = await r.json().catch(() => ({}));
    const err = tokenError(body);
    if (err) return { token, error: err };
    const parsed = parseTokenResponse(account.platform, body);
    if (!parsed) return { token, error: "площадка не вернула access_token" };
    await admin.from("publish_accounts").update({
      access_token_encrypted: await encryptSecret(parsed.accessToken),
      ...(parsed.refreshToken ? { refresh_token_encrypted: await encryptSecret(parsed.refreshToken) } : {}),
      token_expires_at: parsed.expiresAt,
      token_refreshed_at: new Date().toISOString(),
    }).eq("id", account.id);
    return { token: parsed.accessToken, expiresAt: parsed.expiresAt };
  } catch (e) {
    return { token, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Сколько раз пробуем задание, прежде чем признать отказ окончательным. */
export const MAX_ATTEMPTS = 5;
/** Сколько раз ждём, пока площадка обработает медиа (опрос раз в минуту). */
export const MAX_PROCESSING_POLLS = 30;

export interface RunResult {
  jobId: string;
  /** verifying — площадка приняла пост, подтверждение чтением придёт вторым проходом воркера. */
  status: "published" | "verifying" | "processing" | "retry" | "failed" | "manual_review";
  externalPostId?: string | null;
  externalPostUrl?: string | null;
  message?: string;
}

function inMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function traceCtx(job: PublishJob, accountId?: string | null): TraceContext {
  return { jobId: job.id, projectId: job.project_id, accountId: accountId ?? job.account_id, traceId: job.trace_id ?? null };
}

async function patchJob(admin: SupabaseClient, jobId: string, patch: Record<string, unknown>) {
  await admin.from("publish_jobs").update(patch).eq("id", jobId);
}

/**
 * Поштучные уведомления — только в режиме each. В digest (по умолчанию для
 * сети из десятков аккаунтов) сбои собирает publish-monitor mode:digest раз в час.
 */
async function notifyIfEach(admin: SupabaseClient, projectId: string, text: string): Promise<void> {
  if ((await notifyModeOf(admin, projectId)) !== "each") return;
  await notifyProject(admin, projectId, text);
}

/**
 * Видео закрывается, когда по нему не осталось незавершённых заданий:
 * done — если хоть одно опубликовано, failed — если не вышло нигде.
 */
async function settleVideo(admin: SupabaseClient, videoId: string): Promise<void> {
  const { data } = await admin
    .from("publish_jobs").select("status").eq("video_id", videoId);
  const rows = (data ?? []) as { status: string }[];
  if (!rows.length) return;
  const open = rows.some((r) => ["pending", "retry", "processing", "verifying"].includes(r.status));
  if (open) return;
  const anyPublished = rows.some((r) => r.status === "published");
  await admin.from("publish_videos")
    .update({ status: anyPublished ? "done" : "failed" })
    .eq("id", videoId);
}

export async function runPublishJob(
  admin: SupabaseClient,
  job: PublishJob,
  opts: { budgetMs?: number } = {},
): Promise<RunResult> {
  const { data: accountRow } = await admin
    .from("publish_accounts").select("*").eq("id", job.account_id).maybeSingle();
  const account = accountRow as PublishAccount | null;
  const ctx = traceCtx(job, account?.id);
  await traceStep(admin, ctx, { step: "JOB_CLAIMED", data: { attempt: job.attempts, platform: job.platform } });
  if (!account) {
    await patchJob(admin, job.id, {
      status: "failed", error_code: "no_account", error_class: "UNKNOWN_ERROR", error_message: "аккаунт удалён", locked_at: null,
    });
    await traceStep(admin, ctx, { step: "FAILED", level: "error", message: "аккаунт удалён" });
    return { jobId: job.id, status: "failed", message: "аккаунт удалён" };
  }

  const { data: videoRow } = await admin
    .from("publish_videos").select("*").eq("id", job.video_id).maybeSingle();
  const video = videoRow as PublishVideo | null;
  if (!video) {
    await patchJob(admin, job.id, {
      status: "failed", error_code: "no_video", error_class: "MEDIA_INVALID", error_message: "видео удалено", locked_at: null,
    });
    await traceStep(admin, ctx, { step: "FAILED", level: "error", message: "видео удалено" });
    return { jobId: job.id, status: "failed", message: "видео удалено" };
  }

  // Возможность аккаунта: без publish_video площадка/токен публиковать не дадут —
  // не жжём попытки, отдаём человеку с понятной причиной.
  if (!hasCapability(account.capabilities as Record<string, unknown> | null | undefined, "publish_video")) {
    const message = `аккаунт «${account.account_name}» (${account.platform}) не имеет права публиковать видео этим токеном — нужен reconnect с нужными правами`;
    await patchJob(admin, job.id, {
      status: "manual_review", locked_at: null,
      error_code: "capability_missing", error_class: "CAPABILITY_MISSING", error_message: message.slice(0, 500),
    });
    await traceStep(admin, ctx, { step: "CAPABILITY_MISSING", level: "error", message });
    await notifyIfEach(admin, job.project_id, `🖐 Задание на ручной разбор: ${message}`);
    await settleVideo(admin, job.video_id);
    return { jobId: job.id, status: "manual_review", message };
  }
  await traceStep(admin, ctx, { step: "CAPABILITY_OK" });

  let token: string | null = null;
  try {
    token = await decryptSecret(account.access_token_encrypted);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logJob(admin, { jobId: job.id, accountId: account.id, level: "error", message });
    await patchJob(admin, job.id, {
      status: "retry", locked_at: null, next_attempt_at: inMinutes(30),
      error_code: "token_unreadable", error_class: "RECONNECT_REQUIRED", error_message: message.slice(0, 500),
    });
    await traceStep(admin, ctx, { step: "AUTH_FAILED", level: "error", message });
    return { jobId: job.id, status: "retry", message };
  }
  if (!token) {
    await markAccountFailure(admin, account, "token", "токен не сохранён");
    await patchJob(admin, job.id, {
      status: "retry", locked_at: null, next_attempt_at: inMinutes(60),
      error_code: "no_token", error_class: "RECONNECT_REQUIRED", error_message: "токен аккаунта не сохранён — нужен reconnect",
    });
    await traceStep(admin, ctx, { step: "AUTH_FAILED", level: "error", message: "токен не сохранён — нужен reconnect" });
    return { jobId: job.id, status: "retry", message: "нет токена" };
  }

  // Короткоживущий OAuth-токен обновляем до вызова площадки.
  const fresh = await ensureFreshToken(admin, account, token);
  if (fresh.error) {
    await logJob(admin, { jobId: job.id, accountId: account.id, level: "warning", message: `обновление токена: ${fresh.error}` });
    await traceStep(admin, ctx, { step: "AUTH_OK", level: "warning", message: `обновить токен не удалось: ${fresh.error}` });
  } else {
    await traceStep(admin, ctx, { step: fresh.expiresAt ? "AUTH_REFRESHED" : "AUTH_OK" });
  }
  token = fresh.token;
  await traceStep(admin, ctx, { step: "MEDIA_OK", data: { file_url: video.file_url } });

  // Видео в работе — статус для интерфейса; ставим один раз, при первом задании.
  if ((video as { status?: string }).status === "queued") {
    await admin.from("publish_videos").update({ status: "publishing" }).eq("id", video.id);
  }

  const caption = composeCaption(job.caption ?? video.base_caption, job.hashtags ?? []);

  const connector = connectorFor(account);
  await traceStep(admin, ctx, { step: job.container_id ? "PROVIDER_PROCESSING" : "UPLOAD_STARTED", data: { container_id: job.container_id ?? null } });
  let outcome: PublishOutcome;
  try {
    outcome = await connector.publish({
      account,
      token,
      videoUrl: video.file_url,
      thumbnailUrl: video.thumbnail_url,
      caption,
      title: video.title,
      containerId: job.container_id,
      budgetMs: opts.budgetMs,
    });
  } catch (e) {
    // Непойманное исключение публикатора считаем временным сбоем.
    outcome = {
      status: "failed", kind: "temporary", code: "publisher_exception",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (outcome.status === "published") {
    // Площадка приняла пост — это ещё не публикация. Верификация: читаем пост
    // обратно; нашли — published/verified, нет — verifying и второй проход воркера.
    await logJob(admin, {
      jobId: job.id, accountId: account.id,
      message: `площадка приняла пост: ${outcome.externalPostUrl ?? outcome.externalPostId}`,
      raw: outcome.raw,
    });
    await traceStep(admin, ctx, { step: "MEDIA_CREATED", data: { external_post_id: outcome.externalPostId, url: outcome.externalPostUrl } });
    const acceptedAt = new Date().toISOString();
    await patchJob(admin, job.id, {
      status: "verifying",
      external_post_id: outcome.externalPostId,
      external_post_url: outcome.externalPostUrl,
      published_at: acceptedAt,
      verification_status: "pending",
      locked_at: new Date().toISOString(),
      next_attempt_at: inMinutes(verifyDelayMinutes(0)),
      error_code: null,
      error_class: null,
      error_message: null,
    });
    const verified = await verifyPublishJob(admin, {
      ...job, status: "verifying", external_post_id: outcome.externalPostId,
      external_post_url: outcome.externalPostUrl, verify_attempts: 0, verification_status: "pending",
    }, { account, token, connector });
    return {
      jobId: job.id, status: verified.status === "published" ? "published" : "verifying",
      externalPostId: outcome.externalPostId, externalPostUrl: verified.externalPostUrl ?? outcome.externalPostUrl,
    };
  }

  if (outcome.status === "processing") {
    const polls = (job.poll_count ?? 0) + 1;
    if (polls > MAX_PROCESSING_POLLS) {
      // Площадка так и не обработала медиа — это отказ, а не вечный опрос.
      await patchJob(admin, job.id, {
        status: "failed", locked_at: null, poll_count: polls,
        error_code: "processing_timeout", error_class: "MEDIA_PROCESSING_FAILED",
        error_message: `площадка не обработала медиа за ${MAX_PROCESSING_POLLS} опросов (контейнер ${outcome.containerId})`,
      });
      await logJob(admin, { jobId: job.id, accountId: account.id, level: "error", message: `обработка медиа не завершилась за ${MAX_PROCESSING_POLLS} опросов` });
      await traceStep(admin, ctx, { step: "FAILED", level: "error", message: "processing_timeout", data: { polls, container_id: outcome.containerId } });
      await notifyIfEach(admin, job.project_id, `❌ Публикация не удалась: «${account.account_name}» (${account.platform}) — площадка не обработала видео.`);
      await settleVideo(admin, job.video_id);
      return { jobId: job.id, status: "failed", message: "processing_timeout" };
    }
    // Контейнер сохраняем ДО следующей попытки: повтор добьёт его, а не зальёт заново.
    // Опрос — не попытка: attempts возвращаем (claim снова прибавит), считаем poll_count.
    await patchJob(admin, job.id, {
      status: "retry", locked_at: null, container_id: outcome.containerId,
      attempts: Math.max(job.attempts - 1, 0), poll_count: polls,
      next_attempt_at: inMinutes(1),
      error_code: null, error_message: null,
    });
    await logJob(admin, {
      jobId: job.id, accountId: account.id,
      message: `медиа обрабатывается площадкой, контейнер ${outcome.containerId} (опрос ${polls})`,
    });
    await traceStep(admin, ctx, { step: "PROVIDER_PROCESSING", data: { polls, container_id: outcome.containerId } });
    return { jobId: job.id, status: "processing" };
  }

  // Дальше — только отказы: аккаунт получает отметку, задание — решение политики.
  await markAccountFailure(admin, account, outcome.kind, outcome.message);
  await logJob(admin, {
    jobId: job.id, accountId: account.id, level: "error",
    message: `${outcome.kind}/${outcome.code}: ${outcome.message}`,
    raw: outcome.raw,
  });

  const errorClass = classifyError(outcome.kind, outcome.code, outcome.message);
  const base = {
    locked_at: null,
    error_code: outcome.code,
    error_class: errorClass,
    error_message: outcome.message.slice(0, 500),
  };
  const decision = decideRetry({ kind: outcome.kind, attempts: job.attempts, maxAttempts: MAX_ATTEMPTS });
  const traceData = { kind: outcome.kind, code: outcome.code, error_class: errorClass, attempt: job.attempts, reason: decision.reason };

  if (decision.action === "manual_review") {
    await patchJob(admin, job.id, { ...base, status: "manual_review" });
    await traceStep(admin, ctx, { step: "MANUAL_REVIEW", level: "error", message: outcome.message, data: traceData });
    await notifyIfEach(admin, job.project_id, `🖐 Задание на ручной разбор: «${account.account_name}» (${account.platform}) — ${outcome.message.slice(0, 200)}`);
    await notifyCenter(admin, {
      projectId: job.project_id, kind: "publication.needs_human", severity: "warning",
      title: `Ручной разбор: ${account.account_name} (${account.platform})`, body: outcome.message.slice(0, 500),
      entityType: "publish_job", entityId: job.id, dedupeKey: `job:${job.id}:manual_review`,
    });
    await settleVideo(admin, job.video_id);
    return { jobId: job.id, status: "manual_review", message: outcome.message };
  }

  if (decision.action === "retry") {
    await patchJob(admin, job.id, { ...base, status: "retry", next_attempt_at: inMinutes(decision.delayMinutes) });
    await traceStep(admin, ctx, { step: "RETRY", level: "warning", message: outcome.message, data: { ...traceData, delay_minutes: decision.delayMinutes } });
    if (outcome.kind === "token" || outcome.kind === "limit") {
      // Мёртвый токен и лимит — беда аккаунта, а не задания: аккаунт уже погашен,
      // задание ждёт в очереди и уедет само, как только аккаунт починят.
      await notifyIfEach(
        admin, job.project_id,
        outcome.kind === "token"
          ? `🔑 Публикация остановлена: у аккаунта «${account.account_name}» (${account.platform}) недействителен токен. Нужен reconnect в настройках.`
          : `⏳ Публикация остановлена: аккаунт «${account.account_name}» (${account.platform}) упёрся в лимит площадки. ${outcome.message}`,
      );
      if (outcome.kind === "token") {
        await notifyCenter(admin, {
          projectId: job.project_id, kind: "account.reconnect_required", severity: "error",
          title: `Нужен reconnect: ${account.account_name} (${account.platform})`, body: outcome.message.slice(0, 500),
          entityType: "publish_account", entityId: account.id, dedupeKey: `account:${account.id}:reconnect`,
        });
      }
    }
    return { jobId: job.id, status: "retry", message: outcome.message };
  }

  await patchJob(admin, job.id, { ...base, status: "failed" });
  await traceStep(admin, ctx, { step: "FAILED", level: "error", message: outcome.message, data: traceData });
  await notifyIfEach(
    admin, job.project_id,
    `❌ Публикация не удалась: «${account.account_name}» (${account.platform}) — ${outcome.message.slice(0, 200)}`,
  );
  await notifyCenter(admin, {
    projectId: job.project_id, kind: "publication.failed", severity: "error",
    title: `Публикация не удалась: ${account.account_name} (${account.platform})`, body: `${errorClass}: ${outcome.message.slice(0, 400)}`,
    entityType: "publish_job", entityId: job.id, dedupeKey: `job:${job.id}:failed`,
  });
  await settleVideo(admin, job.video_id);
  return { jobId: job.id, status: "failed", message: outcome.message };
}

/* ─────────────────────────── верификация публикации ─────────────────────────── */

export interface VerifyResult {
  jobId: string;
  status: "published" | "verifying";
  verification: "verified" | "unverified" | "skipped" | "pending";
  externalPostUrl?: string | null;
  message?: string;
}

/**
 * Verification Engine: читаем пост у площадки по external_post_id.
 *  - найден → published + verified (только теперь срабатывает учёт аккаунта);
 *  - не найден / не удалось → следующая попытка по лестнице пауз;
 *  - MAX_VERIFY_ATTEMPTS исчерпаны → published + unverified и уведомление:
 *    пост, скорее всего, есть (площадка вернула id), повтор публикации дал бы дубль;
 *  - площадка не даёт прочитать пост этим токеном → published + skipped.
 * Вызывается сразу после ответа площадки (из runPublishJob) и вторым проходом
 * воркера для заданий в статусе verifying (claim_publish_verifications).
 */
export async function verifyPublishJob(
  admin: SupabaseClient,
  job: PublishJob,
  pre: { account?: PublishAccount | null; token?: string | null; connector?: ReturnType<typeof connectorFor> } = {},
): Promise<VerifyResult> {
  const ctx = traceCtx(job);
  let account = pre.account ?? null;
  if (!account) {
    const { data } = await admin.from("publish_accounts").select("*").eq("id", job.account_id).maybeSingle();
    account = (data as PublishAccount | null) ?? null;
  }
  const finish = async (verification: VerifyResult["verification"], patch: Record<string, unknown>, message: string) => {
    await patchJob(admin, job.id, { status: "published", verification_status: verification, locked_at: null, ...patch });
    await traceStep(admin, ctx, { step: verification === "verified" ? "VERIFIED" : verification === "skipped" ? "VERIFY_SKIPPED" : "UNVERIFIED", level: verification === "unverified" ? "warning" : "info", message });
    await traceStep(admin, ctx, { step: "SUCCESS", data: { verification } });
    if (account) await markAccountSuccess(admin, account.id);
    await settleVideo(admin, job.video_id);
  };

  if (!account || !job.external_post_id) {
    await finish("skipped", {}, "нет аккаунта или id поста — проверить нечем");
    return { jobId: job.id, status: "published", verification: "skipped" };
  }
  await traceStep(admin, ctx, { step: "VERIFY_STARTED", data: { attempt: (job.verify_attempts ?? 0) + 1, external_post_id: job.external_post_id } });

  let token = pre.token ?? null;
  if (!token) {
    try { token = await decryptSecret(account.access_token_encrypted); } catch { token = null; }
    if (token) token = (await ensureFreshToken(admin, account, token)).token;
  }
  if (!token) {
    await finish("skipped", {}, "токен аккаунта недоступен — проверка пропущена");
    return { jobId: job.id, status: "published", verification: "skipped" };
  }

  const connector = pre.connector ?? connectorFor(account);
  const lookup = await connector.getPublication({ account, token, externalPostId: job.external_post_id });
  const attempts = (job.verify_attempts ?? 0) + 1;

  if (lookup.exists === true) {
    await finish("verified", {
      verified_at: new Date().toISOString(), verify_attempts: attempts,
      ...(lookup.url && lookup.url !== job.external_post_url ? { external_post_url: lookup.url } : {}),
    }, `пост найден у площадки${lookup.platformStatus ? ` (${lookup.platformStatus})` : ""}`);
    return { jobId: job.id, status: "published", verification: "verified", externalPostUrl: lookup.url ?? job.external_post_url };
  }

  if (lookup.exists === null && !lookup.retryable) {
    await finish("skipped", { verify_attempts: attempts }, `проверка недоступна: ${lookup.reason}`);
    return { jobId: job.id, status: "published", verification: "skipped", message: lookup.reason };
  }

  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    await finish("unverified", { verify_attempts: attempts }, `пост не подтверждён за ${attempts} проверок: ${lookup.reason}`);
    await notifyCenter(admin, {
      projectId: job.project_id, kind: "publication.unverified", severity: "warning",
      title: `Публикация не подтверждена: ${account.account_name} (${account.platform})`,
      body: `Площадка приняла пост (${job.external_post_id}), но прочитать его обратно не удалось: ${lookup.reason}. Проверьте вручную${job.external_post_url ? `: ${job.external_post_url}` : ""}.`,
      entityType: "publish_job", entityId: job.id, dedupeKey: `job:${job.id}:unverified`,
    });
    return { jobId: job.id, status: "published", verification: "unverified", message: lookup.reason };
  }

  await patchJob(admin, job.id, {
    status: "verifying", verify_attempts: attempts, locked_at: null,
    next_attempt_at: inMinutes(verifyDelayMinutes(attempts)),
  });
  await traceStep(admin, ctx, { step: "VERIFY_PENDING", level: "warning", message: lookup.reason, data: { attempt: attempts, next_in_minutes: verifyDelayMinutes(attempts) } });
  return { jobId: job.id, status: "verifying", verification: "pending", message: lookup.reason };
}
