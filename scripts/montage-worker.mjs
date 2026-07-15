#!/usr/bin/env node
/**
 * CLI Claude-воркера монтаж-конвейера. Разбирает очередь заявок montage_jobs,
 * созданных на сайте (Контент-завод → «Монтаж съёмки»), через edge-функцию
 * montage-worker (auth: заголовок x-montage-key = MONTAGE_WORKER_KEY из .env).
 *
 * Команды (из корня репозитория):
 *   node scripts/montage-worker.mjs next
 *       Забрать старейшую заявку (queued → processing). Печатает JSON заявки
 *       и скачивает исходник в work/<jobId>/source_raw.<ext>.
 *   node scripts/montage-worker.mjs status <jobId> "<текст прогресса>" [--state rendering]
 *       Обновить видимый в приложении прогресс («транскрибируем», «рендер»…).
 *   node scripts/montage-worker.mjs complete <jobId> --video out/main169.mp4 \
 *       [--title "…"] [--thumb path.jpg] [--description "…"] [--short out/s1.mp4 --short out/s2.mp4]
 *       Залить рендер(ы) в bucket `renders`, записать в «Готовые» (heygen_usage),
 *       закрыть заявку и отправить видео в Telegram проекта (если включено).
 *   node scripts/montage-worker.mjs fail <jobId> "<причина>"
 *
 * Весь монтаж между next и complete делает Claude по скиллу montage-pipeline.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, extname, resolve } from "node:path";

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
const FN = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/montage-worker`;

async function call(body) {
  const r = await fetch(FN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-montage-key": WORKER_KEY,
      // Шлюз Supabase требует apikey даже при verify_jwt=false.
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `montage-worker HTTP ${r.status}`);
  return j;
}

function probeDurationSec(path) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { encoding: "utf8" },
    );
    const sec = Math.round(parseFloat(out.trim()));
    return Number.isFinite(sec) && sec > 0 ? sec : null;
  } catch {
    return null;
  }
}

// Заливка файла в bucket `renders` через signed upload URL (выдаёт функция).
async function uploadRender(localPath, remoteName) {
  const path = `montage/${Date.now()}-${remoteName.replace(/[^\w.\-]+/g, "_")}`;
  const { token, publicUrl } = await call({ action: "sign_upload", path });
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await sb.storage.from("renders").uploadToSignedUrl(path, token, readFileSync(localPath), {
    contentType: localPath.endsWith(".jpg") || localPath.endsWith(".jpeg") ? "image/jpeg" : "video/mp4",
  });
  if (error) throw new Error(`upload ${localPath}: ${error.message}`);
  return publicUrl;
}

function argVal(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function argAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

const cmd = process.argv[2];

if (cmd === "next") {
  const { job } = await call({ action: "next" });
  if (!job) {
    console.log("Очередь пуста.");
    process.exit(0);
  }
  const dir = resolve("work", job.id);
  mkdirSync(dir, { recursive: true });
  const ext = (extname(new URL(job.source_url).pathname) || ".mp4").toLowerCase();
  const dst = resolve(dir, `source_raw${ext}`);
  const res = await fetch(job.source_url);
  if (!res.ok || !res.body) throw new Error(`не скачался исходник: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dst));
  console.log(JSON.stringify(job, null, 2));
  console.log(`\nИсходник: ${dst}`);
  console.log(`Дальше: монтаж по скиллу montage-pipeline (work/${job.id}), статус — montage-worker.mjs status ${job.id} "…"`);
} else if (cmd === "status") {
  const [, , , id, progress] = process.argv;
  if (!id || !progress) {
    console.error('Нужно: status <jobId> "<текст прогресса>" [--state rendering]');
    process.exit(1);
  }
  const state = argVal("state");
  await call({ action: "update", id, progress, ...(state ? { status: state } : {}) });
  console.log("ok");
} else if (cmd === "complete") {
  const id = process.argv[3];
  const video = argVal("video");
  if (!id || !video || !existsSync(video)) {
    console.error("Нужно: complete <jobId> --video <path.mp4> [--title …] [--thumb …] [--description …] [--short path …]");
    process.exit(1);
  }
  console.log("Заливаем финальный рендер…");
  const videoUrl = await uploadRender(video, basename(video));
  const thumb = argVal("thumb");
  const thumbnailUrl = thumb && existsSync(thumb) ? await uploadRender(thumb, basename(thumb)) : undefined;
  const shorts = [];
  for (const s of argAll("short")) {
    if (!existsSync(s)) throw new Error(`шортс не найден: ${s}`);
    console.log(`Заливаем шортс ${basename(s)}…`);
    shorts.push({ url: await uploadRender(s, basename(s)), title: basename(s, extname(s)) });
  }
  const { warnings } = await call({
    action: "complete",
    id,
    video_url: videoUrl,
    title: argVal("title"),
    thumbnail_url: thumbnailUrl,
    description: argVal("description"),
    duration_sec: probeDurationSec(video),
    shorts,
  });
  console.log(`Готово: заявка закрыта, ролик в «AI монтаж → Готовые».`);
  for (const w of warnings ?? []) console.warn(`⚠ ${w}`);
} else if (cmd === "fail") {
  const [, , , id, reason] = process.argv;
  if (!id) {
    console.error('Нужно: fail <jobId> "<причина>"');
    process.exit(1);
  }
  await call({ action: "fail", id, error: reason || "монтаж не удался" });
  console.log("ok");
} else {
  console.error("Команды: next | status | complete | fail (подробности в шапке файла)");
  process.exit(1);
}
