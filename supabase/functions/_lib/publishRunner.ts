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
  logJob,
  markAccountFailure,
  markAccountSuccess,
  notifyProject,
  type PublishAccount,
  type PublishJob,
  type PublishVideo,
} from "./publishing.ts";
import { publisherFor } from "./publishers/index.ts";
import type { PublishOutcome } from "./publishers/types.ts";

/** Сколько раз пробуем задание, прежде чем признать отказ окончательным. */
export const MAX_ATTEMPTS = 5;

export interface RunResult {
  jobId: string;
  status: "published" | "processing" | "retry" | "failed" | "manual_review";
  externalPostId?: string | null;
  externalPostUrl?: string | null;
  message?: string;
}

/** Экспоненциальная пауза перед повтором, потолок — полчаса. */
function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts - 1, 0), 30);
}

function inMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function patchJob(admin: SupabaseClient, jobId: string, patch: Record<string, unknown>) {
  await admin.from("publish_jobs").update(patch).eq("id", jobId);
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
  const open = rows.some((r) => ["pending", "retry", "processing"].includes(r.status));
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
  if (!account) {
    await patchJob(admin, job.id, {
      status: "failed", error_code: "no_account", error_message: "аккаунт удалён", locked_at: null,
    });
    return { jobId: job.id, status: "failed", message: "аккаунт удалён" };
  }

  const { data: videoRow } = await admin
    .from("publish_videos").select("*").eq("id", job.video_id).maybeSingle();
  const video = videoRow as PublishVideo | null;
  if (!video) {
    await patchJob(admin, job.id, {
      status: "failed", error_code: "no_video", error_message: "видео удалено", locked_at: null,
    });
    return { jobId: job.id, status: "failed", message: "видео удалено" };
  }

  let token: string | null = null;
  try {
    token = await decryptSecret(account.access_token_encrypted);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logJob(admin, { jobId: job.id, accountId: account.id, level: "error", message });
    await patchJob(admin, job.id, {
      status: "retry", locked_at: null, next_attempt_at: inMinutes(30),
      error_code: "token_unreadable", error_message: message.slice(0, 500),
    });
    return { jobId: job.id, status: "retry", message };
  }
  if (!token) {
    await markAccountFailure(admin, account, "token", "токен не сохранён");
    await patchJob(admin, job.id, {
      status: "retry", locked_at: null, next_attempt_at: inMinutes(60),
      error_code: "no_token", error_message: "токен аккаунта не сохранён — нужен reconnect",
    });
    return { jobId: job.id, status: "retry", message: "нет токена" };
  }

  const caption = composeCaption(job.caption ?? video.base_caption, job.hashtags ?? []);

  let outcome: PublishOutcome;
  try {
    outcome = await publisherFor(job.platform)({
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
    await patchJob(admin, job.id, {
      status: "published",
      external_post_id: outcome.externalPostId,
      external_post_url: outcome.externalPostUrl,
      published_at: new Date().toISOString(),
      locked_at: null,
      error_code: null,
      error_message: null,
    });
    await markAccountSuccess(admin, account.id);
    await logJob(admin, {
      jobId: job.id, accountId: account.id,
      message: `опубликовано: ${outcome.externalPostUrl ?? outcome.externalPostId}`,
      raw: outcome.raw,
    });
    await settleVideo(admin, job.video_id);
    return {
      jobId: job.id, status: "published",
      externalPostId: outcome.externalPostId, externalPostUrl: outcome.externalPostUrl,
    };
  }

  if (outcome.status === "processing") {
    // Контейнер сохраняем ДО следующей попытки: повтор добьёт его, а не зальёт заново.
    await patchJob(admin, job.id, {
      status: "retry", locked_at: null, container_id: outcome.containerId,
      next_attempt_at: inMinutes(1),
      error_code: null, error_message: null,
    });
    await logJob(admin, {
      jobId: job.id, accountId: account.id,
      message: `медиа обрабатывается площадкой, контейнер ${outcome.containerId}`,
    });
    return { jobId: job.id, status: "processing" };
  }

  // Дальше — только отказы.
  await markAccountFailure(admin, account, outcome.kind, outcome.message);
  await logJob(admin, {
    jobId: job.id, accountId: account.id, level: "error",
    message: `${outcome.kind}/${outcome.code}: ${outcome.message}`,
    raw: outcome.raw,
  });

  const base = {
    locked_at: null,
    error_code: outcome.code,
    error_message: outcome.message.slice(0, 500),
  };

  if (outcome.kind === "unsupported") {
    await patchJob(admin, job.id, { ...base, status: "manual_review" });
    await settleVideo(admin, job.video_id);
    return { jobId: job.id, status: "manual_review", message: outcome.message };
  }

  // Мёртвый токен и лимит — беда аккаунта, а не задания: аккаунт уже погашен,
  // задание ждёт в очереди и уедет само, как только аккаунт починят.
  if (outcome.kind === "token" || outcome.kind === "limit") {
    await patchJob(admin, job.id, { ...base, status: "retry", next_attempt_at: inMinutes(60) });
    await notifyProject(
      admin, job.project_id,
      outcome.kind === "token"
        ? `🔑 Публикация остановлена: у аккаунта «${account.account_name}» (${account.platform}) недействителен токен. Нужен reconnect в настройках.`
        : `⏳ Публикация остановлена: аккаунт «${account.account_name}» (${account.platform}) упёрся в лимит площадки. ${outcome.message}`,
    );
    return { jobId: job.id, status: "retry", message: outcome.message };
  }

  if (outcome.kind === "temporary" && job.attempts < MAX_ATTEMPTS) {
    await patchJob(admin, job.id, {
      ...base, status: "retry", next_attempt_at: inMinutes(backoffMinutes(job.attempts)),
    });
    return { jobId: job.id, status: "retry", message: outcome.message };
  }

  await patchJob(admin, job.id, { ...base, status: "failed" });
  await notifyProject(
    admin, job.project_id,
    `❌ Публикация не удалась: «${account.account_name}» (${account.platform}) — ${outcome.message.slice(0, 200)}`,
  );
  await settleVideo(admin, job.video_id);
  return { jobId: job.id, status: "failed", message: outcome.message };
}
