/**
 * Контент-конвейер: backend MarkVision для производства и согласования Reels.
 *
 * Три поверхности в одной функции (маршрут — хвост пути после /content-pipeline):
 *
 *   Пользовательский API (JWT + доступ к проекту через RLS):
 *     POST /items                      создать тему (status = idea)
 *     GET  /items/:id                  статус, этап, сценарий, файлы, история
 *     POST /items/:id/generate         поставить в очередь / пнуть n8n (идемпотентно)
 *     POST /items/:id/review           { decision: approved|rejected, comment? }
 *     POST /items/:id/retry            новая попытка для failed / rejected / cancelled
 *     POST /items/:id/cancel           отменить активный запуск
 *     POST /items/:id/variants         { group_ids } — варианты темы под группы аккаунтов (персона группы)
 *     POST /items/:id/settings         { target_group_id?, persona_id?, engine? } — цель и движок до генерации
 *   Одобренный ролик сам уходит в publish_videos и раскладывается по целевой группе
 *   (plan_publish_slots); доверенные группы (auto_publish) минуют ворота.
 *
 *   Закрытый callback для n8n (HMAC SHA-256 + timestamp + nonce, см. _lib/contentPipeline.ts):
 *     POST /internal/callback          { event: claim|heartbeat|state|script|video_requested|
 *                                        video_status|asset|fail }
 *     Секрет — CONTENT_PIPELINE_CALLBACK_SECRET. Service-role ключ в n8n не нужен.
 *
 *   Telegram-бот согласования (заголовок x-telegram-bot-api-secret-token):
 *     POST /telegram                   callback_query кнопок и ответ с причиной отклонения
 *
 *   Обслуживание (x-automation-key = automation_settings.cron_secret, pg_cron раз в 10 мин):
 *     POST /maintenance                зависшие запуски → очередь, алерты оператору, GC
 *
 * Все состояния и правила — в _lib/contentPipeline.ts; таблицы — миграция
 * 20260904120000_content_pipeline.sql; документация — docs/CONTENT-PIPELINE.md.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { automationKeyValid } from "../_lib/publishing.ts";
import {
  backoffSeconds,
  buildScriptPrompt,
  canTransition,
  type ErrorKind,
  estimateHeygenCostUsd,
  estimateOpenAiCostUsd,
  formatReviewCaption,
  isRunState,
  itemStatusForRunState,
  parseCallbackData,
  parseScriptJson,
  randomToken,
  reviewKeyboard,
  RUN_STATE_LABELS,
  type RunState,
  safeTechMessage,
  SCRIPT_JSON_SCHEMA,
  TERMINAL_RUN_STATES,
  userFacingError,
  validateScript,
  verifyCallbackSignature,
} from "../_lib/contentPipeline.ts";

/* ───────────────────────────── инфраструктура ───────────────────────────── */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key, x-pipeline-timestamp, x-pipeline-nonce, x-pipeline-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Json = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function env(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? fallback;
}

function admin(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
}

function botToken(): string {
  return env("CONTENT_PIPELINE_BOT_TOKEN") || env("TELEGRAM_BOT_TOKEN");
}

const REVIEW_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TELEGRAM_UPLOAD_LIMIT_BYTES = 49 * 1024 * 1024;

async function tg(method: string, body: Json): Promise<Json | null> {
  const token = botToken();
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as Json;
    if (!r.ok || j.ok === false) {
      console.error(`telegram ${method} failed`, r.status, JSON.stringify(j).slice(0, 300));
      return null;
    }
    return j;
  } catch (e) {
    console.error(`telegram ${method} threw`, safeTechMessage(e));
    return null;
  }
}

/** sendVideo multipart (CDN-ссылки Telegram скачивает ненадёжно), фолбэк — ссылка. */
async function tgSendVideo(chatId: string, url: string, caption: string, replyMarkup: Json): Promise<Json | null> {
  const token = botToken();
  if (!token) return null;
  try {
    const fileRes = await fetch(url);
    if (fileRes.ok) {
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      if (bytes.byteLength > 0 && bytes.byteLength <= TELEGRAM_UPLOAD_LIMIT_BYTES) {
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("caption", caption);
        form.append("reply_markup", JSON.stringify(replyMarkup));
        form.append("video", new Blob([bytes], { type: "video/mp4" }), "reels.mp4");
        const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: form });
        const j = (await r.json().catch(() => ({}))) as Json;
        if (r.ok && j.ok !== false) return j;
        console.error("telegram sendVideo(file) failed", r.status, JSON.stringify(j).slice(0, 300));
      }
    }
  } catch (e) {
    console.error("sendVideo threw", safeTechMessage(e));
  }
  return await tg("sendMessage", {
    chat_id: chatId,
    text: `${caption}\n${url}`,
    reply_markup: replyMarkup,
  });
}

async function projectChatId(db: SupabaseClient, projectId: string): Promise<string | null> {
  const { data: s } = await db
    .from("content_pipeline_settings").select("telegram_chat_id").eq("project_id", projectId).maybeSingle();
  const override = (s as { telegram_chat_id?: string | null } | null)?.telegram_chat_id;
  if (override) return override;
  const { data: link } = await db
    .from("telegram_links").select("chat_id").eq("project_id", projectId).limit(1).maybeSingle();
  return (link as { chat_id?: string } | null)?.chat_id ?? null;
}

async function notifyOperator(db: SupabaseClient, projectId: string, text: string): Promise<void> {
  const chat = env("CONTENT_PIPELINE_ALERT_CHAT_ID") || (await projectChatId(db, projectId));
  if (!chat) return;
  await tg("sendMessage", { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true });
}

/** Пинок n8n: очередь и так разбирается по расписанию, поэтому ошибка не фатальна. */
async function kickN8n(payload: Json): Promise<boolean> {
  const url = env("N8N_CONTENT_PIPELINE_WEBHOOK_URL");
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env("N8N_CONTENT_PIPELINE_WEBHOOK_KEY") ? { "x-pipeline-key": env("N8N_CONTENT_PIPELINE_WEBHOOK_KEY") } : {}),
      },
      body: JSON.stringify({ source: "markvision", ...payload }),
      signal: AbortSignal.timeout(8_000),
    });
    return r.ok;
  } catch (e) {
    console.error("n8n kick failed", safeTechMessage(e));
    return false;
  }
}

/* ───────────────────────────── типы строк ───────────────────────────── */

interface RunRow {
  id: string;
  content_item_id: string;
  project_id: string;
  state: RunState;
  provider: string | null;
  provider_job_id: string | null;
  provider_request_id: string | null;
  attempt: number;
  locked_by: string | null;
  heartbeat_at: string | null;
  next_retry_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  state_changed_at: string;
  error_code: string | null;
  error_message: string | null;
  error_user: string | null;
  error_node: string | null;
  error_at: string | null;
  cost_usd: number;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  prompts: string | null;
  category: string;
  content_type: string;
  hashtags: string | null;
  status: string;
  media_url: string | null;
  pipeline_run_id: string | null;
  parent_item_id: string | null;
  target_group_id: string | null;
  persona_id: string | null;
  engine: string | null;
  idea_id: string | null;
  publish_video_id: string | null;
  created_at: string;
  updated_at: string;
}

interface PersonaRow {
  id: string;
  name: string;
  niche: string | null;
  tone_of_voice: string | null;
  forbidden_phrases: string[] | null;
  language: string | null;
  engine_default: string;
  heygen_avatar_id: string | null;
  heygen_voice_id: string | null;
  eleven_voice_id: string | null;
  reels_theme: string | null;
}

interface GroupRow {
  id: string;
  name: string;
  persona_id: string | null;
  review_mode: "review_required" | "auto_publish" | "paused";
  auto_publish_after: number;
  approved_streak: number;
}

async function loadPersona(db: SupabaseClient, personaId: string | null): Promise<PersonaRow | null> {
  if (!personaId) return null;
  const { data } = await db.from("personas")
    .select("id, name, niche, tone_of_voice, forbidden_phrases, language, engine_default, heygen_avatar_id, heygen_voice_id, eleven_voice_id, reels_theme")
    .eq("id", personaId).maybeSingle();
  return (data as PersonaRow | null) ?? null;
}

async function loadGroup(db: SupabaseClient, groupId: string | null): Promise<GroupRow | null> {
  if (!groupId) return null;
  const { data } = await db.from("publish_account_groups")
    .select("id, name, persona_id, review_mode, auto_publish_after, approved_streak")
    .eq("id", groupId).maybeSingle();
  return (data as GroupRow | null) ?? null;
}

/**
 * Одобренный ролик → библиотека публикации → слоты по целевой группе
 * (docs/AUTOPOSTING-PLATFORM-PLAN.md, M2: шов publish_videos.source/source_ref).
 * Идемпотентно: у темы уже есть publish_video_id — второй раз не создаём.
 */
async function handoffToPublishing(db: SupabaseClient, run: RunRow, item: ItemRow): Promise<{ video_id: string | null; planned: number }> {
  if (item.publish_video_id) return { video_id: item.publish_video_id, planned: 0 };
  const { data: asset } = await db.from("content_assets")
    .select("id, public_url, duration_seconds, width, height, size_bytes")
    .eq("pipeline_run_id", run.id).eq("asset_type", "normalized_video")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  const a = asset as { id: string; public_url: string | null; duration_seconds: number | null; width: number | null; height: number | null; size_bytes: number | null } | null;
  if (!a?.public_url) return { video_id: null, planned: 0 };
  const script = ((run.metadata?.script as Json | undefined) ?? {}) as { title?: string; description?: string; hashtags?: string[] };
  const { data: video, error } = await db.from("publish_videos").insert({
    project_id: item.project_id,
    file_url: a.public_url,
    title: script.title ?? item.title,
    base_caption: script.description ?? item.description,
    hashtags: Array.isArray(script.hashtags) ? script.hashtags.map((h) => String(h).replace(/^#/, "")) : [],
    duration_sec: a.duration_seconds,
    width: a.width,
    height: a.height,
    size_bytes: a.size_bytes,
    source: "content_pipeline",
    source_ref: a.id,
  }).select("id").maybeSingle();
  if (error || !video) {
    console.error("handoff: publish_videos insert failed", error?.message);
    return { video_id: null, planned: 0 };
  }
  const videoId = (video as { id: string }).id;
  await db.from("content_plan_items").update({ publish_video_id: videoId }).eq("id", item.id);
  let planned = 0;
  if (item.target_group_id) {
    const { data: rows, error: planErr } = await db.rpc("plan_publish_slots", {
      p_video_id: videoId, p_group_id: item.target_group_id, p_account_ids: null,
      p_start: new Date().toISOString(), p_mode: "drip",
    });
    if (planErr) console.error("handoff: plan_publish_slots failed", planErr.message);
    planned = ((rows ?? []) as { created: boolean }[]).filter((r) => r.created).length;
  }
  return { video_id: videoId, planned };
}

const RUN_COLUMNS =
  "id, content_item_id, project_id, state, provider, provider_job_id, provider_request_id, attempt, locked_by, heartbeat_at, next_retry_at, started_at, finished_at, state_changed_at, error_code, error_message, error_user, error_node, error_at, cost_usd, metadata, created_at, updated_at";

const ITEM_COLUMNS =
  "id, project_id, title, description, prompts, category, content_type, hashtags, status, media_url, pipeline_run_id, parent_item_id, target_group_id, persona_id, engine, idea_id, publish_video_id, created_at, updated_at";

async function loadRun(db: SupabaseClient, runId: string): Promise<RunRow | null> {
  const { data } = await db.from("pipeline_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle();
  return (data as RunRow | null) ?? null;
}

async function loadItem(db: SupabaseClient, itemId: string): Promise<ItemRow | null> {
  const { data } = await db.from("content_plan_items").select(ITEM_COLUMNS).eq("id", itemId).maybeSingle();
  return (data as ItemRow | null) ?? null;
}

async function activeRunForItem(db: SupabaseClient, itemId: string): Promise<RunRow | null> {
  const { data } = await db
    .from("pipeline_runs")
    .select(RUN_COLUMNS)
    .eq("content_item_id", itemId)
    .not("state", "in", `(${TERMINAL_RUN_STATES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as RunRow | null) ?? null;
}

async function settingsFor(db: SupabaseClient, projectId: string): Promise<Json> {
  const { data } = await db.rpc("content_pipeline_settings_json", { p_project_id: projectId });
  return ((data ?? {}) as Json) || {};
}

/* ───────────────────────────── переходы ───────────────────────────── */

interface TransitionPatch {
  provider?: string;
  provider_job_id?: string;
  provider_request_id?: string;
  metadata?: Json;
  cost_add?: number;
  error?: { code: string; message: string; node?: string; user?: string };
  next_retry_at?: string | null;
  finished?: boolean;
}

/** Смена этапа с проверкой машины состояний; пользовательский статус темы — следом. */
async function transition(
  db: SupabaseClient,
  run: RunRow,
  to: RunState,
  patch: TransitionPatch = {},
): Promise<{ ok: true; run: RunRow } | { ok: false; error: string }> {
  if (run.state !== to && !canTransition(run.state, to)) {
    return { ok: false, error: `переход ${run.state} → ${to} запрещён` };
  }
  const update: Json = {
    state: to,
    heartbeat_at: new Date().toISOString(),
  };
  if (patch.provider) update.provider = patch.provider;
  if (patch.provider_job_id) update.provider_job_id = patch.provider_job_id;
  if (patch.provider_request_id) update.provider_request_id = patch.provider_request_id;
  if (patch.metadata) update.metadata = { ...(run.metadata ?? {}), ...patch.metadata };
  if (patch.cost_add) update.cost_usd = Number(run.cost_usd ?? 0) + patch.cost_add;
  if (patch.error) {
    update.error_code = patch.error.code;
    update.error_message = patch.error.message.slice(0, 1500);
    update.error_user = patch.error.user ?? userFacingError(patch.error.code);
    update.error_node = patch.error.node ?? null;
    update.error_at = new Date().toISOString();
  }
  if (patch.next_retry_at !== undefined) update.next_retry_at = patch.next_retry_at;
  if (patch.finished || TERMINAL_RUN_STATES.includes(to)) {
    update.finished_at = new Date().toISOString();
    update.locked_at = null;
  }
  if (to === "retry_wait") update.locked_at = null;

  const { data, error } = await db
    .from("pipeline_runs").update(update).eq("id", run.id).select(RUN_COLUMNS).single();
  if (error) return { ok: false, error: error.message };
  const next = data as RunRow;

  const itemPatch: Json = { status: itemStatusForRunState(to) };
  if (to === "retry_wait") itemPatch.status = "in_progress"; // очередь возобновит тот же запуск
  await db.from("content_plan_items").update(itemPatch).eq("id", run.content_item_id);
  return { ok: true, run: next };
}

/** Итог ошибки этапа: retry_wait (с backoff) или окончательный failed. */
async function failRun(
  db: SupabaseClient,
  run: RunRow,
  input: { code: string; message: string; node?: string; kind?: ErrorKind; retryAfter?: string | null; user?: string },
): Promise<{ run: RunRow; final: boolean }> {
  const settings = await settingsFor(db, run.project_id);
  const maxAttempts = Number(settings.max_attempts ?? 3);
  const kind: ErrorKind = input.kind ?? "unknown";
  const delay = backoffSeconds(kind, run.attempt, input.retryAfter ?? null);
  const canRetry = delay != null && run.attempt < maxAttempts && !TERMINAL_RUN_STATES.includes(run.state);
  const error = { code: input.code, message: input.message, node: input.node, user: input.user };

  if (canRetry) {
    const next = new Date(Date.now() + delay * 1000).toISOString();
    const r = await transition(db, run, "retry_wait", { error, next_retry_at: next });
    if (r.ok) return { run: r.run, final: false };
  }
  const r = await transition(db, run, "failed", { error });
  const finalRun = r.ok ? r.run : run;
  await notifyOperator(
    db,
    run.project_id,
    `❌ Контент-конвейер: запуск ${run.id.slice(0, 8)} упал окончательно на этапе ${run.state}\n` +
      `Код: ${input.code}\nПопытка ${run.attempt}/${maxAttempts}\n${(input.message ?? "").slice(0, 400)}`,
  );
  await db.from("pipeline_runs")
    .update({ metadata: { ...(finalRun.metadata ?? {}), operator_notified: true } })
    .eq("id", run.id);
  return { run: finalRun, final: true };
}

/* ───────────────────────────── детальная карточка ───────────────────────────── */

async function itemDetail(db: SupabaseClient, item: ItemRow): Promise<Json> {
  const [{ data: runs }, { data: assets }, { data: reviews }] = await Promise.all([
    db.from("pipeline_runs").select(RUN_COLUMNS).eq("content_item_id", item.id)
      .order("created_at", { ascending: false }).limit(20),
    db.from("content_assets")
      .select("id, pipeline_run_id, asset_type, version, public_url, mime_type, size_bytes, width, height, duration_seconds, video_codec, audio_codec, checksum_sha256, created_at")
      .eq("content_item_id", item.id).order("created_at", { ascending: false }).limit(50),
    db.from("content_reviews")
      .select("id, pipeline_run_id, decision, comment, reviewer_id, reviewer_label, source, created_at")
      .eq("content_item_id", item.id).order("created_at", { ascending: false }).limit(50),
  ]);
  const runList = (runs ?? []) as RunRow[];
  const current = runList.find((r) => r.id === item.pipeline_run_id) ?? runList[0] ?? null;
  let events: unknown[] = [];
  if (current) {
    const { data } = await db.from("pipeline_run_events")
      .select("from_state, to_state, note, created_at").eq("pipeline_run_id", current.id)
      .order("created_at", { ascending: true }).limit(100);
    events = data ?? [];
  }
  const script = (current?.metadata?.script as Json | undefined) ?? null;
  const [{ data: variants }, group, persona] = await Promise.all([
    db.from("content_plan_items")
      .select("id, title, status, target_group_id, persona_id, engine, publish_video_id, pipeline_run_id, publish_account_groups(name), pipeline_runs!content_plan_items_pipeline_run_fk(state)")
      .eq("parent_item_id", item.id).order("created_at"),
    loadGroup(db, item.target_group_id),
    loadPersona(db, item.persona_id),
  ]);
  return {
    item: {
      id: item.id,
      project_id: item.project_id,
      title: item.title,
      description: item.description,
      prompts: item.prompts,
      category: item.category,
      hashtags: item.hashtags,
      status: item.status,
      media_url: item.media_url,
      parent_item_id: item.parent_item_id,
      target_group_id: item.target_group_id,
      target_group_name: group?.name ?? null,
      review_mode: group?.review_mode ?? null,
      persona_id: item.persona_id,
      persona_name: persona?.name ?? null,
      engine: item.engine ?? persona?.engine_default ?? "heygen",
      idea_id: item.idea_id,
      publish_video_id: item.publish_video_id,
      created_at: item.created_at,
      updated_at: item.updated_at,
    },
    variants: variants ?? [],
    current_run: current
      ? {
        ...publicRun(current),
        state_label: RUN_STATE_LABELS[current.state],
        events,
      }
      : null,
    script,
    runs: runList.map(publicRun),
    assets: assets ?? [],
    reviews: reviews ?? [],
    can: {
      generate: ["idea", "failed", "cancelled"].includes(item.status) && !current?.state.match(/^(claimed|script_|video_|normalizing|retry_wait)/),
      review: current?.state === "awaiting_review",
      retry: !!current && ["failed", "rejected", "cancelled"].includes(current.state),
      cancel: !!current && !TERMINAL_RUN_STATES.includes(current.state) && current.state !== "awaiting_review",
    },
  };
}

/** Запуск без технических полей, которые пользователю не нужны. */
function publicRun(r: RunRow): Json {
  const meta = (r.metadata ?? {}) as Json;
  return {
    id: r.id,
    state: r.state,
    state_label: RUN_STATE_LABELS[r.state],
    attempt: r.attempt,
    provider: r.provider,
    provider_job_id: r.provider_job_id,
    started_at: r.started_at ?? r.created_at,
    finished_at: r.finished_at,
    state_changed_at: r.state_changed_at,
    heartbeat_at: r.heartbeat_at,
    next_retry_at: r.next_retry_at,
    error_code: r.error_code,
    error_user: r.error_user,
    error_at: r.error_at,
    cost_usd: Number(r.cost_usd ?? 0),
    script: meta.script ?? null,
    model: meta.script_model ?? null,
    prompt_version: meta.prompt_version ?? null,
    created_at: r.created_at,
  };
}

/* ───────────────────────────── согласование ───────────────────────────── */

async function applyReview(
  db: SupabaseClient,
  run: RunRow,
  input: { decision: "approved" | "rejected"; comment: string | null; reviewerId: string | null; reviewerLabel: string | null; source: "markvision" | "telegram" | "auto" },
): Promise<{ ok: true; run: RunRow } | { ok: false; error: string; status: number }> {
  if (run.state !== "awaiting_review") {
    return { ok: false, error: "Решение по этой попытке уже принято", status: 409 };
  }
  if (input.decision === "rejected" && !input.comment?.trim()) {
    return { ok: false, error: "Для отклонения нужен комментарий", status: 400 };
  }
  const { error: insErr } = await db.from("content_reviews").insert({
    content_item_id: run.content_item_id,
    pipeline_run_id: run.id,
    project_id: run.project_id,
    decision: input.decision,
    comment: input.comment?.trim() || null,
    reviewer_id: input.reviewerId,
    reviewer_label: input.reviewerLabel,
    source: input.source === "auto" ? "markvision" : input.source,
  });
  if (insErr) {
    // unique(pipeline_run_id): решение уже записано другим каналом.
    if (insErr.code === "23505") return { ok: false, error: "Решение по этой попытке уже принято", status: 409 };
    return { ok: false, error: insErr.message, status: 500 };
  }
  const r = await transition(db, run, input.decision, {
    metadata: { review: { decision: input.decision, comment: input.comment, source: input.source, at: new Date().toISOString() } },
  });
  if (!r.ok) return { ok: false, error: r.error, status: 500 };
  // Кнопки Telegram по этой попытке больше не действуют.
  await db.from("pipeline_review_tokens")
    .update({ used_at: new Date().toISOString() }).eq("pipeline_run_id", run.id).is("used_at", null);
  const item = await loadItem(db, run.content_item_id);
  if (input.decision === "rejected") {
    // Новая попытка: тема возвращается в очередь; комментарий подхватит claim.
    if (item?.target_group_id) {
      await db.from("publish_account_groups").update({ approved_streak: 0 }).eq("id", item.target_group_id);
    }
    await kickN8n({ reason: "rejected", project_id: run.project_id, item_id: run.content_item_id });
  } else if (item) {
    if (item.target_group_id && input.source !== "auto") {
      const group = await loadGroup(db, item.target_group_id);
      if (group) {
        await db.from("publish_account_groups").update({ approved_streak: group.approved_streak + 1 }).eq("id", group.id);
      }
    }
    // Одобрено → библиотека публикации → слоты по группе.
    const handoff = await handoffToPublishing(db, r.run, item);
    await db.from("pipeline_runs").update({
      metadata: { ...(r.run.metadata ?? {}), handoff: { ...handoff, at: new Date().toISOString() } },
    }).eq("id", run.id);
  }
  return { ok: true, run: r.run };
}

async function sendReviewRequest(db: SupabaseClient, run: RunRow, item: ItemRow, videoUrl: string): Promise<void> {
  const chatId = await projectChatId(db, run.project_id);
  if (!chatId || !botToken()) {
    console.warn("review request: no telegram chat/bot for project", run.project_id);
    return;
  }
  const approveToken = randomToken(24);
  const rejectToken = randomToken(24);
  const expires = new Date(Date.now() + REVIEW_TOKEN_TTL_MS).toISOString();
  const { error } = await db.from("pipeline_review_tokens").insert([
    { token: approveToken, pipeline_run_id: run.id, decision: "approved", chat_id: chatId, expires_at: expires },
    { token: rejectToken, pipeline_run_id: run.id, decision: "rejected", chat_id: chatId, expires_at: expires },
  ]);
  if (error) {
    console.error("review tokens insert failed", error.message);
    return;
  }
  const { data: project } = await db.from("projects").select("name").eq("id", run.project_id).maybeSingle();
  const script = ((run.metadata?.script as Json | undefined) ?? {}) as Json;
  const appUrl = env("APP_PUBLIC_URL");
  const caption = formatReviewCaption({
    projectName: String((project as { name?: string } | null)?.name ?? "MarkVision"),
    title: String(script.title ?? item.title),
    script: String(script.script ?? ""),
    attempt: run.attempt,
    itemUrl: appUrl ? `${appUrl.replace(/\/$/, "")}/marketing/content-plan/${item.id}` : null,
  });
  const sent = await tgSendVideo(chatId, videoUrl, caption, reviewKeyboard(approveToken, rejectToken));
  const messageId = (sent?.result as { message_id?: number } | undefined)?.message_id ?? null;
  if (messageId) {
    await db.from("pipeline_review_tokens").update({ message_id: messageId }).in("token", [approveToken, rejectToken]);
  }
}

/* ───────────────────────────── пользовательский API ───────────────────────────── */

async function handleUser(req: Request, segments: string[]): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const userDb = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth.authHeader } },
  });
  const db = admin();
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Json) : {};

  // POST /items
  if (segments.length === 1 && req.method === "POST") {
    const projectId = String(body.project_id ?? "").trim();
    const title = String(body.title ?? "").trim();
    if (!projectId) return json({ error: "project_id обязателен" }, 400);
    if (!title && !String(body.description ?? "").trim()) return json({ error: "Нужна тема или описание" }, 400);
    const { data: proj } = await userDb.from("projects").select("id").eq("id", projectId).maybeSingle();
    if (!proj) return json({ error: "Нет доступа к проекту" }, 403);
    const { data: created, error } = await db.from("content_plan_items").insert({
      project_id: projectId,
      title: title || String(body.description).slice(0, 80),
      description: body.description ? String(body.description) : null,
      prompts: body.prompts ? String(body.prompts) : null,
      category: body.category ? String(body.category) : "content",
      content_type: "REELS",
      status: "idea",
      created_by: auth.userId,
    }).select(ITEM_COLUMNS).single();
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, ...(await itemDetail(db, created as ItemRow)) }, 201);
  }

  const itemId = segments[1];
  const action = segments[2] ?? null;
  if (!itemId || !/^[0-9a-f-]{36}$/i.test(itemId)) return json({ error: "Некорректный id" }, 400);

  // Доступ к теме проверяется RLS пользователя: чужой проект → «не найдено».
  const { data: visible } = await userDb.from("content_plan_items").select("id").eq("id", itemId).maybeSingle();
  if (!visible) return json({ error: "Публикация не найдена" }, 404);
  const item = await loadItem(db, itemId);
  if (!item) return json({ error: "Публикация не найдена" }, 404);

  // GET /items/:id
  if (!action && req.method === "GET") return json(await itemDetail(db, item));
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  const current = await activeRunForItem(db, itemId);

  if (action === "generate") {
    if (item.content_type !== "REELS") return json({ error: "Конвейер работает только с Reels" }, 400);
    if (current) return json({ ok: true, already_running: true, ...(await itemDetail(db, item)) });
    const settings = await settingsFor(db, item.project_id);
    if (settings.enabled === false) return json({ error: "Конвейер выключен в настройках проекта" }, 409);
    const { data: budgetOk } = await db.rpc("content_pipeline_budget_ok", { p_project_id: item.project_id });
    if (budgetOk === false) return json({ error: userFacingError("budget_exceeded") }, 409);
    if (item.status !== "idea") {
      await db.from("content_plan_items").update({ status: "idea" }).eq("id", itemId);
    }
    const kicked = await kickN8n({ reason: "generate", project_id: item.project_id, item_id: itemId, user_id: auth.userId });
    const fresh = (await loadItem(db, itemId)) ?? item;
    return json({ ok: true, queued: true, kicked, ...(await itemDetail(db, fresh)) });
  }

  if (action === "review") {
    const decision = String(body.decision ?? "");
    if (decision !== "approved" && decision !== "rejected") return json({ error: "decision: approved | rejected" }, 400);
    if (!current) return json({ error: "Нет попытки, ожидающей согласования" }, 409);
    const r = await applyReview(db, current, {
      decision,
      comment: body.comment ? String(body.comment) : null,
      reviewerId: auth.userId,
      reviewerLabel: auth.claims.email ? String(auth.claims.email) : null,
      source: "markvision",
    });
    if (!r.ok) return json({ error: r.error }, r.status);
    const fresh = (await loadItem(db, itemId)) ?? item;
    return json({ ok: true, ...(await itemDetail(db, fresh)) });
  }

  if (action === "retry") {
    if (current) return json({ error: "Попытка ещё выполняется" }, 409);
    const last = (await db.from("pipeline_runs").select(RUN_COLUMNS).eq("content_item_id", itemId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()).data as RunRow | null;
    const allowed = ["failed", "cancelled"].includes(item.status) ||
      (last && ["failed", "rejected", "cancelled"].includes(last.state));
    if (!allowed) return json({ error: "Повтор доступен только для failed / rejected / cancelled" }, 409);
    await db.from("content_plan_items").update({ status: "idea" }).eq("id", itemId);
    const kicked = await kickN8n({ reason: "retry", project_id: item.project_id, item_id: itemId, user_id: auth.userId, comment: body.comment ?? null });
    const fresh = (await loadItem(db, itemId)) ?? item;
    return json({ ok: true, queued: true, kicked, ...(await itemDetail(db, fresh)) });
  }

  if (action === "variants") {
    // Фабрика вариантов: тема × группы → дочерние темы с персоной группы (M2).
    const groupIds = (Array.isArray(body.group_ids) ? body.group_ids : []).map(String).filter(Boolean);
    if (!groupIds.length) return json({ error: "group_ids обязателен" }, 400);
    if (item.parent_item_id) return json({ error: "Вариант нельзя разветвить ещё раз" }, 400);
    const { data: groups } = await db.from("publish_account_groups")
      .select("id, name, persona_id, review_mode").eq("project_id", item.project_id).in("id", groupIds);
    const created: Json[] = [];
    const skipped: Json[] = [];
    for (const g of (groups ?? []) as { id: string; name: string; persona_id: string | null; review_mode: string }[]) {
      const persona = await loadPersona(db, g.persona_id);
      const { data: child, error } = await db.from("content_plan_items").insert({
        project_id: item.project_id,
        title: item.title,
        description: item.description,
        prompts: [item.prompts ?? "", `Вариант для группы «${g.name}»${persona ? ` (персона ${persona.name})` : ""}.`].filter(Boolean).join("\n"),
        category: item.category,
        content_type: "REELS",
        status: "idea",
        parent_item_id: item.id,
        target_group_id: g.id,
        persona_id: g.persona_id,
        engine: persona?.engine_default ?? item.engine ?? "heygen",
        idea_id: item.idea_id,
        created_by: auth.userId,
      }).select("id, title, target_group_id").maybeSingle();
      if (error) {
        skipped.push({ group_id: g.id, reason: error.code === "23505" ? "вариант для этой группы уже есть" : error.message });
      } else {
        created.push({ ...(child as Json), group_name: g.name });
      }
    }
    const requested = new Set(groupIds);
    for (const g of (groups ?? []) as { id: string }[]) requested.delete(g.id);
    for (const missing of requested) skipped.push({ group_id: missing, reason: "группа не найдена в проекте" });
    if (created.length) await kickN8n({ reason: "variants", project_id: item.project_id, item_id: itemId, user_id: auth.userId });
    return json({ ok: true, created, skipped, ...(await itemDetail(db, item)) });
  }

  if (action === "settings") {
    // Цель публикации, персона и движок — только пока запуск не идёт: воркер
    // берёт их в момент claim, менять под ним бессмысленно.
    if (current) return json({ error: "Сначала остановите активную попытку" }, 409);
    const patch: Record<string, unknown> = {};
    if ("target_group_id" in body) {
      const gid = body.target_group_id;
      if (gid !== null && typeof gid !== "string") return json({ error: "target_group_id: uuid | null" }, 400);
      if (gid) {
        const { data: g } = await db.from("publish_account_groups").select("id, persona_id").eq("id", gid).eq("project_id", item.project_id).maybeSingle();
        if (!g) return json({ error: "Группа не найдена в проекте" }, 400);
        // Персона группы подхватывается, если тема её ещё не выбрала явно.
        if (!("persona_id" in body) && !item.persona_id && (g as { persona_id: string | null }).persona_id) patch.persona_id = (g as { persona_id: string | null }).persona_id;
      }
      patch.target_group_id = gid;
    }
    if ("persona_id" in body) {
      const pid = body.persona_id;
      if (pid !== null && typeof pid !== "string") return json({ error: "persona_id: uuid | null" }, 400);
      if (pid) {
        const { data: p } = await db.from("personas").select("id, engine_default").eq("id", pid).eq("project_id", item.project_id).maybeSingle();
        if (!p) return json({ error: "Персона не найдена в проекте" }, 400);
        if (!("engine" in body) && !item.engine) patch.engine = (p as { engine_default: string }).engine_default;
      }
      patch.persona_id = pid;
    }
    if ("engine" in body) {
      const engine = body.engine;
      if (engine !== null && !["heygen", "reels_faceless", "montage"].includes(String(engine))) return json({ error: "engine: heygen | reels_faceless | montage | null" }, 400);
      patch.engine = engine;
    }
    if (!Object.keys(patch).length) return json({ error: "Нечего менять" }, 400);
    const { error } = await db.from("content_plan_items").update(patch).eq("id", itemId);
    if (error) return json({ error: error.message }, 400);
    const fresh = (await loadItem(db, itemId)) ?? item;
    return json({ ok: true, ...(await itemDetail(db, fresh)) });
  }

  if (action === "cancel") {
    if (!current) return json({ error: "Нет активной попытки" }, 409);
    const r = await transition(db, current, "cancelled", {
      error: { code: "cancelled", message: `отменено пользователем ${auth.userId}`, node: "user" },
    });
    if (!r.ok) return json({ error: r.error }, 409);
    const fresh = (await loadItem(db, itemId)) ?? item;
    return json({ ok: true, ...(await itemDetail(db, fresh)) });
  }

  return json({ error: "Неизвестное действие" }, 404);
}

/* ───────────────────────────── callback n8n ───────────────────────────── */

async function handleCallback(req: Request): Promise<Response> {
  const secret = env("CONTENT_PIPELINE_CALLBACK_SECRET");
  const raw = await req.text();
  const verified = await verifyCallbackSignature({
    secret,
    timestamp: req.headers.get("x-pipeline-timestamp"),
    nonce: req.headers.get("x-pipeline-nonce"),
    signature: req.headers.get("x-pipeline-signature"),
    body: raw,
  });
  if (!verified.ok) return json({ error: `unauthorized: ${verified.reason}` }, 401);

  const db = admin();
  // Replay: nonce принимается один раз (PK).
  const { error: nonceErr } = await db.from("pipeline_callback_nonces").insert({ nonce: req.headers.get("x-pipeline-nonce") });
  if (nonceErr) return json({ error: "replay" }, 409);

  let body: Json;
  try {
    body = JSON.parse(raw) as Json;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const event = String(body.event ?? "");

  if (event === "claim") {
    const workerId = String(body.worker_id ?? "n8n").slice(0, 80);
    const projectId = body.project_id ? String(body.project_id) : null;
    // Движок воркера: n8n v5 рендерит HeyGen; reels_faceless/montage забирают свои воркеры.
    const wantEngine = ["heygen", "reels_faceless", "montage"].includes(String(body.engine)) ? String(body.engine) : "heygen";
    const { data, error } = await db.rpc("claim_next_content_job", { p_worker_id: workerId, p_project_id: projectId, p_engine: wantEngine });
    if (error) return json({ error: error.message }, 500);
    const rows = (data ?? []) as Json[];
    if (!rows.length) return json({ ok: true, job: null });
    const job = rows[0];
    const settings = (job.settings ?? {}) as Json;
    // Персона группы (фабрика вариантов): tone of voice, ниша, запреты, голос/аватар.
    const claimedItem = await loadItem(db, String(job.content_item_id));
    const persona = await loadPersona(db, claimedItem?.persona_id ?? null);
    const engine = claimedItem?.engine ?? persona?.engine_default ?? "heygen";
    // Комментарий последнего отклонения — вход для нового сценария.
    const { data: lastReview } = await db.from("content_reviews").select("comment")
      .eq("content_item_id", String(job.content_item_id)).eq("decision", "rejected")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const prompt = buildScriptPrompt({
      projectName: String(job.project_name ?? ""),
      businessContext: (settings.business_context as string | null) ?? null,
      topic: String(job.title ?? ""),
      description: (job.description as string | null) ?? null,
      wishes: [
        (job.prompts as string | null) ?? "",
        persona ? `Персона: ${persona.name}${persona.niche ? `, ниша: ${persona.niche}` : ""}.` : "",
      ].filter(Boolean).join("\n") || null,
      category: (job.category as string | null) ?? null,
      language: persona?.language ?? (settings.language as string | null) ?? "ru",
      wordsMin: Number(settings.script_words_min ?? 90),
      wordsMax: Number(settings.script_words_max ?? 130),
      toneOfVoice: persona?.tone_of_voice ?? (settings.tone_of_voice as string | null) ?? null,
      forbiddenPhrases: [
        ...((settings.forbidden_phrases as string[] | null) ?? []),
        ...(persona?.forbidden_phrases ?? []),
      ],
      previousRejectionComment: (lastReview as { comment?: string | null } | null)?.comment ?? null,
      promptVersion: String(settings.prompt_version ?? "v5.0"),
    });
    const runMeta = (job.run_metadata ?? {}) as Json;
    return json({
      ok: true,
      job: {
        run_id: job.pipeline_run_id,
        item_id: job.content_item_id,
        project_id: job.project_id,
        attempt: job.attempt,
        resumed: job.resumed,
        provider_job_id: job.provider_job_id,
        // При возобновлении сценарий/видео уже могут быть готовы — n8n пропускает этапы.
        script: runMeta.script ?? null,
        video_url: runMeta.video_url ?? null,
        title: job.title,
        engine,
        persona: persona ? { id: persona.id, name: persona.name, eleven_voice_id: persona.eleven_voice_id, reels_theme: persona.reels_theme } : null,
        target_group_id: claimedItem?.target_group_id ?? null,
        settings: {
          language: persona?.language ?? settings.language ?? "ru",
          openai_model: settings.openai_model ?? "gpt-4o-mini",
          heygen_avatar_id: persona?.heygen_avatar_id ?? settings.heygen_avatar_id ?? null,
          heygen_voice_id: persona?.heygen_voice_id ?? settings.heygen_voice_id ?? null,
          video_width: settings.video_width ?? 720,
          video_height: settings.video_height ?? 1280,
          video_timeout_minutes: settings.video_timeout_minutes ?? 20,
          max_attempts: settings.max_attempts ?? 3,
        },
        script_prompt: { system: prompt.system, user: prompt.user, prompt_version: prompt.promptVersion },
        script_schema: SCRIPT_JSON_SCHEMA,
      },
    });
  }

  const runId = String(body.run_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return json({ error: "run_id required" }, 400);
  const run = await loadRun(db, runId);
  if (!run) return json({ error: "run not found" }, 404);
  if (TERMINAL_RUN_STATES.includes(run.state) && event !== "heartbeat") {
    return json({ ok: false, error: `run is ${run.state}`, state: run.state }, 409);
  }

  switch (event) {
    case "heartbeat": {
      await db.from("pipeline_runs").update({ heartbeat_at: new Date().toISOString() }).eq("id", runId);
      return json({ ok: true, state: run.state });
    }

    case "state": {
      const to = body.state;
      if (!isRunState(to)) return json({ error: "unknown state" }, 400);
      const r = await transition(db, run, to, {
        provider: body.provider ? String(body.provider) : undefined,
        provider_request_id: body.provider_request_id ? String(body.provider_request_id) : undefined,
        metadata: (body.metadata as Json | undefined) ?? undefined,
      });
      if (!r.ok) return json({ error: r.error }, 409);
      return json({ ok: true, state: r.run.state });
    }

    case "script": {
      // Сценарий валидируется здесь, а не в n8n: одна точка правды.
      const settings = await settingsFor(db, run.project_id);
      const parsed = parseScriptJson(body.script_raw ?? body.script);
      const v = validateScript(parsed, {
        wordsMin: Number(settings.script_words_min ?? 90),
        wordsMax: Number(settings.script_words_max ?? 130),
        forbiddenPhrases: (settings.forbidden_phrases as string[] | null) ?? [],
      });
      const model = String(body.model ?? settings.openai_model ?? "");
      const usage = (body.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? null;
      const cost = estimateOpenAiCostUsd(model, usage);
      if (!v.ok) {
        // Не более одной повторной генерации решает n8n по attempt_index; здесь — только факт.
        await db.from("pipeline_runs").update({
          heartbeat_at: new Date().toISOString(),
          cost_usd: Number(run.cost_usd ?? 0) + cost,
          metadata: {
            ...(run.metadata ?? {}),
            script_invalid: { errors: v.errors, words: v.words, at: new Date().toISOString() },
          },
        }).eq("id", runId);
        return json({ ok: false, valid: false, errors: v.errors, words: v.words });
      }
      const script = v.value!;
      const r = await transition(db, run, "script_ready", {
        provider: "openai",
        cost_add: cost,
        metadata: {
          script,
          script_model: model,
          script_usage: usage,
          prompt_version: body.prompt_version ?? settings.prompt_version ?? "v5.0",
          usage: { ...((run.metadata?.usage as Json | undefined) ?? {}), openai_usd: cost },
        },
      });
      if (!r.ok) return json({ error: r.error }, 409);
      await db.from("content_plan_items").update({
        description: script.description,
        hashtags: script.hashtags.join(" "),
      }).eq("id", run.content_item_id);
      return json({ ok: true, valid: true, state: r.run.state, script, words: v.words, cost_usd: cost });
    }

    case "video_requested": {
      // Идемпотентно: второй платный заказ по тому же запуску невозможен.
      if (run.provider_job_id) {
        return json({ ok: true, already: true, provider_job_id: run.provider_job_id, state: run.state });
      }
      const jobId = String(body.provider_job_id ?? "").trim();
      if (!jobId) return json({ error: "provider_job_id required" }, 400);
      const r = await transition(db, run, "video_requested", {
        provider: String(body.provider ?? "heygen"),
        provider_job_id: jobId,
        provider_request_id: body.provider_request_id ? String(body.provider_request_id) : undefined,
        metadata: { video_requested_at: new Date().toISOString() },
      });
      if (!r.ok) return json({ error: r.error }, 409);
      return json({ ok: true, provider_job_id: jobId, state: r.run.state });
    }

    case "video_status": {
      const status = String(body.status ?? "").toLowerCase();
      const videoUrl = body.video_url ? String(body.video_url) : null;
      const duration = body.duration_seconds != null ? Number(body.duration_seconds) : null;
      const settings = await settingsFor(db, run.project_id);
      const timeoutMin = Number(settings.video_timeout_minutes ?? 20);
      const requestedAt = Date.parse(String(run.metadata?.video_requested_at ?? run.state_changed_at));

      if (status === "completed" && videoUrl) {
        if (run.state === "video_ready" || run.state === "normalizing") {
          return json({ ok: true, already: true, state: run.state, video_url: run.metadata?.video_url ?? videoUrl });
        }
        const rate = Number(env("HEYGEN_USD_PER_MINUTE", "1"));
        const cost = estimateHeygenCostUsd(duration, rate);
        const r = await transition(db, run, "video_ready", {
          cost_add: cost,
          metadata: {
            video_url: videoUrl,
            video_duration_seconds: duration,
            video_ready_at: new Date().toISOString(),
            usage: { ...((run.metadata?.usage as Json | undefined) ?? {}), heygen_usd: cost },
          },
        });
        if (!r.ok) return json({ error: r.error }, 409);
        return json({ ok: true, state: "video_ready", video_url: videoUrl, cost_usd: cost });
      }
      if (status === "failed" || status === "error") {
        const res = await failRun(db, run, {
          code: "video_provider",
          message: safeTechMessage(body.error ?? "provider reported failure"),
          node: "HeyGen status",
          kind: "provider_failed",
        });
        return json({ ok: true, state: res.run.state, final: res.final });
      }
      // processing / pending / waiting
      if (!Number.isNaN(requestedAt) && Date.now() - requestedAt > timeoutMin * 60_000) {
        const res = await failRun(db, run, {
          code: "video_timeout",
          message: `провайдер не отдал видео за ${timeoutMin} мин (job ${run.provider_job_id})`,
          node: "HeyGen status",
          kind: "provider_timeout",
        });
        return json({ ok: true, state: res.run.state, timeout: true, final: res.final });
      }
      if (run.state === "video_requested" || run.state === "claimed") {
        // claimed — возобновление после retry_wait с сохранённым provider_job_id.
        const r = await transition(db, run, "video_rendering", { metadata: { last_provider_status: status } });
        if (!r.ok) return json({ error: r.error }, 409);
      } else {
        await db.from("pipeline_runs").update({
          heartbeat_at: new Date().toISOString(),
          metadata: { ...(run.metadata ?? {}), last_provider_status: status },
        }).eq("id", runId);
      }
      return json({ ok: true, state: "video_rendering", poll_again: true });
    }

    case "asset": {
      const assetType = String(body.asset_type ?? "");
      if (!["provider_video", "normalized_video", "thumbnail", "script"].includes(assetType)) {
        return json({ error: "bad asset_type" }, 400);
      }
      const { data: prev } = await db.from("content_assets").select("version")
        .eq("content_item_id", run.content_item_id).eq("asset_type", assetType)
        .order("version", { ascending: false }).limit(1).maybeSingle();
      const version = Number((prev as { version?: number } | null)?.version ?? 0) + 1;
      const { data: asset, error } = await db.from("content_assets").insert({
        content_item_id: run.content_item_id,
        pipeline_run_id: run.id,
        project_id: run.project_id,
        asset_type: assetType,
        version,
        storage_path: String(body.storage_path ?? body.public_url ?? ""),
        public_url: body.public_url ? String(body.public_url) : null,
        mime_type: body.mime_type ? String(body.mime_type) : null,
        size_bytes: body.size_bytes != null ? Number(body.size_bytes) : null,
        width: body.width != null ? Number(body.width) : null,
        height: body.height != null ? Number(body.height) : null,
        duration_seconds: body.duration_seconds != null ? Number(body.duration_seconds) : null,
        video_codec: body.video_codec ? String(body.video_codec) : null,
        audio_codec: body.audio_codec ? String(body.audio_codec) : null,
        checksum_sha256: body.checksum_sha256 ? String(body.checksum_sha256) : null,
      }).select("id, version, public_url").single();
      if (error) return json({ error: error.message }, 500);

      if (assetType !== "normalized_video") return json({ ok: true, asset });

      const publicUrl = String(body.public_url ?? "");
      let cur = run;
      if (cur.state === "video_ready") {
        const s = await transition(db, cur, "normalizing", {});
        if (!s.ok) return json({ error: s.error }, 409);
        cur = s.run;
      }
      const r = await transition(db, cur, "awaiting_review", {
        metadata: { normalized_url: publicUrl, normalized_at: new Date().toISOString(), asset_version: version },
      });
      if (!r.ok) return json({ error: r.error }, 409);
      const item = await loadItem(db, run.content_item_id);
      if (item) {
        await db.from("content_plan_items").update({ media_url: publicUrl }).eq("id", item.id);
        const group = await loadGroup(db, item.target_group_id);
        // Доверенная группа: после auto_publish_after одобрений подряд ворота не нужны.
        if (group && group.review_mode === "auto_publish" && group.approved_streak >= group.auto_publish_after) {
          const auto = await applyReview(db, r.run, {
            decision: "approved", comment: null, reviewerId: null, reviewerLabel: `auto (${group.name})`, source: "auto",
          });
          return json({ ok: true, asset, state: auto.ok ? "approved" : "awaiting_review", auto_approved: auto.ok });
        }
        await sendReviewRequest(db, r.run, item, publicUrl);
      }
      return json({ ok: true, asset, state: "awaiting_review" });
    }

    case "fail": {
      const kindRaw = String(body.kind ?? "unknown");
      const kind = (["network", "server", "rate_limited", "validation", "auth", "provider_timeout", "provider_failed", "budget", "unknown"]
        .includes(kindRaw) ? kindRaw : "unknown") as ErrorKind;
      const res = await failRun(db, run, {
        code: String(body.error_code ?? "pipeline_error").slice(0, 64),
        message: safeTechMessage(body.error_message ?? ""),
        node: body.node ? String(body.node).slice(0, 120) : undefined,
        kind,
        retryAfter: body.retry_after ? String(body.retry_after) : null,
      });
      return json({ ok: true, state: res.run.state, final: res.final, next_retry_at: res.run.next_retry_at });
    }

    default:
      return json({ error: "unknown event" }, 400);
  }
}

/* ───────────────────────────── Telegram ───────────────────────────── */

async function handleTelegram(req: Request): Promise<Response> {
  const expected = env("CONTENT_PIPELINE_TELEGRAM_SECRET");
  if (!expected || req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return new Response("forbidden", { status: 403 });
  }
  const ok = () => new Response("ok", { status: 200 });
  const update = (await req.json().catch(() => null)) as Json | null;
  if (!update) return ok();
  const db = admin();

  if (typeof update.update_id === "number") {
    const { error } = await db.from("pipeline_telegram_updates").insert({ update_id: update.update_id });
    if (error) return ok(); // повторная доставка
  }

  const cq = update.callback_query as Json | undefined;
  if (cq) {
    const cqId = String(cq.id ?? "");
    const from = (cq.from ?? {}) as { username?: string; first_name?: string; id?: number };
    const label = from.username ? `@${from.username}` : (from.first_name ?? String(from.id ?? ""));
    const token = parseCallbackData(cq.data);
    if (!token) {
      await tg("answerCallbackQuery", { callback_query_id: cqId, text: "Неизвестная кнопка" });
      return ok();
    }
    const { data: row } = await db.from("pipeline_review_tokens")
      .select("token, pipeline_run_id, decision, chat_id, message_id, expires_at, used_at").eq("token", token).maybeSingle();
    const t = row as { pipeline_run_id: string; decision: "approved" | "rejected"; chat_id: string; message_id: number | null; expires_at: string; used_at: string | null } | null;
    if (!t || t.used_at || Date.parse(t.expires_at) < Date.now()) {
      await tg("answerCallbackQuery", { callback_query_id: cqId, text: "Решение по этому ролику уже принято или ссылка истекла" });
      return ok();
    }
    const run = await loadRun(db, t.pipeline_run_id);
    if (!run || run.state !== "awaiting_review") {
      await tg("answerCallbackQuery", { callback_query_id: cqId, text: "Решение уже принято" });
      return ok();
    }

    if (t.decision === "approved") {
      const r = await applyReview(db, run, { decision: "approved", comment: null, reviewerId: null, reviewerLabel: label, source: "telegram" });
      await tg("answerCallbackQuery", { callback_query_id: cqId, text: r.ok ? "Одобрено ✅" : r.error });
      if (r.ok && t.message_id) {
        await tg("editMessageReplyMarkup", { chat_id: t.chat_id, message_id: t.message_id, reply_markup: { inline_keyboard: [] } });
        await tg("sendMessage", { chat_id: t.chat_id, reply_to_message_id: t.message_id, text: `✅ Одобрено ${label}` });
      }
      return ok();
    }

    // Отклонение: комментарий обязателен — просим ответом на сообщение бота.
    const prompt = await tg("sendMessage", {
      chat_id: t.chat_id,
      reply_to_message_id: t.message_id ?? undefined,
      text: `${label}, напишите причину отклонения ответом на это сообщение — она уйдёт в следующую генерацию.`,
      reply_markup: { force_reply: true, selective: true },
    });
    const promptId = (prompt?.result as { message_id?: number } | undefined)?.message_id ?? null;
    if (promptId) {
      await db.from("pipeline_review_tokens").update({ prompt_message_id: promptId }).eq("token", token);
    }
    await tg("answerCallbackQuery", { callback_query_id: cqId, text: "Напишите причину ответом на сообщение" });
    return ok();
  }

  const message = update.message as Json | undefined;
  const reply = message?.reply_to_message as Json | undefined;
  const chat = message?.chat as { id?: number } | undefined;
  const text = String(message?.text ?? "").trim();
  if (!message || !reply || !chat?.id || !text) return ok();

  const { data: row } = await db.from("pipeline_review_tokens")
    .select("token, pipeline_run_id, message_id")
    .eq("chat_id", String(chat.id)).eq("prompt_message_id", Number(reply.message_id)).is("used_at", null).maybeSingle();
  const t = row as { token: string; pipeline_run_id: string; message_id: number | null } | null;
  if (!t) return ok();
  const run = await loadRun(db, t.pipeline_run_id);
  if (!run) return ok();
  const from = (message.from ?? {}) as { username?: string; first_name?: string };
  const label = from.username ? `@${from.username}` : (from.first_name ?? "telegram");
  const r = await applyReview(db, run, { decision: "rejected", comment: text.slice(0, 2000), reviewerId: null, reviewerLabel: label, source: "telegram" });
  if (r.ok) {
    if (t.message_id) {
      await tg("editMessageReplyMarkup", { chat_id: String(chat.id), message_id: t.message_id, reply_markup: { inline_keyboard: [] } });
    }
    await tg("sendMessage", { chat_id: String(chat.id), reply_to_message_id: Number(message.message_id), text: "❌ Отклонено. Тема вернулась в очередь с вашим комментарием." });
  } else {
    await tg("sendMessage", { chat_id: String(chat.id), reply_to_message_id: Number(message.message_id), text: r.error });
  }
  return ok();
}

/* ───────────────────────────── обслуживание ───────────────────────────── */

async function handleMaintenance(req: Request): Promise<Response> {
  const db = admin();
  if (!(await automationKeyValid(req, db))) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) return json({ error: "forbidden" }, 403);
  }
  const out: Json = { requeued: 0, notified: 0, stuck_alerts: 0 };

  const { data: requeued, error } = await db.rpc("requeue_stale_content_jobs");
  if (error) return json({ error: error.message }, 500);
  out.requeued = requeued ?? 0;

  // Окончательные ошибки, о которых оператор ещё не знает (в т.ч. из SQL-крона).
  const { data: failed } = await db.from("pipeline_runs").select(RUN_COLUMNS)
    .eq("state", "failed").order("finished_at", { ascending: false }).limit(50);
  for (const r of (failed ?? []) as RunRow[]) {
    if (r.metadata?.operator_notified) continue;
    await notifyOperator(db, r.project_id,
      `❌ Контент-конвейер: запуск ${r.id.slice(0, 8)} завершён с ошибкой (${r.error_code ?? "unknown"})\n${(r.error_message ?? "").slice(0, 400)}`);
    await db.from("pipeline_runs").update({ metadata: { ...(r.metadata ?? {}), operator_notified: true } }).eq("id", r.id);
    out.notified = Number(out.notified) + 1;
  }

  // Зависшая очередь: тема ждёт дольше 3 часов, а активных запусков нет — не чаще раза в час.
  const { data: metrics } = await db.from("content_pipeline_metrics")
    .select("project_id, queue_size, oldest_queued_seconds, active_runs").gt("queue_size", 0);
  for (const m of (metrics ?? []) as { project_id: string; oldest_queued_seconds: number | null; active_runs: number }[]) {
    if ((m.oldest_queued_seconds ?? 0) < 3 * 3600 || m.active_runs > 0) continue;
    const bucket = `alert:queue_stuck:${m.project_id}:${Math.floor(Date.now() / 3_600_000)}`;
    const { error: dup } = await db.from("pipeline_callback_nonces").insert({ nonce: bucket });
    if (dup) continue;
    await notifyOperator(db, m.project_id,
      `⏳ Контент-конвейер: очередь проекта стоит ${Math.round((m.oldest_queued_seconds ?? 0) / 3600)} ч без активных запусков. Проверьте n8n и бюджет.`);
    out.stuck_alerts = Number(out.stuck_alerts) + 1;
  }

  await db.rpc("content_pipeline_gc");
  return json({ ok: true, ...out });
}

/* ───────────────────────────── маршрутизация ───────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("content-pipeline");
  const segments = idx >= 0 ? parts.slice(idx + 1) : parts;

  try {
    if (segments[0] === "internal" && segments[1] === "callback" && req.method === "POST") return await handleCallback(req);
    if (segments[0] === "telegram" && req.method === "POST") return await handleTelegram(req);
    if (segments[0] === "maintenance" && req.method === "POST") return await handleMaintenance(req);
    if (segments[0] === "items") return await handleUser(req, segments);
    if (segments.length === 0 && req.method === "GET") return json({ ok: true, service: "content-pipeline" });
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error("content-pipeline unhandled", safeTechMessage(e));
    return json({ error: "internal error" }, 500);
  }
});
