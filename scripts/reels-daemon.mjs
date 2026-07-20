/**
 * Автономный воркер очереди Reels (VPS).
 *   node scripts/reels-daemon.mjs            # loop
 *   node scripts/reels-daemon.mjs once
 *
 * Поток: next → tts → transcribe → sources(library/pexels) → AI scenes
 *        → inject video cutaways → reels.py → Remotion → publish.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";
import { pickLibraryAsset } from "./lib/brollMatch.mjs";

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

const env = { ...loadEnv(resolve(".env")), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.VITE_CLIENT_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY;
const WORKER_KEY = env.MONTAGE_WORKER_KEY;
const PY = resolve(".venv/bin/python");
const CHROME = env.REMOTION_BROWSER_EXECUTABLE
  || "/root/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7928.2/chrome-headless-shell-linux64/chrome-headless-shell";
const FN = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/reels-tts`;
const AI = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/montage-ai`;

if (!SUPABASE_URL || !ANON_KEY || !WORKER_KEY) {
  console.error("Нужны VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, MONTAGE_WORKER_KEY");
  process.exit(1);
}

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
      console.warn(`call ${attempt}/${retries}:`, e instanceof Error ? e.message : e);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw last;
}

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env }, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} exit ${r.status}`);
}

function py(args) {
  sh(PY, args);
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
}

function probeDurationSec(path) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { encoding: "utf8" },
    );
    return parseFloat(out.trim()) || null;
  } catch {
    return null;
  }
}

function proxyClip(abs, outMp4) {
  sh("ffmpeg", [
    "-y", "-i", abs,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "1", "-bf", "0",
    "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart",
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    outMp4,
  ]);
  return outMp4;
}

/** Download library / stock clips. Returns [{file, name, id}]. */
async function materializeReelsBroll(job, work) {
  const id = job.id;
  const config = job.config || {};
  const mode = String(config.brollMode || "auto");
  if (mode !== "library" && mode !== "pexels" && mode !== "kie") return [];

  const outDir = resolve("remotion/public/reels/inserts", id);
  mkdirSync(outDir, { recursive: true });
  const clips = [];
  const debug = { mode, ok: 0, failed: [], catalog: 0 };

  if (mode === "library") {
    await call(FN, { action: "update", id, stage: "B-roll из папок", progress: 45 });
    const sources = await call(FN, { action: "job_sources", jobId: id });
    writeFileSync(resolve(work, "reels-sources.json"), JSON.stringify(sources, null, 2));
    const assets = Array.isArray(sources.assets) ? sources.assets : [];
    debug.catalog = assets.length;
    console.log(`reels library catalog: ${assets.length}`);
    if (!assets.length) {
      console.warn("library: папки пусты → только motion");
      writeFileSync(resolve(work, "broll-debug.json"), JSON.stringify(debug, null, 2));
      return [];
    }
    const used = new Set();
    const maxClips = Math.min(6, assets.length);
    for (let i = 0; i < maxClips; i++) {
      const pick = pickLibraryAsset(assets, used, `scene-${i}`, { minScore: 0.99 });
      const asset = pick.asset;
      if (!asset?.public_url) continue;
      used.add(asset.id);
      const ext = (extname(String(asset.name || "")) || ".mp4").toLowerCase();
      const raw = resolve(outDir, `${String(i + 1).padStart(2, "0")}_raw${ext}`);
      const finalName = `${String(i + 1).padStart(2, "0")}_lib.mp4`;
      const finalAbs = resolve(outDir, finalName);
      try {
        await download(asset.public_url, raw);
        proxyClip(raw, finalAbs);
        try { unlinkSync(raw); } catch { /* */ }
        clips.push({
          file: `reels/inserts/${id}/${finalName}`,
          name: asset.name,
          id: asset.id,
        });
        debug.ok += 1;
      } catch (e) {
        debug.failed.push({ name: asset.name, error: String(e?.message || e).slice(0, 160) });
      }
    }
  } else if (mode === "pexels") {
    await call(FN, { action: "update", id, stage: "Pexels B-roll", progress: 45 });
    const queries = ["marketing dashboard laptop", "smartphone social media", "business presentation screen"];
    for (let i = 0; i < queries.length; i++) {
      try {
        const found = await call(FN, {
          action: "pexels_search",
          jobId: id,
          query: queries[i],
          perPage: 4,
        });
        const url = found.videos?.[0]?.video_url;
        if (!url) continue;
        const finalName = `${String(i + 1).padStart(2, "0")}_pexels.mp4`;
        const raw = resolve(outDir, `${finalName}.raw.mp4`);
        const finalAbs = resolve(outDir, finalName);
        await download(url, raw);
        proxyClip(raw, finalAbs);
        try { unlinkSync(raw); } catch { /* */ }
        clips.push({ file: `reels/inserts/${id}/${finalName}`, name: queries[i], id: `pexels-${i}` });
        debug.ok += 1;
      } catch (e) {
        debug.failed.push({ query: queries[i], error: String(e?.message || e).slice(0, 160) });
      }
    }
  } else if (mode === "kie") {
    console.warn("reels kie: skip in daemon (cost) — motion only");
  }

  writeFileSync(resolve(work, "broll-debug.json"), JSON.stringify({ ...debug, clips }, null, 2));
  console.log(`✓ reels broll clips: ${clips.length}`);
  return clips;
}

/** Replace weak text scenes with library/stock video cutaways. */
function injectVideoScenes(reelsDoc, clips) {
  if (!clips.length) return reelsDoc;
  const scenes = Array.isArray(reelsDoc.scenes) ? [...reelsDoc.scenes] : [];
  const weak = new Set(["kinetic-type", "big-statement", "quote-card", "lower-third"]);
  let clipIdx = 0;
  const out = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const tpl = String(s.template || "");
    const useVideo = clipIdx < clips.length && (weak.has(tpl) || i % 2 === 1);
    if (useVideo) {
      const clip = clips[clipIdx++];
      out.push({
        anchorWord: s.anchorWord,
        endWord: s.endWord,
        type: "video",
        file: clip.file,
        data: { caption: true, note: clip.name },
      });
    } else {
      out.push(s);
    }
  }
  if (clipIdx < clips.length) {
    for (let i = 0; i < out.length && clipIdx < clips.length; i++) {
      if (out[i].file) continue;
      if (!weak.has(String(out[i].template || ""))) continue;
      const clip = clips[clipIdx++];
      out[i] = {
        anchorWord: out[i].anchorWord,
        endWord: out[i].endWord,
        type: "video",
        file: clip.file,
        data: { caption: true, note: clip.name },
      };
    }
  }
  console.log(`inject video scenes: ${out.filter((s) => s.file).length}/${out.length}`);
  return { ...reelsDoc, scenes: out };
}

async function processJob(job) {
  const id = job.id;
  const work = resolve("work", id);
  mkdirSync(work, { recursive: true });
  writeFileSync(resolve(work, "job.json"), JSON.stringify(job, null, 2));
  const config = job.config || {};
  const voiceId = config.elevenVoice || "B2rcpdU3qbTVXFEoJRhT";
  const script = (job.script || "").trim();
  if (!script) throw new Error("script пуст");

  await call(FN, { action: "update", id, stage: "озвучка", progress: 10 });
  const voPath = resolve("remotion/public/reels", `vo_${id}.mp3`);
  mkdirSync(dirname(voPath), { recursive: true });
  if (!existsSync(voPath)) {
    const { publicUrl } = await call(FN, {
      action: "tts",
      voiceId,
      path: `reels/${id}/vo.mp3`,
      text: script,
    });
    await download(publicUrl, voPath);
  }

  await call(FN, { action: "update", id, stage: "транскрипт", progress: 30 });
  if (!existsSync(resolve(work, "words.json"))) {
    py(["pipeline/transcribe.py", voPath, work, "ru"]);
  }
  if (!existsSync(resolve(work, "indexed.txt"))) {
    py(["pipeline/indexed.py", work]);
  }

  const indexed = readFileSync(resolve(work, "indexed.txt"), "utf8");
  const transcript = existsSync(resolve(work, "transcript.txt"))
    ? readFileSync(resolve(work, "transcript.txt"), "utf8")
    : script;

  const clips = await materializeReelsBroll(job, work);

  await call(FN, { action: "update", id, stage: "разметка сцен", progress: 55 });
  const reelsJsonPath = resolve(work, "reels.json");
  if (!existsSync(reelsJsonPath)) {
    const scenes = await call(AI, {
      action: "markup_reels",
      indexed,
      transcript,
      brief: [
        `формат=${config.format || "expert"}`,
        `broll=${config.brollMode || "auto"}`,
        clips.length
          ? `Есть ${clips.length} видео-клипов из медиатеки — часть окон уйдёт под cutaway.`
          : "Только motion. Караоке уже показывает речь — не дублируй фразы huge text.",
        "kinetic-type → data.words[]; big-statement → data.lines ≤3 слова.",
      ].join("; "),
    });
    let payload = {
      id: `Reels-${id.slice(0, 8)}`,
      audio: `vo_${id}`,
      music: null,
      theme: scenes.theme || undefined,
      captionsDefault: true,
      accents: scenes.accents || [],
      fixes: scenes.fixes || {},
      scenes: scenes.scenes || [],
    };
    payload = injectVideoScenes(payload, clips);
    writeFileSync(reelsJsonPath, JSON.stringify(payload, null, 2));
  } else if (clips.length) {
    const existing = JSON.parse(readFileSync(reelsJsonPath, "utf8"));
    if (!(existing.scenes || []).some((s) => s.file)) {
      writeFileSync(reelsJsonPath, JSON.stringify(injectVideoScenes(existing, clips), null, 2));
    }
  }

  const audioDur = probeDurationSec(voPath);
  if (!audioDur) throw new Error("не удалось измерить длительность озвучки");

  await call(FN, { action: "update", id, stage: "пропсы", progress: 65 });
  py(["pipeline/reels.py", work, resolve("remotion/props"), String(audioDur)]);

  const propsFile = resolve("remotion/props", `Reels-${id.slice(0, 8)}.json`);
  if (!existsSync(propsFile)) throw new Error(`нет props: ${propsFile}`);

  await call(FN, { action: "update", id, stage: "рендер", progress: 75 });
  mkdirSync(resolve("out"), { recursive: true });
  const outVideo = resolve("out", `reels_${id.slice(0, 8)}.mp4`);
  const browserArgs = existsSync(CHROME) ? ["--browser-executable", CHROME] : [];
  sh("npx", [
    "remotion", "render", "src/index.ts", "ReelsExplainer", outVideo,
    `--props=${propsFile}`,
    "--image-format=png", "--crf=18", "--x264-preset=veryfast",
    "--concurrency=1",
    ...browserArgs,
  ], { cwd: resolve("remotion") });

  await call(FN, { action: "update", id, stage: "публикация", progress: 90 });
  const path = `reels/${id}/final-${Date.now()}.mp4`;
  const { token, publicUrl } = await call(FN, { action: "sign_upload", path });
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const buf = readFileSync(outVideo);
  let upErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { error } = await sb.storage.from("renders").uploadToSignedUrl(path, token, buf, {
      contentType: "video/mp4",
    });
    if (!error) { upErr = null; break; }
    upErr = error;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const title = script.split("\n").find((l) => l.trim())?.trim().slice(0, 80) || "Reels";
  const { warnings } = await call(FN, {
    action: "publish",
    jobId: id,
    videoUrl: publicUrl,
    title,
    durationSec: Math.round(audioDur),
  });
  console.log(`✓ reels ${id} done`);
  for (const w of warnings ?? []) console.warn(`⚠ ${w}`);
}

async function once() {
  const { job } = await call(FN, { action: "next" });
  if (!job) {
    console.log("Очередь reels пуста.");
    return false;
  }
  console.log(`→ reels ${job.id}`);
  try {
    await processJob(job);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("FAIL", msg);
    try {
      await call(FN, { action: "fail", id: job.id, error: msg.slice(0, 500) });
    } catch (fe) {
      console.error("fail-report", fe);
    }
  }
  return true;
}

async function loop() {
  console.log("reels-daemon started", new Date().toISOString());
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
if (cmd === "once") await once();
else await loop();
