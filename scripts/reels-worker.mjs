#!/usr/bin/env node
/**
 * CLI-помощник очереди Reels-видео. Заявки reels_jobs создаёт сайт (Контент-завод
 * → «Reels-видео»: сценарий/ТЗ + голос + опции). VPS-воркер Reels Factory мёртв —
 * очередь разбирает Claude-сессия по скиллу: claim/status заявки — через Supabase
 * (MCP/SQL), а озвучку и публикацию — этот помощник через edge-функцию reels-tts
 * (auth: заголовок x-montage-key = MONTAGE_WORKER_KEY из .env).
 *
 * Между заявкой и публикацией Claude делает: озвучка (tts) → transcribe.py →
 * разметка сцен work/<id>/reels.json (по смыслу) → reels.py → рендер ReelsExplainer.
 *
 * Команды (из корня репозитория):
 *   node scripts/reels-worker.mjs tts <jobId> --voice <voiceId> [--out remotion/public/reels/vo_<id>.mp3] [--text "…"]
 *       Сгенерить озвучку сценария заявки выбранным голосом (ElevenLabs) и скачать mp3.
 *   node scripts/reels-worker.mjs broll <jobId> [--work <slug>]
 *       Автосборка живого видео-б-ролла: по полям scene.brollQuery в work/<slug>/
 *       reels.json тянет клипы (Pexels → edge reels-broll), качает в
 *       remotion/public/broll/<slug>/ и проставляет scene.clip. Затем reels.py → рендер.
 *   node scripts/reels-worker.mjs publish <jobId> --video out/reels_<id>.mp4 \
 *       [--title "…"] [--description "…"] [--no-telegram]
 *       Залить рендер в bucket `renders`, записать в «Готовые» (reels_usage),
 *       закрыть заявку (status=done) и отправить в Telegram проекта.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, resolve } from "node:path";

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
const FN = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/reels-tts`;

async function call(body) {
  const r = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-montage-key": WORKER_KEY, apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `reels-tts HTTP ${r.status}`);
  return j;
}

function probeDurationSec(path) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], { encoding: "utf8" });
    const sec = Math.round(parseFloat(out.trim()));
    return Number.isFinite(sec) && sec > 0 ? sec : null;
  } catch { return null; }
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
}

async function uploadRender(localPath, jobId) {
  const path = `reels/${jobId}/final-${Date.now()}.mp4`;
  const { token, publicUrl } = await call({ action: "sign_upload", path });
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await sb.storage.from("renders").uploadToSignedUrl(path, token, readFileSync(localPath), { contentType: "video/mp4" });
  if (error) throw new Error(`upload ${localPath}: ${error.message}`);
  return publicUrl;
}

function argVal(name) { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; }
const hasFlag = (name) => process.argv.includes(`--${name}`);

const cmd = process.argv[2];
const jobId = process.argv[3];

try {
  if (cmd === "tts") {
    const voiceId = argVal("voice");
    const out = argVal("out") || `remotion/public/reels/vo_${jobId}.mp3`;
    if (!jobId || !voiceId) throw new Error("usage: tts <jobId> --voice <voiceId> [--out path]");
    const sb = createClient(SUPABASE_URL, ANON_KEY);
    const { data: job } = await sb.from("reels_jobs").select("script").eq("id", jobId).maybeSingle();
    const text = (job?.script || argVal("text") || "").trim();
    if (!text) throw new Error("script пуст (передай --text, если RLS не отдаёт заявку)");
    const { publicUrl } = await call({ action: "tts", voiceId, path: `reels/${jobId}/vo.mp3`, text });
    await download(publicUrl, out);
    console.log(`OK tts → ${out}`);
  } else if (cmd === "broll") {
    // Автосборка живого видео-б-ролла (Pexels) под сцены. В work/<slug>/reels.json
    // у сцен, которым нужен футаж, должно стоять поле brollQuery (короткий англ.
    // запрос по смыслу фразы, см. docs/broll-rules.md). Команда: тянет клипы через
    // edge-функцию reels-broll (в bucket renders), качает их в remotion/public/broll/
    // <slug>/ и проставляет scene.clip. Дальше — reels.py → рендер (движок играет
    // клип как видео через OffthreadVideo, а не мёрзнет на 1 кадре).
    const slug = argVal("work") || (jobId || "").slice(0, 8);
    const reelsPath = `work/${slug}/reels.json`;
    if (!existsSync(reelsPath)) throw new Error(`нет ${reelsPath} (сначала разметь сцены)`);
    const reels = JSON.parse(readFileSync(reelsPath, "utf8"));
    const scenes = Array.isArray(reels.scenes) ? reels.scenes : [];
    const queries = [...new Set(scenes.map((s) => String(s.brollQuery || "").trim()).filter(Boolean))];
    if (!queries.length) throw new Error("ни у одной сцены нет brollQuery — размечай b-roll в reels.json (см. docs/broll-rules.md)");
    const BROLL_FN = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/reels-broll`;
    const r = await fetch(BROLL_FN, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-montage-key": WORKER_KEY, apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ action: "pexels", jobId: slug, orientation: "portrait", perQuery: 1, queries }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `reels-broll HTTP ${r.status}`);
    const byQuery = new Map();
    for (const c of j.clips || []) {
      byQuery.set(c.query, c);
      await download(c.url, `remotion/public/broll/${slug}/${c.url.split("/").pop()}`);
    }
    let assigned = 0;
    for (const s of scenes) {
      const c = byQuery.get(String(s.brollQuery || "").trim());
      if (c) { s.clip = `broll/${slug}/${c.url.split("/").pop()}`; assigned++; }
    }
    writeFileSync(reelsPath, JSON.stringify(reels, null, 2));
    console.log(`OK broll ${slug}: queries=${queries.length} clips=${(j.clips || []).length} assigned=${assigned} → ${reelsPath}`);
  } else if (cmd === "publish") {
    const video = argVal("video");
    if (!jobId || !video) throw new Error("usage: publish <jobId> --video <path> [--title …] [--description …] [--no-telegram]");
    const videoUrl = await uploadRender(video, jobId);
    const res = await call({
      action: "publish", jobId, videoUrl,
      title: argVal("title"), description: argVal("description"),
      durationSec: probeDurationSec(video), notifyTelegram: !hasFlag("no-telegram"),
    });
    console.log(`OK publish ${jobId}: ${videoUrl}`);
    if (res.warnings?.length) console.log("warnings:", res.warnings.join("; "));
  } else {
    console.error("Команды: tts | broll | publish (см. шапку файла)");
    process.exit(1);
  }
} catch (e) {
  console.error("Ошибка:", e.message);
  process.exit(1);
}
