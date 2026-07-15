#!/usr/bin/env node
/**
 * Мост Montage pipeline → Контент-завод.
 *
 * Заливает финальный рендер (out/*.mp4) в Supabase Storage
 * (bucket `content-factory-uploads`, проект Контент-завода) и регистрирует
 * его в таблице `heygen_usage` — после этого ролик появляется в разделе
 * «AI монтаж → Готовые» у выбранного проекта (клиента), как и видео HeyGen.
 *
 * Использование (из корня репозитория, ключи берутся из .env):
 *   node scripts/montage-publish.mjs \
 *     --project <projectId>            # id проекта (клиента) в приложении
 *     --video out/main169.mp4          # финальный рендер
 *     [--title "Название ролика"]
 *     [--thumb work/<id>/thumb.jpg]    # обложка (опционально)
 *     [--description "Описание из publish.md"]
 *     [--ref <id>]                     # стабильный id для upsert (default: имя файла)
 *
 * По умолчанию пишет с publishable-ключом (как веб-клиент, через RLS).
 * Если RLS запрещает insert без сессии — задайте SUPABASE_SERVICE_ROLE_KEY в .env.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

// ── .env (без dotenv: не тащим зависимость) ─────────────────────────────────
function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...loadEnv(resolve(".env")), ...process.env };

// ── аргументы ────────────────────────────────────────────────────────────────
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const projectId = arg("project");
const videoPath = arg("video");
if (!projectId || !videoPath) {
  console.error("Нужно: --project <projectId> --video <path.mp4> [--title …] [--thumb …] [--description …] [--ref …]");
  process.exit(1);
}
if (!existsSync(videoPath)) {
  console.error(`Файл не найден: ${videoPath}`);
  process.exit(1);
}
const title = arg("title") ?? basename(videoPath, extname(videoPath));
const thumbPath = arg("thumb");
const description = arg("description");
const refId = arg("ref") ?? `montage-${basename(videoPath)}`;

// ── клиенты: storage — проект Контент-завода, таблица — основной проект ─────
const storageUrl = env.VITE_CLIENT_SUPABASE_URL || env.VITE_SUPABASE_URL;
const storageKey = env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
const dbUrl = env.VITE_SUPABASE_URL;
const dbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!storageUrl || !storageKey || !dbUrl || !dbKey) {
  console.error("Не хватает VITE_SUPABASE_* в .env");
  process.exit(1);
}
const storage = createClient(storageUrl, storageKey);
const db = createClient(dbUrl, dbKey);
const BUCKET = "content-factory-uploads";

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
    return null; // ffprobe нет — не критично
  }
}

async function upload(path, contentType) {
  const key = `montage/${projectId}/${Date.now()}-${basename(path).replace(/[^\w.\-]+/g, "_")}`;
  const { error } = await storage.storage
    .from(BUCKET)
    .upload(key, readFileSync(path), { contentType, upsert: false });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  return storage.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

const videoUrl = await upload(videoPath, "video/mp4");
console.log(`видео загружено: ${videoUrl}`);
let thumbnailUrl = null;
if (thumbPath && existsSync(thumbPath)) {
  thumbnailUrl = await upload(thumbPath, "image/jpeg");
  console.log(`обложка загружена: ${thumbnailUrl}`);
}

const row = {
  project_id: projectId,
  source: "montage-pipeline",
  mode: "montage",
  ref_id: refId,
  title: title.slice(0, 80),
  video_url: videoUrl,
  thumbnail_url: thumbnailUrl,
  duration_sec: probeDurationSec(videoPath),
  cost_usd: null,
  ...(description ? { description: description.slice(0, 2000) } : {}),
};
const { error } = await db
  .from("heygen_usage")
  .upsert(row, { onConflict: "project_id,ref_id", ignoreDuplicates: false });
if (error) {
  console.error(`heygen_usage upsert: ${error.message}`);
  console.error("Видео уже в Storage (URL выше). Если это RLS — добавьте SUPABASE_SERVICE_ROLE_KEY в .env и повторите.");
  process.exit(2);
}
console.log(`готово: «${title}» появится в Контент-заводе → AI монтаж → Готовые (проект ${projectId})`);
