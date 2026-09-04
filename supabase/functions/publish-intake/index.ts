/**
 * Приём готового видео и постановка заданий публикации.
 *
 * Две операции ТЗ в одной функции — у них общая половина (проверки, раскладка
 * по аккаунтам), и n8n-воркфлоу «Video Intake» обычно делает обе за раз:
 *   { action: "video_ready", ... }  — принять видео (+ сразу поставить задания)
 *   { action: "create_jobs", ... }  — поставить задания на уже принятое видео
 *
 * Раскладка по времени — планировщик слотов plan_publish_slots (миграция
 * publishing_scale): окно публикаций в поясе аккаунта, минимальный интервал,
 * дневной лимит с разгоном, темп группы per_hour, джиттер. Стратегия и темп
 * берутся из группы, если в target их не передали (раньше поля группы были
 * записаны, но не читались). target.mode = "now" — все сразу, как и было.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import {
  automationKeyValid,
  composeCaption,
  CORS_HEADERS,
  isPlatform,
  json,
  type Platform,
} from "../_lib/publishing.ts";
import {
  MAX_SIZE_BYTES,
  pickCaption,
  scheduleFor,
  type Target,
  validateVideoRef,
} from "../_lib/publishSchedule.ts";

interface AccountRow {
  id: string;
  platform: Platform;
  account_name: string;
}

/** Формат — правилами модуля расписания, вес и тип — по HEAD, если отдают. */
async function inspectVideo(
  fileUrl: string,
  durationSec: number | null,
): Promise<{ ok: boolean; error?: string; sizeBytes?: number }> {
  const basic = validateVideoRef(fileUrl, durationSec);
  if (!basic.ok) return { ok: false, error: basic.error };
  try {
    const res = await fetch(fileUrl, { method: "HEAD" });
    if (!res.ok) return { ok: true }; // HEAD режут многие хранилища — не повод отказывать
    const type = res.headers.get("content-type") ?? "";
    if (type && !/^video\//i.test(type) && !/octet-stream/i.test(type)) {
      return { ok: false, error: `по ссылке лежит не видео (content-type: ${type})` };
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_SIZE_BYTES) return { ok: false, error: `файл больше 1 ГБ (${Math.round(len / 1e6)} МБ)` };
    return { ok: true, sizeBytes: len || undefined };
  } catch {
    return { ok: true };
  }
}

/** Аккаунты цели: группа, явный список или все активные аккаунты проекта. */
async function resolveAccounts(
  admin: SupabaseClient,
  projectId: string,
  target: Target,
): Promise<AccountRow[]> {
  let ids: string[] | null = null;

  let groupId: string | null = null;
  if (target.group_id) {
    const { data } = await admin
      .from("publish_account_groups").select("account_ids, platform")
      .eq("id", target.group_id).eq("project_id", projectId).maybeSingle();
    ids = ((data as { account_ids?: string[] } | null)?.account_ids ?? []);
    groupId = target.group_id;
  } else if (Array.isArray(target.account_ids) && target.account_ids.length) {
    ids = target.account_ids.map(String);
  }

  let q = admin.from("publish_accounts")
    .select("id, platform, account_name")
    .eq("project_id", projectId)
    .eq("status", "active")
    .eq("publish_enabled", true)
    .gte("health_score", 20);

  // Членство в группе — и по списку account_ids группы, и по publish_accounts.group_id.
  if (groupId) {
    const list = ids && ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
    q = q.or(`group_id.eq.${groupId},id.in.(${list.join(",")})`);
  } else if (ids) {
    q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const platforms = (target.platforms ?? []).filter(isPlatform);
  if (platforms.length) q = q.in("platform", platforms);

  const { data } = await q.order("created_at");
  return (data ?? []) as AccountRow[];
}

interface VideoRow {
  id: string;
  project_id: string;
  base_caption: string | null;
  caption_variants: unknown;
  hashtags: string[] | null;
}

/** Стратегия группы — значение по умолчанию для target.mode / per_hour. */
async function applyGroupStrategy(admin: SupabaseClient, projectId: string, target: Target): Promise<Target> {
  if (!target.group_id) return target;
  const { data } = await admin.from("publish_account_groups")
    .select("publish_strategy, per_hour, review_mode")
    .eq("id", target.group_id).eq("project_id", projectId).maybeSingle();
  const g = data as { publish_strategy?: string; per_hour?: number; review_mode?: string } | null;
  if (!g) return target;
  if (g.review_mode === "paused") throw new Error("группа на паузе (review_mode = paused)");
  const mode = target.mode ?? (g.publish_strategy === "all_at_once" ? "now" : g.publish_strategy === "daily" ? "daily" : "drip");
  return { ...target, mode, per_hour: target.per_hour ?? g.per_hour };
}

async function createJobs(
  admin: SupabaseClient,
  video: VideoRow,
  rawTarget: Target,
): Promise<{ created: number; skipped: number; accounts: { id: string; account_name: string; scheduled_at: string }[] }> {
  const target = await applyGroupStrategy(admin, video.project_id, rawTarget);
  const accounts = await resolveAccounts(admin, video.project_id, target);
  if (!accounts.length) return { created: 0, skipped: 0, accounts: [] };

  // Планировщик слотов: окна, интервалы, лимиты и разгон — в SQL, один вызов на видео.
  if (target.plan !== "legacy") {
    const { data, error } = await admin.rpc("plan_publish_slots", {
      p_video_id: video.id,
      p_group_id: target.group_id ?? null,
      p_account_ids: accounts.map((a) => a.id),
      p_start: target.start_at ?? new Date().toISOString(),
      p_mode: target.mode ?? "drip",
    });
    if (error) throw new Error(error.message);
    const planned = (data ?? []) as { job_id: string; account_id: string; scheduled_at: string; created: boolean }[];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return {
      created: planned.filter((p) => p.created).length,
      skipped: planned.filter((p) => !p.created).length + (accounts.length - planned.length),
      accounts: planned.map((p) => ({
        id: p.account_id,
        account_name: byId.get(p.account_id)?.account_name ?? "",
        scheduled_at: p.scheduled_at,
      })),
    };
  }

  const rows = accounts.map((acc, i) => ({
    project_id: video.project_id,
    video_id: video.id,
    account_id: acc.id,
    platform: acc.platform,
    // Разные подписи у разных аккаунтов — вариант по кругу, иначе базовый текст.
    caption: pickCaption(video.caption_variants, video.base_caption, i),
    hashtags: video.hashtags ?? [],
    scheduled_at: scheduleFor(target, i),
  }));

  if (!rows.length) return { created: 0, skipped: 0, accounts: [] };

  // ignoreDuplicates — повторный вызов не породит второй пост в тот же аккаунт
  // (уникальность (video_id, account_id) в схеме).
  const { data, error } = await admin.from("publish_jobs")
    .upsert(rows, { onConflict: "video_id,account_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);

  const created = (data ?? []).length;
  await admin.from("publish_videos").update({ status: "queued" }).eq("id", video.id);

  return {
    created,
    skipped: rows.length - created,
    accounts: accounts.map((acc, i) => ({
      id: acc.id, account_name: acc.account_name, scheduled_at: rows[i].scheduled_at,
    })),
  };
}

/** Пинок воркеру, чтобы первое задание не ждало минуту до крона. */
async function kickWorker(admin: SupabaseClient): Promise<void> {
  const { data } = await admin
    .from("automation_settings").select("cron_secret").eq("id", true).maybeSingle();
  const key = (data as { cron_secret?: string } | null)?.cron_secret;
  if (!key) return;
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/publish-worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-automation-key": key },
    body: JSON.stringify({ batch_size: 5 }),
  }).catch(() => {});
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
  const action = String(body?.action ?? "video_ready");

  try {
    if (action === "create_jobs") {
      const videoId = String(body?.video_id ?? "");
      if (!videoId) return json({ error: "video_id обязателен" }, 400);
      const { data } = await admin.from("publish_videos")
        .select("id, project_id, base_caption, caption_variants, hashtags")
        .eq("id", videoId).maybeSingle();
      const video = data as VideoRow | null;
      if (!video) return json({ error: "видео не найдено" }, 404);

      const result = await createJobs(admin, video, (body?.target ?? {}) as Target);
      if (result.created) await kickWorker(admin);
      return json({ ok: true, video_id: video.id, ...result });
    }

    if (action !== "video_ready") return json({ error: `неизвестное действие: ${action}` }, 400);

    /* ── приём видео ── */
    const projectId = String(body?.project_id ?? "");
    const fileUrl = String(body?.file_url ?? "");
    if (!projectId) return json({ error: "project_id обязателен" }, 400);
    if (!fileUrl) return json({ error: "file_url обязателен" }, 400);

    const { data: project } = await admin
      .from("projects").select("id").eq("id", projectId).maybeSingle();
    if (!project) return json({ error: "проект не найден" }, 404);

    const duration = body?.duration_sec == null ? null : Number(body.duration_sec);
    const check = await inspectVideo(fileUrl, duration);
    if (!check.ok) return json({ error: check.error }, 422);

    const hashtags = Array.isArray(body?.hashtags) ? body.hashtags.map(String) : [];
    const variants = Array.isArray(body?.caption_variants) ? body.caption_variants.map(String) : [];

    const { data: inserted, error } = await admin.from("publish_videos").insert({
      project_id: projectId,
      file_url: fileUrl,
      local_path: body?.local_path ? String(body.local_path) : null,
      thumbnail_url: body?.thumbnail_url ? String(body.thumbnail_url) : null,
      title: body?.title ? String(body.title) : null,
      base_caption: body?.base_caption ? String(body.base_caption) : null,
      caption_variants: variants,
      hashtags,
      language: body?.language ? String(body.language) : "ru",
      duration_sec: duration != null && Number.isFinite(duration) ? duration : null,
      width: body?.width ? Number(body.width) : null,
      height: body?.height ? Number(body.height) : null,
      size_bytes: body?.size_bytes ? Number(body.size_bytes) : (check.sizeBytes ?? null),
      source: body?.source ? String(body.source) : "n8n",
      source_ref: body?.source_ref ? String(body.source_ref) : null,
    }).select("id, project_id, base_caption, caption_variants, hashtags").maybeSingle();

    if (error) return json({ error: error.message }, 500);
    const video = inserted as VideoRow;

    // preview — как будет выглядеть подпись после склейки с хэштегами.
    const preview = composeCaption(video.base_caption, hashtags).slice(0, 300);

    if (!body?.target) return json({ ok: true, video_id: video.id, caption_preview: preview, created: 0 });

    const result = await createJobs(admin, video, body.target as Target);
    if (result.created) await kickWorker(admin);
    return json({ ok: true, video_id: video.id, caption_preview: preview, ...result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
