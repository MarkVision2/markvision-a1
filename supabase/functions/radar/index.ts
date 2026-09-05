/**
 * Радар идей (docs/AUTOPOSTING-PLATFORM-PLAN.md, M1): источники → посты →
 * разбор → банк идей → тема контент-плана.
 *
 *   Пользовательский API (JWT + доступ к проекту):
 *     GET  /radar?project_id=…                 обзор: источники, витрина, идеи, лучшие посты
 *     POST /radar/sources                      { project_id, kind, platform, handle, label?, crawl_interval_hours?, id? }
 *     POST /radar/sources/:id/delete
 *     POST /radar/sources/:id/crawl            собрать сейчас (пинок n8n-сборщика)
 *     POST /radar/analyze-url                  { project_id, url } — разобрать одну ссылку (через n8n)
 *     POST /radar/posts/:id/analyze            повторный разбор поста
 *     POST /radar/ideas/:id                    { status?, title?, hook?, angle?, target_group_id? }
 *     POST /radar/ideas/:id/promote            { group_id?, persona_id?, engine? } → тема REELS в контент-плане
 *
 *   Сборщик. Основной — прямой запуск актора Apify из этой функции
 *   (секрет APIFY_TOKEN, чистая логика _lib/radarCrawl.ts): запуск асинхронный,
 *   строка radar_runs со status = running; результат дособирается при GET /radar
 *   (обзор) и по крону. Запасной — n8n-сборщик (N8N_RADAR_WEBHOOK_URL), который
 *   возвращает посты подписанным callback'ом (HMAC как у content-pipeline, секрет
 *   RADAR_CALLBACK_SECRET или CONTENT_PIPELINE_CALLBACK_SECRET):
 *     POST /radar/internal/ingest  { project_id, source_id?, provider, cost_usd?, items: [...] }
 *
 *   Обслуживание (x-automation-key, pg_cron каждые 15 минут):
 *     POST /radar/maintenance  — дозагрузка запусков Apify, разбор накопившихся
 *       постов (Whisper + LLM через _lib/aiProvider), идеи в банк, запуск сбора
 *       источников по расписанию, GC.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { automationKeyValid } from "../_lib/publishing.ts";
import { aiChatCompletion, aiTranscription, hasAiProvider } from "../_lib/aiProvider.ts";
import { randomToken, safeTechMessage, verifyCallbackSignature } from "../_lib/contentPipeline.ts";
import {
  buildAnalysisPrompt,
  estimateAnalysisCostUsd,
  IDEA_SCORE_THRESHOLD,
  ideaFromAnalysis,
  normalizeIngestItem,
  parseAnalysis,
  RADAR_ANALYSIS_SCHEMA,
  RADAR_PLATFORMS,
  transcribableVideoUrl,
  WHISPER_MAX_BYTES,
} from "../_lib/radar.ts";
import {
  APIFY_RUN_STALE_MS,
  APIFY_RUN_TIMEOUT_SEC,
  apifyCostUsd,
  apifyHttpErrorMessage,
  apifyRunFailureMessage,
  buildSourceRun,
  buildUrlRun,
  crawlUnsupportedReason,
  detectUrlPlatform,
  flattenApifyItems,
  isApifyRunFinished,
  type CrawlSourceSpec,
} from "../_lib/radarCrawl.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key, x-pipeline-timestamp, x-pipeline-nonce, x-pipeline-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
type Json = Record<string, unknown>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const admin = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const UUID = /^[0-9a-f-]{36}$/i;
const ANALYZE_PER_TICK = 8;
const WALL_CLOCK_BUDGET_MS = 45_000;
/** Сколько запусков Apify дособирать за один GET обзора. */
const SYNC_RUNS_PER_REQUEST = 6;
/** Сколько источников по расписанию запускать за тик крона. */
const CRAWL_PER_TICK = 10;
/** Фоновый разбор новых постов после обзора (сверх крона). */
const ANALYZE_ON_OVERVIEW = 2;
const APIFY_BASE = "https://api.apify.com/v2";

const hasDirectCrawler = () => Boolean(env("APIFY_TOKEN"));
const hasN8nCrawler = () => Boolean(env("N8N_RADAR_WEBHOOK_URL"));

/** Фоновая задача после ответа (Supabase Edge Runtime); ошибки — в лог. */
function background(task: Promise<unknown>): void {
  const guarded = task.catch((e) => console.error("radar background", safeTechMessage(e)));
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof rt?.waitUntil === "function") rt.waitUntil(guarded);
}

async function apify<T>(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const r = await fetch(`${APIFY_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env("APIFY_TOKEN")}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(apifyHttpErrorMessage(r.status, await r.text().catch(() => "")));
  return (await r.json()) as T;
}

/** Пинок n8n-сборщика радара; очередь по расписанию его не ждёт. */
async function kickCrawler(payload: Json): Promise<boolean> {
  const url = env("N8N_RADAR_WEBHOOK_URL");
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env("N8N_RADAR_WEBHOOK_KEY") ? { "x-pipeline-key": env("N8N_RADAR_WEBHOOK_KEY") } : {}) },
      body: JSON.stringify({ source: "markvision", ...payload }),
      signal: AbortSignal.timeout(8_000),
    });
    return r.ok;
  } catch (e) {
    console.error("radar crawler kick failed", safeTechMessage(e));
    return false;
  }
}

async function kickContentPipeline(payload: Json): Promise<void> {
  const url = env("N8N_CONTENT_PIPELINE_WEBHOOK_URL");
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(env("N8N_CONTENT_PIPELINE_WEBHOOK_KEY") ? { "x-pipeline-key": env("N8N_CONTENT_PIPELINE_WEBHOOK_KEY") } : {}) },
    body: JSON.stringify({ source: "markvision", ...payload }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {});
}

/* ───────────────────────────── ingest ───────────────────────────── */

interface IngestResult {
  received: number;
  inserted: number;
  updated: number;
  skipped: number;
  /** Все затронутые посты (новые и обновлённые). */
  ids: string[];
  /** Только новые посты — их ждёт разбор. */
  newIds: string[];
}

/** Элементы любого провайдера → radar_posts (+ пересчёт оценок). */
async function ingestItems(
  db: SupabaseClient,
  input: { projectId: string; sourceId: string | null; platformDefault: string; items: unknown[] },
): Promise<IngestResult> {
  const out: IngestResult = { received: input.items.length, inserted: 0, updated: 0, skipped: 0, ids: [], newIds: [] };
  for (const rawItem of input.items) {
    const item = normalizeIngestItem(String((rawItem as Json)?.platform ?? input.platformDefault), (rawItem ?? {}) as Json);
    if (!item) { out.skipped++; continue; }
    const { data: existing } = await db.from("radar_posts").select("id")
      .eq("project_id", input.projectId).eq("platform", item.platform).eq("external_id", item.external_id).maybeSingle();
    const row = {
      project_id: input.projectId,
      source_id: input.sourceId,
      platform: item.platform,
      external_id: item.external_id,
      url: item.url,
      author_handle: item.author_handle,
      published_at: item.published_at,
      media_type: item.media_type,
      caption: item.caption,
      video_url: item.video_url,
      thumbnail_url: item.thumbnail_url,
      metrics: item.metrics,
      followers: item.followers,
      raw: item.raw as Json,
      ...(item.transcript ? { transcript: item.transcript } : {}),
    };
    if (existing) {
      const id = (existing as { id: string }).id;
      // Источник не перетираем: пост мог прийти по ссылке, а потом из сбора аккаунта.
      const { error } = await db.from("radar_posts").update({ ...row, ...(input.sourceId ? {} : { source_id: undefined }) }).eq("id", id);
      if (error) { out.skipped++; continue; }
      out.ids.push(id);
      out.updated++;
    } else {
      const { data: ins, error } = await db.from("radar_posts").insert({ ...row, analysis_status: "pending" }).select("id").maybeSingle();
      if (error || !ins) { out.skipped++; continue; }
      out.ids.push((ins as { id: string }).id);
      out.newIds.push((ins as { id: string }).id);
      out.inserted++;
    }
  }
  for (const id of out.ids) await db.rpc("radar_recompute_post", { p_post_id: id });
  return out;
}

/** Подписанный callback n8n-сборщика. */
async function ingest(db: SupabaseClient, body: Json) {
  const projectId = String(body.project_id ?? "");
  if (!UUID.test(projectId)) return json({ error: "project_id required" }, 400);
  const sourceId = typeof body.source_id === "string" && UUID.test(body.source_id) ? body.source_id : null;
  const provider = String(body.provider ?? "n8n").slice(0, 40);
  const startedAt = new Date().toISOString();
  const items = Array.isArray(body.items) ? body.items : [];
  const r = await ingestItems(db, { projectId, sourceId, platformDefault: String(body.platform ?? "instagram"), items });
  const errorText = body.error ? String(body.error).slice(0, 500) : null;

  await db.from("radar_runs").insert({
    project_id: projectId, source_id: sourceId, provider, items: items.length, inserted: r.inserted,
    cost_usd: Number(body.cost_usd ?? 0) || 0, error: errorText,
    status: errorText ? "failed" : "done", mode: body.mode === "url" ? "url" : "crawl",
    started_at: startedAt, finished_at: new Date().toISOString(),
  });
  if (Number(body.cost_usd ?? 0) > 0) {
    await db.from("usage_ledger").insert({
      project_id: projectId, engine: provider === "scrapecreators" ? "scrapecreators" : "apify",
      ref: sourceId, cost_usd: Number(body.cost_usd), note: "radar ingest",
    });
  }
  if (sourceId) {
    await db.from("radar_sources").update({ last_crawled_at: new Date().toISOString(), last_error: errorText }).eq("id", sourceId);
  }
  return json({ ok: true, received: items.length, inserted: r.inserted, updated: r.updated, skipped: r.skipped });
}

/* ───────────────────────────── прямой сборщик (Apify) ───────────────────────────── */

interface RunTarget {
  projectId: string;
  sourceId: string | null;
  mode: "crawl" | "url";
  spec?: CrawlSourceSpec;
  url?: string;
  userId?: string | null;
}

interface KickResult {
  kicked: boolean;
  run_id?: string;
  reason?: string;
}

/**
 * Запуск сбора: сначала прямой Apify (асинхронный запуск + строка radar_runs
 * со status = running), иначе n8n-сборщик. Причина отказа — человекочитаемая.
 */
async function startRun(db: SupabaseClient, t: RunTarget): Promise<KickResult> {
  const spec = t.mode === "url" ? buildUrlRun(t.url ?? "") : buildSourceRun(t.spec!);
  const unsupported = t.mode === "url"
    ? (spec ? null : "по этой ссылке сбор не поддерживается — нужна публикация Instagram, TikTok или YouTube")
    : crawlUnsupportedReason(t.spec!);
  if (unsupported || !spec) {
    const reason = unsupported ?? "сбор не поддерживается";
    if (t.sourceId) await db.from("radar_sources").update({ last_error: reason }).eq("id", t.sourceId);
    return { kicked: false, reason };
  }
  if (!hasDirectCrawler()) {
    const payload: Json = t.mode === "url"
      ? { mode: "url", project_id: t.projectId, url: t.url, user_id: t.userId ?? null }
      : { mode: "crawl", project_id: t.projectId, sources: [{ source_id: t.sourceId, kind: t.spec!.kind, platform: t.spec!.platform, handle: t.spec!.handle }] };
    const kicked = await kickCrawler(payload);
    return kicked ? { kicked } : { kicked: false, reason: hasN8nCrawler() ? "сборщик n8n не ответил" : "сборщик не настроен: задайте секрет APIFY_TOKEN" };
  }

  // Один и тот же источник/ссылка — не запускать второй раз, пока первый работает.
  let dupQuery = db.from("radar_runs").select("id").eq("project_id", t.projectId).eq("status", "running");
  dupQuery = t.sourceId ? dupQuery.eq("source_id", t.sourceId) : dupQuery.eq("url", t.url ?? "");
  const { data: dup } = await dupQuery.limit(1).maybeSingle();
  if (dup) return { kicked: true, run_id: (dup as { id: string }).id };

  const now = new Date().toISOString();
  const base = {
    project_id: t.projectId, source_id: t.sourceId, provider: "apify", mode: t.mode,
    url: t.mode === "url" ? t.url : null, actor: spec.actor, created_by: t.userId ?? null, started_at: now,
  };
  try {
    const res = await apify<{ data: { id: string; status: string } }>(
      `/acts/${spec.actor}/runs?timeout=${APIFY_RUN_TIMEOUT_SEC}`,
      { method: "POST", body: JSON.stringify(spec.input) },
    );
    const { data: run } = await db.from("radar_runs").insert({ ...base, external_id: res.data.id, status: "running" }).select("id").maybeSingle();
    if (t.sourceId) await db.from("radar_sources").update({ last_crawled_at: now, last_error: null }).eq("id", t.sourceId);
    return { kicked: true, run_id: (run as { id: string } | null)?.id };
  } catch (e) {
    const reason = safeTechMessage(e).replace(/^Error:\s*/, "").slice(0, 500);
    await db.from("radar_runs").insert({ ...base, status: "failed", error: reason, finished_at: now });
    if (t.sourceId) await db.from("radar_sources").update({ last_crawled_at: now, last_error: reason }).eq("id", t.sourceId);
    return { kicked: false, reason };
  }
}

interface RunRow {
  id: string;
  project_id: string;
  source_id: string | null;
  mode: "crawl" | "url";
  url: string | null;
  actor: string | null;
  external_id: string | null;
  started_at: string;
}

async function failRun(db: SupabaseClient, run: RunRow, error: string): Promise<void> {
  await db.from("radar_runs").update({ status: "failed", error: error.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", run.id);
  if (run.source_id) await db.from("radar_sources").update({ last_error: error.slice(0, 500) }).eq("id", run.source_id);
}

/**
 * Дособрать завершившиеся запуски Apify: статус → элементы датасета → ingest.
 * Незавершённые оставляем; зависшие (старше APIFY_RUN_STALE_MS) закрываем ошибкой.
 */
async function syncRuns(db: SupabaseClient, opts: { projectId?: string; limit: number }): Promise<{ finished: number; newPostIds: string[] }> {
  const out = { finished: 0, newPostIds: [] as string[] };
  if (!hasDirectCrawler()) return out;
  let q = db.from("radar_runs").select("id, project_id, source_id, mode, url, actor, external_id, started_at")
    .eq("status", "running").eq("provider", "apify").order("started_at").limit(opts.limit);
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  const { data: runs } = await q;
  for (const run of (runs ?? []) as RunRow[]) {
    const stale = Date.now() - Date.parse(run.started_at) > APIFY_RUN_STALE_MS;
    if (!run.external_id) { await failRun(db, run, "нет id запуска Apify"); out.finished++; continue; }
    try {
      const { data: ar } = await apify<{ data: { status: string; statusMessage?: string | null; defaultDatasetId: string } }>(`/actor-runs/${run.external_id}`);
      if (!isApifyRunFinished(ar.status)) {
        if (stale) { await failRun(db, run, "Apify: запуск завис и закрыт по таймауту"); out.finished++; }
        continue;
      }
      if (ar.status !== "SUCCEEDED") { await failRun(db, run, apifyRunFailureMessage(ar.status, ar.statusMessage)); out.finished++; continue; }

      let platform: string | null = null;
      let handle: string | undefined;
      let kind: string | undefined;
      if (run.mode === "url") platform = detectUrlPlatform(run.url ?? "");
      else if (run.source_id) {
        const { data: src } = await db.from("radar_sources").select("platform, handle, kind").eq("id", run.source_id).maybeSingle();
        const row = src as { platform: string; handle: string; kind: string } | null;
        platform = row?.platform ?? null;
        handle = row?.handle;
        kind = row?.kind;
      }
      if (!platform) { await failRun(db, run, "источник удалён до завершения сбора"); out.finished++; continue; }

      const items = await apify<unknown[]>(`/datasets/${ar.defaultDatasetId}/items?clean=true&limit=200`, {}, 30_000);
      const flat = flattenApifyItems(platform as "instagram", Array.isArray(items) ? items : [], handle, kind);
      const r = await ingestItems(db, { projectId: run.project_id, sourceId: run.source_id, platformDefault: platform, items: flat });
      const cost = apifyCostUsd(run.actor ?? "", Array.isArray(items) ? items.length : 0);
      const empty = r.ids.length === 0;
      const emptyText = run.mode === "url" ? "публикация не найдена или закрыта" : "провайдер не вернул постов — аккаунт закрыт или ник неверный";
      await db.from("radar_runs").update({
        status: empty ? "failed" : "done", items: r.received, inserted: r.inserted, cost_usd: cost,
        error: empty ? emptyText : null, finished_at: new Date().toISOString(),
      }).eq("id", run.id);
      if (run.source_id) await db.from("radar_sources").update({ last_crawled_at: new Date().toISOString(), last_error: empty ? emptyText : null }).eq("id", run.source_id);
      if (cost > 0) {
        await db.from("usage_ledger").insert({ project_id: run.project_id, engine: "apify", ref: run.source_id ?? run.id, cost_usd: cost, note: `radar ${run.mode}` });
      }
      out.newPostIds.push(...r.newIds);
      out.finished++;
    } catch (e) {
      // Сеть/Apify моргнули — попробуем в следующий раз; совсем старые закрываем.
      if (stale) { await failRun(db, run, safeTechMessage(e).replace(/^Error:\s*/, "").slice(0, 300)); out.finished++; }
      else console.error("radar syncRuns", run.id, safeTechMessage(e));
    }
  }
  return out;
}

/* ───────────────────────────── разбор ───────────────────────────── */

interface PostRow {
  id: string;
  project_id: string;
  platform: string;
  caption: string | null;
  transcript: string | null;
  video_url: string | null;
  media_type: string | null;
  metrics: { likes?: number; comments?: number; shares?: number; saves?: number; views?: number };
  followers: number | null;
  score: number | null;
  analysis: Json | null;
  raw: Json | null;
}

async function transcribe(url: string): Promise<{ text: string; seconds: number | null } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > WHISPER_MAX_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > WHISPER_MAX_BYTES) return null;
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "video/mp4" }), "video.mp4");
    form.append("response_format", "verbose_json");
    const out = await aiTranscription(form) as { text?: string; duration?: number };
    if (!out?.text) return null;
    return { text: String(out.text).trim(), seconds: out.duration ? Number(out.duration) : null };
  } catch (e) {
    console.error("radar transcribe failed", safeTechMessage(e));
    return null;
  }
}

async function analyzePost(db: SupabaseClient, post: PostRow, context: { businessContext: string | null; niche: string | null }): Promise<{ ok: boolean; idea?: string; error?: string }> {
  await db.from("radar_posts").update({ analysis_status: "analyzing" }).eq("id", post.id);
  let transcript = post.transcript;
  let seconds: number | null = null;
  const isVideo = !post.media_type || /video|reel|clip/i.test(post.media_type);
  if (!transcript && isVideo) {
    const url = transcribableVideoUrl(post.video_url);
    if (url) {
      const t = await transcribe(url);
      if (t) { transcript = t.text; seconds = t.seconds; }
    }
  }
  const prompt = buildAnalysisPrompt({
    platform: post.platform,
    caption: post.caption,
    transcript,
    metrics: {
      likes: Number(post.metrics?.likes ?? 0), comments: Number(post.metrics?.comments ?? 0),
      shares: Number(post.metrics?.shares ?? 0), saves: Number(post.metrics?.saves ?? 0), views: Number(post.metrics?.views ?? 0),
    },
    followers: post.followers,
    businessContext: context.businessContext,
    ownNiche: context.niche,
  });
  let analysis = null;
  let rawContent = "";
  try {
    const completion = await aiChatCompletion({
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      responseFormat: { type: "json_object" },
      temperature: 0.4,
      openAiModel: "gpt-4o-mini",
      timeoutMs: 60_000,
    }) as { choices?: { message?: { content?: string } }[] };
    rawContent = String(completion?.choices?.[0]?.message?.content ?? "");
    analysis = parseAnalysis(rawContent);
  } catch (e) {
    const message = safeTechMessage(e);
    await db.from("radar_posts").update({ analysis_status: "failed", error: message.slice(0, 500) }).eq("id", post.id);
    return { ok: false, error: message };
  }
  if (!analysis) {
    const preview = rawContent.replace(/\s+/g, " ").trim().slice(0, 300);
    await db.from("radar_posts").update({
      analysis_status: "failed",
      error: preview ? `модель вернула невалидный JSON: ${preview}` : "модель вернула пустой ответ",
    }).eq("id", post.id);
    return { ok: false, error: "invalid analysis" };
  }
  const cost = estimateAnalysisCostUsd(seconds, prompt.system.length + prompt.user.length);
  await db.from("radar_posts").update({
    transcript: transcript ?? null,
    analysis: { ...analysis, schema: RADAR_ANALYSIS_SCHEMA.name, model: "gpt-4o-mini", cost_usd: cost },
    analysis_status: "done",
    analyzed_at: new Date().toISOString(),
    error: null,
  }).eq("id", post.id);
  await db.rpc("radar_recompute_post", { p_post_id: post.id });
  if (cost > 0) {
    await db.from("usage_ledger").insert({ project_id: post.project_id, engine: "llm", ref: post.id, cost_usd: cost, note: "radar analyze" });
  }

  const { data: fresh } = await db.from("radar_posts").select("score").eq("id", post.id).maybeSingle();
  // Без сигналов аудитории (объявления из Ad Library, посты без метрик) оценка — только модель.
  const m = post.metrics ?? {};
  const noSignals = !Number(m.likes) && !Number(m.comments) && !Number(m.shares) && !Number(m.saves) && !Number(m.views);
  const postScore = noSignals ? analysis.score : Number((fresh as { score?: number } | null)?.score ?? analysis.score);
  if (postScore < IDEA_SCORE_THRESHOLD) return { ok: true };
  const { data: existingIdea } = await db.from("idea_bank").select("id")
    .eq("project_id", post.project_id).contains("source_post_ids", [post.id]).limit(1).maybeSingle();
  if (existingIdea) return { ok: true, idea: (existingIdea as { id: string }).id };
  const { data: idea } = await db.from("idea_bank")
    .insert({ project_id: post.project_id, ...ideaFromAnalysis(post.id, analysis, postScore) })
    .select("id").maybeSingle();
  return { ok: true, idea: (idea as { id: string } | null)?.id };
}

async function projectContext(db: SupabaseClient, projectId: string): Promise<{ businessContext: string | null; niche: string | null }> {
  const { data } = await db.from("content_pipeline_settings").select("business_context").eq("project_id", projectId).maybeSingle();
  const { data: p } = await db.from("personas").select("niche").eq("project_id", projectId).not("niche", "is", null).limit(1).maybeSingle();
  return {
    businessContext: (data as { business_context?: string | null } | null)?.business_context ?? null,
    niche: (p as { niche?: string | null } | null)?.niche ?? null,
  };
}

/** Разобрать до `limit` постов проекта в очереди (сверх крона — чтобы ссылка разбиралась сразу). */
async function analyzePending(db: SupabaseClient, projectId: string, limit: number): Promise<number> {
  if (!hasAiProvider() || limit <= 0) return 0;
  const { data: budgetOk } = await db.rpc("project_budget_ok", { p_project_id: projectId });
  if (budgetOk === false) return 0;
  const { data: pending } = await db.from("radar_posts")
    .select("id, project_id, platform, caption, transcript, video_url, media_type, metrics, followers, score, analysis, raw")
    .eq("project_id", projectId).eq("analysis_status", "pending")
    .order("created_at", { ascending: false }).limit(limit);
  if (!pending?.length) return 0;
  const ctx = await projectContext(db, projectId);
  let done = 0;
  for (const post of pending as PostRow[]) {
    const r = await analyzePost(db, post, ctx);
    if (r.ok) done++;
  }
  return done;
}

/* ───────────────────────────── обслуживание ───────────────────────────── */

async function maintenance(db: SupabaseClient) {
  const out: Json = {
    analyzed: 0, failed: 0, ideas: 0, crawl_kicked: 0, runs_finished: 0,
    ai: hasAiProvider(), crawler: hasDirectCrawler() ? "apify" : hasN8nCrawler() ? "n8n" : null,
  };
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;

  // Завершившиеся запуски Apify → посты (до разбора, чтобы новые попали в очередь).
  out.runs_finished = (await syncRuns(db, { limit: 20 })).finished;

  if (hasAiProvider()) {
    const { data: pending } = await db.from("radar_posts")
      .select("id, project_id, platform, caption, transcript, video_url, media_type, metrics, followers, score, analysis, raw")
      .in("analysis_status", ["pending", "failed"])
      .order("created_at", { ascending: true })
      .limit(ANALYZE_PER_TICK);
    const ctxCache = new Map<string, { businessContext: string | null; niche: string | null }>();
    for (const post of (pending ?? []) as PostRow[]) {
      if (Date.now() > deadline) break;
      const { data: budgetOk } = await db.rpc("project_budget_ok", { p_project_id: post.project_id });
      if (budgetOk === false) {
        await db.from("radar_posts").update({ analysis_status: "skipped", error: "бюджет проекта исчерпан" }).eq("id", post.id);
        continue;
      }
      let ctx = ctxCache.get(post.project_id);
      if (!ctx) { ctx = await projectContext(db, post.project_id); ctxCache.set(post.project_id, ctx); }
      const r = await analyzePost(db, post, ctx);
      if (r.ok) { out.analyzed = Number(out.analyzed) + 1; if (r.idea) out.ideas = Number(out.ideas) + 1; }
      else out.failed = Number(out.failed) + 1;
    }
  }

  // Источники по расписанию: прямой Apify — по одному; n8n — одним пакетом на проект.
  const { data: due } = await db.rpc("radar_due_sources", { p_limit: hasDirectCrawler() ? CRAWL_PER_TICK : 50 });
  const dueList = (due ?? []) as { id: string; project_id: string; kind: string; platform: string; handle: string }[];
  const budgetCache = new Map<string, boolean>();
  const budgetOkFor = async (projectId: string) => {
    if (!budgetCache.has(projectId)) {
      const { data } = await db.rpc("project_budget_ok", { p_project_id: projectId });
      budgetCache.set(projectId, data !== false);
    }
    return budgetCache.get(projectId)!;
  };
  if (hasDirectCrawler()) {
    for (const s of dueList) {
      if (Date.now() > deadline) break;
      if (!(await budgetOkFor(s.project_id))) continue;
      const r = await startRun(db, { projectId: s.project_id, sourceId: s.id, mode: "crawl", spec: { kind: s.kind, platform: s.platform, handle: s.handle } });
      if (r.kicked) out.crawl_kicked = Number(out.crawl_kicked) + 1;
    }
  } else {
    const byProject = new Map<string, Json[]>();
    for (const s of dueList) {
      const list = byProject.get(s.project_id) ?? [];
      list.push({ source_id: s.id, kind: s.kind, platform: s.platform, handle: s.handle });
      byProject.set(s.project_id, list);
    }
    for (const [projectId, sources] of byProject) {
      if (!(await budgetOkFor(projectId))) continue;
      if (await kickCrawler({ mode: "crawl", project_id: projectId, sources })) out.crawl_kicked = Number(out.crawl_kicked) + sources.length;
    }
  }
  await db.rpc("radar_gc");
  return out;
}

/* ───────────────────────────── пользовательский API ───────────────────────────── */

async function handleUser(req: Request, segments: string[], url: URL): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const userDb = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth.authHeader } } });
  const db = admin();
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Json) : {};

  async function projectOk(projectId: string | null): Promise<boolean> {
    if (!projectId || !UUID.test(projectId)) return false;
    const { data } = await userDb.from("projects").select("id").eq("id", projectId).maybeSingle();
    return Boolean(data);
  }

  // GET /radar?project_id
  if (segments.length === 0 && req.method === "GET") {
    const projectId = url.searchParams.get("project_id");
    if (!(await projectOk(projectId))) return json({ error: "Нет доступа к проекту" }, 403);
    // Завершившиеся запуски Apify подтягиваем прямо здесь — так «Обновить» и
    // опрос страницы показывают посты, не дожидаясь крона.
    const synced = await syncRuns(db, { projectId: projectId!, limit: SYNC_RUNS_PER_REQUEST });
    const [{ data: sources }, { data: metrics }, { data: ideas }, { data: posts }, { data: groups }, { data: runs }] = await Promise.all([
      db.from("radar_sources").select("*").eq("project_id", projectId!).order("created_at"),
      db.from("radar_metrics").select("*").eq("project_id", projectId!).maybeSingle(),
      db.from("idea_bank").select("*").eq("project_id", projectId!).order("score", { ascending: false }).limit(200),
      db.from("radar_posts")
        .select("id, source_id, platform, external_id, url, author_handle, published_at, media_type, caption, thumbnail_url, metrics, followers, engagement_rate, velocity, score, analysis, analysis_status, analyzed_at, error")
        .eq("project_id", projectId!).order("score", { ascending: false, nullsFirst: false }).limit(100),
      db.from("publish_account_groups").select("id, name, persona_id, review_mode").eq("project_id", projectId!).order("name"),
      db.from("radar_runs").select("*").eq("project_id", projectId!).order("started_at", { ascending: false }).limit(20),
    ]);
    const hasPending = synced.newPostIds.length > 0 || (posts ?? []).some((p) => (p as { analysis_status: string }).analysis_status === "pending");
    if (hasPending) background(analyzePending(db, projectId!, ANALYZE_ON_OVERVIEW));
    return json({
      ok: true, sources: sources ?? [], metrics: metrics ?? null, ideas: ideas ?? [], posts: posts ?? [], groups: groups ?? [], runs: runs ?? [],
      crawler: { direct: hasDirectCrawler(), n8n: hasN8nCrawler(), ai: hasAiProvider() },
    });
  }
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  if (segments[0] === "sources") {
    if (segments.length === 1) {
      const projectId = String(body.project_id ?? "");
      if (!(await projectOk(projectId))) return json({ error: "Нет доступа к проекту" }, 403);
      const kind = String(body.kind ?? "competitor_account");
      const platform = String(body.platform ?? "instagram");
      const handle = String(body.handle ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram|tiktok|threads)\.[a-z.]+\//i, "").replace(/\/+$/, "");
      if (!["competitor_account", "hashtag", "ad_library_query", "own_account"].includes(kind)) return json({ error: "kind" }, 400);
      if (!(RADAR_PLATFORMS as readonly string[]).includes(platform)) return json({ error: "platform" }, 400);
      if (!handle) return json({ error: "handle обязателен" }, 400);
      const row: Json = {
        project_id: projectId, kind, platform, handle,
        label: body.label ? String(body.label) : null,
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
        crawl_interval_hours: Math.min(Math.max(Number(body.crawl_interval_hours ?? 24), 1), 168),
        created_by: auth.userId,
      };
      if (typeof body.id === "string") row.id = body.id;
      const { data, error } = await db.from("radar_sources").upsert(row, { onConflict: "project_id,platform,kind,handle" }).select("*").maybeSingle();
      if (error) return json({ error: error.message }, 400);
      if (body.crawl_now === false || !row.enabled) return json({ ok: true, source: data, kicked: false, kick_error: null });
      const { data: budgetOk } = await db.rpc("project_budget_ok", { p_project_id: projectId });
      if (budgetOk === false) return json({ ok: true, source: data, kicked: false, kick_error: "бюджет проекта исчерпан" });
      const kick = await startRun(db, {
        projectId, sourceId: (data as { id: string }).id, mode: "crawl", spec: { kind, platform, handle }, userId: auth.userId,
      });
      const { data: fresh } = await db.from("radar_sources").select("*").eq("id", (data as { id: string }).id).maybeSingle();
      return json({ ok: true, source: fresh ?? data, kicked: kick.kicked, kick_error: kick.kicked ? null : kick.reason ?? null, run_id: kick.run_id ?? null });
    }
    const id = segments[1];
    if (!UUID.test(id)) return json({ error: "id" }, 400);
    const { data: src } = await db.from("radar_sources").select("id, project_id, kind, platform, handle").eq("id", id).maybeSingle();
    const s = src as { id: string; project_id: string; kind: string; platform: string; handle: string } | null;
    if (!s || !(await projectOk(s.project_id))) return json({ error: "Источник не найден" }, 404);
    if (segments[2] === "delete") {
      await db.from("radar_sources").delete().eq("id", id);
      return json({ ok: true });
    }
    if (segments[2] === "crawl") {
      const { data: budgetOk } = await db.rpc("project_budget_ok", { p_project_id: s.project_id });
      if (budgetOk === false) return json({ error: "Бюджет проекта исчерпан — сбор не запущен" }, 402);
      const kick = await startRun(db, {
        projectId: s.project_id, sourceId: s.id, mode: "crawl", spec: { kind: s.kind, platform: s.platform, handle: s.handle }, userId: auth.userId,
      });
      if (!kick.kicked) return json({ error: `Сбор не запущен: ${kick.reason ?? "неизвестная причина"}` }, 400);
      return json({ ok: true, kicked: true, run_id: kick.run_id ?? null });
    }
    return json({ error: "Неизвестное действие" }, 404);
  }

  if (segments[0] === "analyze-url") {
    const projectId = String(body.project_id ?? "");
    if (!(await projectOk(projectId))) return json({ error: "Нет доступа к проекту" }, 403);
    const link = String(body.url ?? "").trim();
    if (!/^https:\/\/(www\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|threads\.(net|com)|facebook\.com|fb\.watch)\//i.test(link)) {
      return json({ error: "Ссылка на публикацию Instagram / TikTok / YouTube / Threads / Facebook" }, 400);
    }
    const { data: budgetOk } = await db.rpc("project_budget_ok", { p_project_id: projectId });
    if (budgetOk === false) return json({ error: "Бюджет проекта исчерпан — разбор не запущен" }, 402);
    const kick = await startRun(db, { projectId, sourceId: null, mode: "url", url: link, userId: auth.userId });
    if (!kick.kicked) return json({ error: `Разбор не запущен: ${kick.reason ?? "сборщик недоступен"}` }, 400);
    return json({ ok: true, kicked: true, run_id: kick.run_id ?? null, message: "Разбор запущен: пост появится в ленте через 1–2 минуты, затем — разбор и идея" });
  }

  if (segments[0] === "posts" && UUID.test(segments[1] ?? "") && segments[2] === "analyze") {
    const { data: post } = await db.from("radar_posts")
      .select("id, project_id, platform, caption, transcript, video_url, media_type, metrics, followers, score, analysis, raw").eq("id", segments[1]).maybeSingle();
    const p = post as PostRow | null;
    if (!p || !(await projectOk(p.project_id))) return json({ error: "Пост не найден" }, 404);
    if (!hasAiProvider()) return json({ error: "AI-провайдер не настроен" }, 503);
    const r = await analyzePost(db, p, await projectContext(db, p.project_id));
    return json({ ok: r.ok, idea_id: r.idea ?? null, error: r.error ?? null });
  }

  if (segments[0] === "ideas" && UUID.test(segments[1] ?? "")) {
    const { data: idea } = await db.from("idea_bank").select("id, project_id, status, content_item_id").eq("id", segments[1]).maybeSingle();
    const i = idea as { id: string; project_id: string; status: string; content_item_id: string | null } | null;
    if (!i || !(await projectOk(i.project_id))) return json({ error: "Идея не найдена" }, 404);
    if (segments[2] === "promote") {
      const groupId = typeof body.group_id === "string" && UUID.test(body.group_id) ? body.group_id : null;
      const personaId = typeof body.persona_id === "string" && UUID.test(body.persona_id) ? body.persona_id : null;
      const engine = typeof body.engine === "string" && ["heygen", "reels_faceless", "montage"].includes(body.engine) ? body.engine : null;
      const { data: itemId, error } = await db.rpc("radar_promote_idea", { p_idea_id: i.id, p_group_id: groupId, p_persona_id: personaId, p_engine: engine });
      if (error) return json({ error: error.message }, 400);
      await kickContentPipeline({ reason: "radar_promote", project_id: i.project_id, item_id: itemId, user_id: auth.userId });
      return json({ ok: true, item_id: itemId });
    }
    const patch: Json = {};
    if (typeof body.status === "string" && ["new", "approved", "rejected"].includes(body.status)) patch.status = body.status;
    for (const k of ["title", "hook", "angle", "niche", "script_draft"]) if (typeof body[k] === "string") patch[k] = body[k];
    if (body.target_group_id === null || (typeof body.target_group_id === "string" && UUID.test(body.target_group_id))) patch.target_group_id = body.target_group_id;
    if (!Object.keys(patch).length) return json({ error: "нечего менять" }, 400);
    const { data, error } = await db.from("idea_bank").update(patch).eq("id", i.id).select("*").maybeSingle();
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, idea: data });
  }

  return json({ error: "not found" }, 404);
}

/* ───────────────────────────── маршрутизация ───────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("radar");
  const segments = idx >= 0 ? parts.slice(idx + 1) : parts;

  try {
    if (segments[0] === "internal" && segments[1] === "ingest" && req.method === "POST") {
      const raw = await req.text();
      const secret = env("RADAR_CALLBACK_SECRET") || env("CONTENT_PIPELINE_CALLBACK_SECRET");
      const v = await verifyCallbackSignature({
        secret,
        timestamp: req.headers.get("x-pipeline-timestamp"),
        nonce: req.headers.get("x-pipeline-nonce"),
        signature: req.headers.get("x-pipeline-signature"),
        body: raw,
      });
      if (!v.ok) return json({ error: `unauthorized: ${v.reason}` }, 401);
      const db = admin();
      const { error: nonceErr } = await db.from("pipeline_callback_nonces").insert({ nonce: `radar:${req.headers.get("x-pipeline-nonce")}` });
      if (nonceErr) return json({ error: "replay" }, 409);
      let body: Json;
      try { body = JSON.parse(raw) as Json; } catch { return json({ error: "invalid json" }, 400); }
      return await ingest(db, body);
    }
    if (segments[0] === "maintenance" && req.method === "POST") {
      const db = admin();
      if (!(await automationKeyValid(req, db))) {
        const auth = await requireUser(req);
        if (!auth.ok) return json({ error: "unauthorized" }, 401);
        if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) return json({ error: "forbidden" }, 403);
      }
      return json({ ok: true, ...(await maintenance(db)), run_id: randomToken(6) });
    }
    return await handleUser(req, segments, url);
  } catch (e) {
    console.error("radar unhandled", safeTechMessage(e));
    return json({ error: "internal error" }, 500);
  }
});
