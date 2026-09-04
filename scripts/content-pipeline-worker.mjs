#!/usr/bin/env node
/**
 * Воркер контент-конвейера для тем с движком reels_faceless (VPS / локально).
 *
 * n8n v5 рендерит только HeyGen. Темы с engine = reels_faceless забирает этот
 * воркер тем же подписанным callback-протоколом (docs/CONTENT-PIPELINE.md):
 *   claim(engine=reels_faceless) → сценарий OpenAI по промпту из claim →
 *   callback script → заявка в reels_jobs (сценарий + голос/тема персоны) →
 *   callback video_requested(provider=reels, job id) → ждём reels_jobs.video_url
 *   (рендер делает Reels-очередь: docs/REELS-PIPELINE.md) → callback video_status
 *   completed → callback asset(normalized_video: рендер Remotion уже 1080×1920
 *   H.264/AAC) → ролик уходит на согласование.
 *
 *   node scripts/content-pipeline-worker.mjs once       # один claim и выход
 *   node scripts/content-pipeline-worker.mjs            # цикл: claim каждые 60 с, опрос заявок каждые 30 с
 *
 * .env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (вставка reels_jobs — как у
 * серверных скриптов), CONTENT_PIPELINE_CALLBACK_SECRET (тот же, что у edge-функции),
 * OPENAI_API_KEY. Опционально WORKER_ID, REELS_DEFAULT_VOICE.
 */
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...loadEnv(resolve(ROOT, ".env")), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = env.CONTENT_PIPELINE_CALLBACK_SECRET;
const OPENAI_KEY = env.OPENAI_API_KEY;
const WORKER_ID = env.WORKER_ID || `reels-worker-${process.pid}`;
if (!SUPABASE_URL || !SERVICE_KEY || !SECRET || !OPENAI_KEY) {
  console.error("Нужны VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONTENT_PIPELINE_CALLBACK_SECRET, OPENAI_API_KEY в .env");
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const CALLBACK = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/content-pipeline/internal/callback`;
const log = (msg, extra = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }));

/** Подписанный вызов callback: HMAC-SHA256(timestamp.nonce.body). */
export async function callback(payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", SECRET).update(`${timestamp}.${nonce}.${body}`).digest("hex");
  const r = await fetch(CALLBACK, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pipeline-timestamp": timestamp, "x-pipeline-nonce": nonce, "x-pipeline-signature": signature },
    body,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`callback ${payload.event}: HTTP ${r.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function openAiScript(job) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: job.settings.openai_model || "gpt-4o-mini",
      temperature: 0.7,
      response_format: { type: "json_schema", json_schema: job.script_schema },
      messages: [
        { role: "system", content: job.script_prompt.system },
        { role: "user", content: job.script_prompt.user },
      ],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const kind = r.status === 429 ? "rate_limited" : r.status >= 500 ? "server" : r.status === 401 ? "auth" : "validation";
    throw Object.assign(new Error(`OpenAI HTTP ${r.status}`), { kind, retryAfter: r.headers.get("retry-after") });
  }
  return { raw: body.choices?.[0]?.message?.content ?? "", model: body.model, usage: body.usage ?? null };
}

/** Сценарий с не более чем одним повтором при невалидном JSON (ТЗ 7.3). */
async function ensureScript(job) {
  if (job.script) return job.script;
  await callback({ event: "state", run_id: job.run_id, state: "script_generating" });
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await openAiScript(job);
    const res = await callback({ event: "script", run_id: job.run_id, script_raw: out.raw, model: out.model, usage: out.usage, prompt_version: job.script_prompt.prompt_version });
    if (res.valid) return res.script;
    log("script invalid", { run_id: job.run_id, errors: res.errors, attempt });
  }
  await callback({ event: "fail", run_id: job.run_id, error_code: "script_invalid", kind: "validation", node: "content-pipeline-worker", error_message: "сценарий не прошёл валидацию дважды" });
  return null;
}

/** Заявка в очередь Reels: сценарий + голос/тема персоны. */
async function ensureReelsJob(job, script) {
  if (job.provider_job_id) return job.provider_job_id;
  const voice = job.persona?.eleven_voice_id || env.REELS_DEFAULT_VOICE || null;
  const { data, error } = await sb.from("reels_jobs").insert({
    project_id: job.project_id,
    session_id: `cp-${job.run_id}`,
    source: "content_pipeline",
    status: "queued",
    script: script.script,
    config: {
      title: script.title,
      description: script.description,
      hashtags: script.hashtags,
      elevenVoice: voice,
      theme: job.persona?.reels_theme || null,
      format: "9:16",
      brollMode: "auto",
      content_item_id: job.item_id,
      pipeline_run_id: job.run_id,
    },
  }).select("id").single();
  if (error) throw Object.assign(new Error(`reels_jobs insert: ${error.message}`), { kind: "server" });
  await callback({ event: "video_requested", run_id: job.run_id, provider: "reels", provider_job_id: data.id });
  return data.id;
}

/** Опрос заявки Reels → video_status. Возвращает true, когда запуск закрыт. */
async function pollReels(runId, reelsJobId) {
  const { data: rj } = await sb.from("reels_jobs").select("status, video_url, duration_sec, error").eq("id", reelsJobId).maybeSingle();
  if (!rj) {
    await callback({ event: "fail", run_id: runId, error_code: "video_provider", kind: "provider_failed", node: "reels_jobs", error_message: "заявка reels_jobs пропала" });
    return true;
  }
  if (rj.status === "done" && rj.video_url) {
    const st = await callback({ event: "video_status", run_id: runId, status: "completed", video_url: rj.video_url, duration_seconds: rj.duration_sec ?? null });
    if (st.state === "video_ready" || st.already) {
      // Рендер Remotion уже в целевом формате — отдаём как нормализованный файл.
      await callback({ event: "state", run_id: runId, state: "normalizing", metadata: { worker: WORKER_ID, normalized_by: "remotion" } });
      await callback({
        event: "asset", run_id: runId, asset_type: "normalized_video", storage_path: rj.video_url, public_url: rj.video_url,
        mime_type: "video/mp4", width: 1080, height: 1920, duration_seconds: rj.duration_sec ?? null, video_codec: "h264", audio_codec: "aac",
      });
    }
    return true;
  }
  if (rj.status === "failed" || rj.status === "error") {
    const res = await callback({ event: "video_status", run_id: runId, status: "failed", error: rj.error ?? "reels job failed" });
    return res.final !== false;
  }
  const res = await callback({ event: "video_status", run_id: runId, status: rj.status || "processing" });
  return !res.poll_again;
}

async function processOne() {
  const claim = await callback({ event: "claim", worker_id: WORKER_ID, engine: "reels_faceless" });
  if (!claim.job) return false;
  const job = claim.job;
  log("claimed", { run_id: job.run_id, item: job.item_id, resumed: job.resumed, attempt: job.attempt });
  try {
    const script = await ensureScript(job);
    if (!script) return true;
    const reelsJobId = await ensureReelsJob(job, script);
    active.set(job.run_id, reelsJobId);
  } catch (e) {
    log("job failed", { run_id: job.run_id, error: String(e.message) });
    await callback({
      event: "fail", run_id: job.run_id, error_code: e.kind === "auth" ? "auth" : "script_provider",
      kind: e.kind || "unknown", retry_after: e.retryAfter ?? null, node: "content-pipeline-worker", error_message: String(e.message).slice(0, 400),
    }).catch(() => {});
  }
  return true;
}

const active = new Map();

async function heartbeatAll() {
  for (const [runId, reelsJobId] of active) {
    try {
      const done = await pollReels(runId, reelsJobId);
      if (done) active.delete(runId);
    } catch (e) {
      log("poll failed", { run_id: runId, error: String(e.message) });
    }
  }
}

const cmd = process.argv[2] || "loop";
if (cmd === "once") {
  const had = await processOne();
  log(had ? "one job taken" : "queue empty");
  process.exit(0);
}
log("worker started", { worker: WORKER_ID, engine: "reels_faceless" });
for (;;) {
  try {
    await processOne();
    await heartbeatAll();
  } catch (e) {
    log("loop error", { error: String(e.message) });
  }
  await new Promise((r) => setTimeout(r, active.size ? 30_000 : 60_000));
}
