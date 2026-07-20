#!/usr/bin/env node
/**
 * Автономный воркер монтаж-очереди (VPS).
 * Крутится в цикле: next → пайплайн → render → complete/fail.
 *
 *   node scripts/montage-daemon.mjs            # бесконечный цикл
 *   node scripts/montage-daemon.mjs once       # одна заявка (или выход если пусто)
 *   node scripts/montage-daemon.mjs bootstrap  # скачать ключи в .env
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, statSync,
} from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
function saveEnvKey(path, key, value) {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  writeFileSync(path, text, { mode: 0o600 });
}

const env = { ...loadEnv(resolve(".env")), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.VITE_CLIENT_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY;
const WORKER_KEY = env.MONTAGE_WORKER_KEY;
const PY = resolve(".venv/bin/python");
const CHROME = env.REMOTION_BROWSER_EXECUTABLE
  || "/root/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7928.2/chrome-headless-shell-linux64/chrome-headless-shell";

if (!SUPABASE_URL || !ANON_KEY || !WORKER_KEY) {
  console.error("Нужны VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, MONTAGE_WORKER_KEY в .env");
  process.exit(1);
}

const MW = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/montage-worker`;
const AI = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/montage-ai`;

async function call(url, body, retries = 5) {
  let last;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
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
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    } catch (e) {
      last = e;
      console.warn(`call attempt ${attempt}/${retries}:`, e instanceof Error ? e.message : e);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw last;
}

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    ...opts,
  });
  if (r.status !== 0) throw new Error(`${cmd} exit ${r.status}`);
}

function py(args) {
  if (!existsSync(PY)) throw new Error("Нет .venv — сначала bash scripts/montage-setup.sh");
  sh(PY, args);
}

function status(id, progress, state) {
  return call(MW, { action: "update", id, progress, ...(state ? { status: state } : {}) });
}

async function download(url, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download HTTP ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dst));
}

function makeProxy(src, mediaBase) {
  const publicDir = resolve("remotion/public");
  mkdirSync(publicDir, { recursive: true });
  const dst = resolve(publicDir, `${mediaBase}.mp4`);
  if (existsSync(dst)) {
    console.log(`прокси уже есть: ${dst}`);
    return dst;
  }
  // all-intra H.264, звук copy
  sh("ffmpeg", [
    "-y", "-i", src,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "1", "-bf", "0",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    dst,
  ]);
  return dst;
}

/** Main169/Shorts печатают акценты с staticFile("key.wav") — без файла рендер падает 404/EPIPE. */
function ensureKeyWav() {
  const publicDir = resolve("remotion/public");
  mkdirSync(publicDir, { recursive: true });
  const dst = resolve(publicDir, "key.wav");
  try {
    if (existsSync(dst) && statSync(dst).size > 100) return dst;
  } catch { /* recreate */ }
  const bundled = resolve("assets/sfx/key.wav");
  if (existsSync(bundled)) {
    copyFileSync(bundled, dst);
    console.log(`✓ key.wav → remotion/public (из assets/sfx)`);
    return dst;
  }
  // Фоллбэк: короткий клик через ffmpeg sine (если бандл потеряли).
  sh("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "sine=frequency=1200:duration=0.04",
    "-af", "afade=t=out:st=0.02:d=0.02",
    "-ac", "1", "-ar", "44100",
    dst,
  ]);
  console.log(`✓ key.wav сгенерирован через ffmpeg`);
  return dst;
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

// Supabase Storage Free: жёсткий лимит ~50 МБ на объект. Большие 16:9 → Cloudflare R2
// (тот же r2-presign-upload, что у автопоста).
const SUPABASE_DIRECT_MAX_BYTES = 45 * 1024 * 1024;

async function uploadToR2(localPath, remoteName, contentType) {
  const size = statSync(localPath).size;
  const filename = remoteName.replace(/[^\w.\-]+/g, "_") || basename(localPath);
  const r2Url = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/r2-presign-upload`;
  const res = await fetch(r2Url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-key": ANON_KEY,
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ filename, contentType, size }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error || !j.uploadUrl || !j.publicUrl) {
    throw new Error(j.error || `r2-presign HTTP ${res.status}`);
  }
  const body = readFileSync(localPath);
  const put = await fetch(j.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!put.ok) throw new Error(`r2 PUT HTTP ${put.status}`);
  console.log(`✓ R2 upload ${(size / 1024 / 1024).toFixed(1)} MB → ${j.publicUrl}`);
  return j.publicUrl;
}

async function uploadRender(localPath, remoteName) {
  const contentType = localPath.endsWith(".jpg") || localPath.endsWith(".jpeg")
    ? "image/jpeg"
    : "video/mp4";
  const size = existsSync(localPath) ? statSync(localPath).size : 0;
  if (size > SUPABASE_DIRECT_MAX_BYTES) {
    console.log(`файл ${(size / 1024 / 1024).toFixed(1)} MB > 45 MB — сразу в R2`);
    return uploadToR2(localPath, remoteName, contentType);
  }

  const path = `montage/${Date.now()}-${remoteName.replace(/[^\w.\-]+/g, "_")}`;
  const { token, publicUrl } = await call(MW, { action: "sign_upload", path });
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const body = readFileSync(localPath);
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { error } = await sb.storage.from("renders").uploadToSignedUrl(path, token, body, {
      contentType,
    });
    if (!error) return publicUrl;
    last = error;
    console.warn(`upload attempt ${attempt}/5:`, error.message);
    if (/exceeded the maximum allowed size/i.test(error.message)) {
      console.warn("Supabase Storage лимит — фоллбэк в R2");
      return uploadToR2(localPath, remoteName, contentType);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`upload ${localPath}: ${last?.message || "failed"}`);
}

async function bootstrap() {
  const keys = await call(AI, { action: "bootstrap_env" });
  const envPath = resolve(".env");
  for (const k of ["DEEPGRAM_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY"]) {
    if (keys[k]) {
      saveEnvKey(envPath, k, keys[k]);
      console.log(`✓ ${k}`);
    } else {
      console.warn(`⚠ ${k} пуст в секретах Supabase`);
    }
  }
  console.log("bootstrap ok");
}

/** Режим B-roll: колонка broll_mode ИЛИ formats `broll:kie` ИЛИ маркер в brief. */
function resolveBrollMode(job) {
  if (["auto", "library", "pexels", "kie"].includes(job.broll_mode)) return job.broll_mode;
  const formats = Array.isArray(job.formats) ? job.formats.map(String) : [];
  const fromFmt = formats.find((f) => f.startsWith("broll:"))?.slice(6);
  if (["auto", "library", "pexels", "kie"].includes(fromFmt)) return fromFmt;
  const m = String(job.brief || "").match(/\[BROLL_MODE=(auto|library|pexels|kie)\]/i);
  if (m) return m[1].toLowerCase();
  return "auto";
}

function resolveAssetFolderIds(job) {
  if (Array.isArray(job.asset_folder_ids) && job.asset_folder_ids.length) {
    return job.asset_folder_ids.map(String).filter(Boolean).slice(0, 20);
  }
  const formats = Array.isArray(job.formats) ? job.formats.map(String) : [];
  return formats
    .filter((f) => f.startsWith("folder:"))
    .map((f) => f.slice(7))
    .filter(Boolean)
    .slice(0, 20);
}

function extractKieVideoUrl(task) {
  if (!task || typeof task !== "object") return null;
  const direct = task.videoUrl || task.video_url || task.resultUrl || task.result_url;
  if (typeof direct === "string" && /^https?:\/\//.test(direct)) return direct;
  let parsed = task.resultJson ?? task.result_json ?? null;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  if (parsed && typeof parsed === "object") {
    const urls = parsed.resultUrls || parsed.result_urls || parsed.urls;
    if (Array.isArray(urls) && urls[0]) return String(urls[0]);
    if (typeof parsed.url === "string") return parsed.url;
  }
  if (Array.isArray(task.resultUrls) && task.resultUrls[0]) return String(task.resultUrls[0]);
  return null;
}

function kieState(task) {
  return String(task?.state ?? task?.status ?? "").toLowerCase();
}

/** Скачать/сгенерировать внешние B-roll клипы → remotion/public/inserts/<jobId>/ */
async function materializeExternalBroll(job, insertsDoc, brollMode) {
  const projectId = String(job.project_id || "");
  const id = job.id;
  const list = Array.isArray(insertsDoc?.inserts) ? insertsDoc.inserts : [];
  if (!projectId || !list.length) return insertsDoc;
  if (brollMode !== "kie" && brollMode !== "pexels") return insertsDoc;

  const outDir = resolve("remotion/public/inserts", id);
  mkdirSync(outDir, { recursive: true });
  const materialized = [];
  const maxClips = Math.min(6, list.length);

  for (let i = 0; i < maxClips; i++) {
    const it = list[i];
    const prompt = String(it.prompt || "").trim();
    const query = String(it.query || prompt || "").trim().slice(0, 120);
    if (!prompt && !query) continue;

    const fileName = `${String(i + 1).padStart(2, "0")}_broll.mp4`;
    const abs = resolve(outDir, fileName);
    const rel = `${id}/${fileName}`;

    try {
      if (brollMode === "kie") {
        await status(id, `Kie/Kling ${i + 1}/${maxClips}`);
        const created = await call(MW, { action: "kie_create", project_id: projectId, prompt: prompt || query });
        const taskId = created.taskId;
        if (!taskId) throw new Error("kie_create: нет taskId");
        let videoUrl = null;
        for (let tick = 0; tick < 72; tick++) {
          await new Promise((r) => setTimeout(r, 5000));
          const st = await call(MW, { action: "kie_status", project_id: projectId, task_id: taskId });
          const task = st.task || {};
          const state = kieState(task);
          console.log(`kie ${taskId} → ${state || "?"}`);
          if (["success", "succeed", "completed", "done"].includes(state)) {
            videoUrl = extractKieVideoUrl(task);
            break;
          }
          if (["fail", "failed", "error"].includes(state)) {
            throw new Error(`Kie fail: ${JSON.stringify(task).slice(0, 200)}`);
          }
        }
        if (!videoUrl) throw new Error("Kie timeout — нет video url");
        await download(videoUrl, abs);
      } else {
        await status(id, `Pexels ${i + 1}/${maxClips}`);
        const found = await call(MW, {
          action: "pexels_search",
          project_id: projectId,
          query: query || "business",
          per_page: 4,
        });
        const videoUrl = found.videos?.[0]?.video_url;
        if (!videoUrl) throw new Error(`Pexels пусто по запросу «${query}»`);
        await download(videoUrl, abs);
      }

      if (!existsSync(abs)) throw new Error("download empty");
      const proxyPath = resolve(outDir, fileName.replace(/\.mp4$/i, "_p.mp4"));
      try {
        sh("ffmpeg", [
          "-y", "-i", abs,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "1", "-bf", "0",
          "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart",
          proxyPath,
        ]);
        if (existsSync(proxyPath)) {
          copyFileSync(proxyPath, abs);
          unlinkSync(proxyPath);
        }
      } catch (e) {
        console.warn("broll proxy failed, using original", e instanceof Error ? e.message : e);
      }

      materialized.push({
        file: rel,
        type: "video",
        anchorWord: it.anchorWord,
        endWord: it.endWord,
        layout: it.layout || "full",
        note: it.note || prompt || query,
      });
    } catch (e) {
      console.warn(`broll clip ${i + 1} failed:`, e instanceof Error ? e.message : e);
    }
  }

  if (!materialized.length) {
    console.warn(`⚠ ${brollMode}: не удалось скачать клипы — фоллбэк на motion`);
    return null;
  }
  console.log(`✓ ${brollMode} inserts: ${materialized.length}`);
  return { inserts: materialized };
}

async function processJob(job) {
  const id = job.id;
  const work = resolve("work", id);
  mkdirSync(work, { recursive: true });
  writeFileSync(resolve(work, "job.json"), JSON.stringify(job, null, 2));

  // Очередь «Монтаж съёмки»: ОДИН цельный ролик 9:16 (весь исходник).
  // Не режем на шортсы и не делаем jump-cut — даже если formats со старого UI.
  const wantFull916 = true;
  const brief = String(job.brief || "").replace(/\[BROLL_MODE=(auto|library|pexels|kie)\]/ig, "").trim();
  const brollMode = resolveBrollMode(job);
  const assetFolderIds = resolveAssetFolderIds(job);
  console.log(`brollMode=${brollMode} folders=${assetFolderIds.length}`);
  const brollHint = {
    auto: "B-roll: автоматически — motion-графика и вставки по смыслу.",
    library: "B-roll: папки проекта — случайные клипы/нарезки из медиатеки.",
    pexels: "B-roll: Pexels — стоковые видео по смыслу реплик.",
    kie: "B-roll: Kie.ai / Kling — сгенерировать уникальные видео-вставки.",
  }[brollMode];
  const insertBrief = [brief, brollHint].filter(Boolean).join("\n");
  writeFileSync(
    resolve(work, "broll.json"),
    JSON.stringify({ brollMode, assetFolderIds }, null, 2),
  );
  const mediaBase = `source_${id.slice(0, 8)}`;

  await status(id, "скачиваем исходник");
  const ext = (extname(new URL(job.source_url).pathname) || ".mp4").toLowerCase();
  const raw = resolve(work, `source_raw${ext}`);
  if (!existsSync(raw)) await download(job.source_url, raw);

  await status(id, "прокси + аудио");
  ensureKeyWav();
  const proxy = makeProxy(raw, mediaBase);
  const wav = resolve(work, "audio.wav");
  if (!existsSync(wav)) {
    sh("ffmpeg", ["-y", "-i", proxy, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  }

  await status(id, "транскрибируем");
  if (!existsSync(resolve(work, "words.json"))) {
    py(["pipeline/transcribe.py", wav, work, "ru"]);
  }
  if (!existsSync(resolve(work, "indexed.txt"))) {
    py(["pipeline/indexed.py", work]);
  }

  await status(id, "ищем лицо");
  if (!existsSync(resolve(work, "faces.json"))) {
    py(["pipeline/faces.py", proxy, resolve(work, "faces.json"), "5"]);
  }

  const indexed = readFileSync(resolve(work, "indexed.txt"), "utf8");
  const utterances = existsSync(resolve(work, "utterances.txt"))
    ? readFileSync(resolve(work, "utterances.txt"), "utf8")
    : "";
  const words = JSON.parse(readFileSync(resolve(work, "words.json"), "utf8"));

  const outDir = resolve("out");
  mkdirSync(outDir, { recursive: true });
  let mainPath = null;

  if (wantFull916) {
    await status(id, "сохраняем ролик целиком (9:16)");
    // ВСЕГДА перезаписываем delete.json: иначе старый агрессивный delete
    // с прошлой попытки снова нарежет исходник пополам.
    writeFileSync(
      resolve(work, "delete.json"),
      JSON.stringify({ delete: [], keep_full: true, reason: "queue: keep source intact 9:16" }, null, 2),
    );
    // edl пересобираем под keep_full (даже если файл уже был).
    py(["pipeline/edl.py", work, wav, "30"]);
    if (!existsSync(resolve(work, "accents.json"))) {
      await status(id, "акцентные слова");
      const acc = await call(AI, { action: "markup_accents", indexed, brief });
      writeFileSync(resolve(work, "accents.json"), JSON.stringify(acc, null, 2));
    }
    // Motion/B-roll обязателен для очереди — без вставок останутся одни титры.
    await status(id, "motion-вставки / b-roll");
    const durationSec = Number(
      JSON.parse(readFileSync(resolve(work, "edl.json"), "utf8")).kept_duration
      ?? words?.[words.length - 1]?.end
      ?? probeDurationSec(proxy)
      ?? 0,
    );
    const insertsRaw = await call(AI, {
      action: "markup_inserts",
      indexed,
      utterances,
      brief: insertBrief,
      durationSec,
      brollMode,
      assetFolderIds,
    });
    let inserts = insertsRaw;
    if (brollMode === "kie" || brollMode === "pexels") {
      await status(id, `генерация B-roll (${brollMode})`);
      const external = await materializeExternalBroll(job, insertsRaw, brollMode);
      if (external) {
        inserts = external;
      } else {
        // Фоллбэк: motion, чтобы ролик не остался без вставок.
        console.warn(`${brollMode} пуст → motion fallback`);
        inserts = await call(AI, {
          action: "markup_inserts",
          indexed,
          utterances,
          brief: insertBrief,
          durationSec,
          brollMode: "auto",
          assetFolderIds,
        });
      }
    }
    writeFileSync(resolve(work, "inserts.json"), JSON.stringify(inserts, null, 2));

    // Один вертикальный клип на ВСЮ длину — не «шортсы из лучших моментов».
    const accents = JSON.parse(readFileSync(resolve(work, "accents.json"), "utf8"));
    const accentIdx = (accents.accents || [])
      .map((a) => Number(a.word ?? a))
      .filter((n) => Number.isFinite(n));
    const fullId = `Full916-${id.slice(0, 8)}`;
    writeFileSync(
      resolve(work, "shorts.json"),
      JSON.stringify({
        media: mediaBase,
        shorts: [{
          id: fullId,
          title: (job.source_name || "Монтаж").replace(/\.[^.]+$/, "").slice(0, 80),
          spans: [[0, durationSec]],
          accents: accentIdx,
          fixes: {},
          captionStyle: "pill",
        }],
      }, null, 2),
    );
    // НЕ вызываем shorts_refine.py — он режет паузы jump-cut’ами.

    await status(id, "собираем пропсы 9:16");
    py(["pipeline/shorts.py", work, resolve("remotion/props")]);
    const propsPath = resolve("remotion/props", `${fullId}.json`);
    if (!existsSync(propsPath)) throw new Error(`нет props ${fullId}.json`);
    py(["pipeline/audio.py", propsPath]);

    await status(id, "рендер 9:16", "rendering");
    mainPath = resolve(outDir, `main916_${id.slice(0, 8)}.mp4`);
    const browserArgs = existsSync(CHROME) ? ["--browser-executable", CHROME] : [];
    sh("npx", [
      "remotion", "render", "src/index.ts", "Short-Example", mainPath,
      `--props=${propsPath}`,
      "--image-format=png", "--crf=18", "--x264-preset=veryfast",
      "--concurrency=1",
      ...browserArgs,
    ], { cwd: resolve("remotion") });
  }

  if (!mainPath) {
    throw new Error("Нечего публиковать: нет цельного 9:16");
  }

  await status(id, "публикуем");
  const title = (job.source_name || "Монтаж").replace(/\.[^.]+$/, "").slice(0, 80);
  const videoUrl = await uploadRender(mainPath, basename(mainPath));

  const { warnings } = await call(MW, {
    action: "complete",
    id,
    video_url: videoUrl,
    title,
    duration_sec: probeDurationSec(mainPath),
    shorts: [],
  });

  console.log(`✓ job ${id} done (full 9:16)`);
  for (const w of warnings ?? []) console.warn(`⚠ ${w}`);
}

async function once() {
  const { job } = await call(MW, { action: "next" });
  if (!job) {
    console.log("Очередь пуста.");
    return false;
  }
  console.log(`→ job ${job.id} formats=${JSON.stringify(job.formats)} name=${job.source_name}`);
  try {
    await processJob(job);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("FAIL", msg);
    try {
      await call(MW, { action: "fail", id: job.id, error: msg.slice(0, 500) });
    } catch (fe) {
      console.error("fail-report error", fe);
    }
  }
  return true;
}

async function loop() {
  console.log("montage-daemon started", new Date().toISOString());
  for (;;) {
    try {
      const had = await once();
      await new Promise((r) => setTimeout(r, had ? 2_000 : 30_000));
    } catch (e) {
      console.error("loop error", e);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

const cmd = process.argv[2] || "loop";
if (cmd === "bootstrap") await bootstrap();
else if (cmd === "once") await once();
else await loop();
