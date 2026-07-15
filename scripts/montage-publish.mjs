#!/usr/bin/env node
/**
 * Ручная публикация рендера Montage pipeline в Контент-завод — БЕЗ заявки с сайта
 * (для монтажа, запущенного напрямую в чате: «смонтируй видео …»).
 * Для заявок из приложения используйте scripts/montage-worker.mjs complete.
 *
 * Заливает видео в bucket `renders` и через edge-функцию montage-worker
 * (service role) регистрирует его в heygen_usage — ролик появляется в разделе
 * «AI монтаж → Готовые» у проекта и, если у проекта привязан Telegram, уходит в чат.
 *
 * Использование (из корня репозитория, ключи из .env):
 *   node scripts/montage-publish.mjs \
 *     --project <projectId>            # id проекта (клиента) в приложении
 *     --video out/main169.mp4
 *     [--title "Название ролика"]
 *     [--thumb work/<id>/thumb.jpg]
 *     [--description "Описание из publish.md"]
 *     [--short out/short1.mp4]...      # шортсы (повторяемый флаг)
 *     [--no-telegram]
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `montage-worker HTTP ${r.status}`);
  return j;
}

async function uploadRender(localPath, remoteName) {
  const path = `montage/${Date.now()}-${remoteName.replace(/[^\w.\-]+/g, "_")}`;
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

const projectId = argVal("project");
const videoPath = argVal("video");
if (!projectId || !videoPath || !existsSync(videoPath)) {
  console.error("Нужно: --project <projectId> --video <path.mp4> [--title …] [--thumb …] [--description …] [--short …] [--no-telegram]");
  process.exit(1);
}
const title = argVal("title") ?? basename(videoPath, extname(videoPath));

console.log("Заливаем видео…");
const videoUrl = await uploadRender(videoPath, basename(videoPath));
const thumb = argVal("thumb");
const thumbnailUrl = thumb && existsSync(thumb) ? await uploadRender(thumb, basename(thumb)) : undefined;
const shorts = [];
for (const s of argAll("short")) {
  if (!existsSync(s)) throw new Error(`шортс не найден: ${s}`);
  console.log(`Заливаем шортс ${basename(s)}…`);
  shorts.push({ url: await uploadRender(s, basename(s)), title: basename(s, extname(s)) });
}

const { warnings } = await call({
  action: "publish",
  project_id: projectId,
  video_url: videoUrl,
  title,
  thumbnail_url: thumbnailUrl,
  description: argVal("description"),
  duration_sec: probeDurationSec(videoPath),
  shorts,
  ref_id: `montage-${basename(videoPath)}`,
  notify_telegram: !process.argv.includes("--no-telegram"),
});
console.log(`Готово: «${title}» в Контент-заводе → AI монтаж → Готовые (проект ${projectId})`);
for (const w of warnings ?? []) console.warn(`⚠ ${w}`);
