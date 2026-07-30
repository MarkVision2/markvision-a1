#!/usr/bin/env node
/**
 * CLI-помощник очереди «Вертикальные креативы» (video-creative-system).
 * Заявки vcs_jobs создаёт сайт (Контент-завод → Видео → «Вертикальные креативы»:
 * сценарий + профиль + голос + опции). Очередь разбирает Claude-сессия в репо
 * video-creative-system по его скиллам/пайплайну; этот помощник ходит в
 * edge-функцию vcs-worker (auth: заголовок x-montage-key = MONTAGE_WORKER_KEY из .env).
 *
 * Маршрут обработки одной заявки:
 *   next → взять заявку (script + config) → пайплайн video-creative-system
 *   (озвучка ElevenLabs → тайминги → раскадровка → рендер 1080×1920) →
 *   status по ходу → complete с готовым mp4 (заливка в bucket renders,
 *   публикация в heygen_usage → «AI монтаж → Готовые», Telegram проекта).
 *
 * Команды (из корня репозитория markvision):
 *   node scripts/vcs-worker.mjs next
 *       Забрать старейшую заявку (печатает JSON: id, project_id, script, config…).
 *   node scripts/vcs-worker.mjs status <jobId> "текст прогресса" [--stage rendering]
 *       Обновить прогресс/статус заявки.
 *   node scripts/vcs-worker.mjs complete <jobId> --video <path.mp4> \
 *       [--title "…"] [--thumb <path.jpg>] [--description "…"] [--review-url <url>] [--no-telegram]
 *       Залить рендер, опубликовать в «Готовые», закрыть заявку (status=done).
 *   node scripts/vcs-worker.mjs fail <jobId> --error "причина"
 *   node scripts/vcs-worker.mjs requeue <jobId>
 *   node scripts/vcs-worker.mjs publish --project <projectId> --video <path.mp4> [--title …] [--no-telegram]
 *       Публикация без заявки (ручной прогон из чата).
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { basename, extname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...loadEnv(resolve(".env")), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.VITE_CLIENT_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY;
const WORKER_KEY = env.MONTAGE_WORKER_KEY;
if (!SUPABASE_URL || !ANON_KEY || !WORKER_KEY) {
  console.error("Нужны VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY и MONTAGE_WORKER_KEY в .env");
  process.exit(1);
}
const FN = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/vcs-worker`;

async function call(body) {
  const r = await fetch(FN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-montage-key": WORKER_KEY,
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `vcs-worker HTTP ${r.status}`);
  return j;
}

async function uploadRender(localPath, remoteName) {
  const path = `vcs/${Date.now()}-${remoteName.replace(/[^\w.\-]+/g, "_")}`;
  const { token, publicUrl } = await call({ action: "sign_upload", path });
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await sb.storage.from("renders").uploadToSignedUrl(path, token, readFileSync(localPath), {
    contentType: /\.jpe?g$/.test(localPath) ? "image/jpeg" : "video/mp4",
  });
  if (error) throw new Error(`upload ${localPath}: ${error.message}`);
  return publicUrl;
}

function probeDurationSec(path) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], { encoding: "utf8" });
    const sec = Math.round(parseFloat(out.trim()));
    return Number.isFinite(sec) && sec > 0 ? sec : null;
  } catch { return null; }
}

function argVal(name) { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; }
const hasFlag = (name) => process.argv.includes(`--${name}`);

const cmd = process.argv[2];
const jobId = process.argv[3];

try {
  if (cmd === "next") {
    const { job } = await call({ action: "next" });
    console.log(job ? JSON.stringify(job, null, 2) : "Очередь пуста");
  } else if (cmd === "status") {
    const progress = process.argv[4];
    if (!jobId || !progress) throw new Error('usage: status <jobId> "текст" [--stage rendering]');
    await call({ action: "update", id: jobId, progress, status: argVal("stage") });
    console.log(`OK status ${jobId}: ${progress}`);
  } else if (cmd === "complete") {
    const video = argVal("video");
    if (!jobId || !video || !existsSync(video)) throw new Error("usage: complete <jobId> --video <path.mp4> [--title …] [--thumb …] [--description …] [--review-url …] [--no-telegram]");
    const videoUrl = await uploadRender(video, basename(video));
    const thumb = argVal("thumb");
    const thumbnailUrl = thumb && existsSync(thumb) ? await uploadRender(thumb, basename(thumb)) : undefined;
    const res = await call({
      action: "complete",
      id: jobId,
      video_url: videoUrl,
      title: argVal("title") ?? basename(video, extname(video)),
      thumbnail_url: thumbnailUrl,
      description: argVal("description"),
      review_url: argVal("review-url"),
      duration_sec: probeDurationSec(video),
    });
    console.log(`OK complete ${jobId}: ${videoUrl}`);
    if (res.warnings?.length) console.log("warnings:", res.warnings.join("; "));
  } else if (cmd === "fail") {
    if (!jobId) throw new Error('usage: fail <jobId> --error "причина"');
    await call({ action: "fail", id: jobId, error: argVal("error") ?? "рендер не удался" });
    console.log(`OK fail ${jobId}`);
  } else if (cmd === "requeue") {
    if (!jobId) throw new Error("usage: requeue <jobId>");
    const res = await call({ action: "requeue", id: jobId });
    console.log(`OK requeue ${jobId} (было: ${res.previous_status})`);
  } else if (cmd === "publish") {
    const projectId = argVal("project");
    const video = argVal("video");
    if (!projectId || !video || !existsSync(video)) throw new Error("usage: publish --project <projectId> --video <path.mp4> [--title …] [--no-telegram]");
    const videoUrl = await uploadRender(video, basename(video));
    const res = await call({
      action: "publish",
      project_id: projectId,
      video_url: videoUrl,
      title: argVal("title") ?? basename(video, extname(video)),
      description: argVal("description"),
      duration_sec: probeDurationSec(video),
      notify_telegram: !hasFlag("no-telegram"),
    });
    console.log(`OK publish ${projectId}: ${videoUrl}`);
    if (res.warnings?.length) console.log("warnings:", res.warnings.join("; "));
  } else {
    console.error("Команды: next | status | complete | fail | requeue | publish (см. шапку файла)");
    process.exit(1);
  }
} catch (e) {
  console.error("Ошибка:", e.message);
  process.exit(1);
}
