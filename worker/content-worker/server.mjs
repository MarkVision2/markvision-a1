#!/usr/bin/env node
/**
 * FFmpeg-worker контент-конвейера (markvision-content-worker.service).
 *
 * Скачивает видео HeyGen, проверяет ffprobe, перекодирует в единый формат
 * (H.264/AAC, yuv420p, 720x1280, faststart) и атомарно кладёт в каталог,
 * который Caddy раздаёт только на чтение. Возвращает URL, размер, длительность,
 * кодеки и sha256. Никаких зависимостей — только Node 22 и системные ffmpeg/ffprobe.
 *
 *   POST /normalize  { source_url, content_id, version? }   заголовок x-worker-token
 *   GET  /health                                             без авторизации: ok, ffmpeg, диск
 *   POST /gc         { keep_days }                           удалить файлы старше N дней
 *
 * Защита: токен, allowlist доменов + запрет private/loopback/link-local (и по
 * DNS-ответу), лимит размера, лимит времени, конкурентность, результат никогда
 * не перезаписывает существующий файл (нужен явный version).
 *
 * Конфиг — переменные окружения (см. .env.example).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { checkSourceUrl, isPrivateIp, outputFileName, parseAllowedHosts } from "./urlGuard.mjs";

const cfg = {
  port: Number(process.env.PORT ?? 9120),
  bind: process.env.BIND ?? "172.18.0.1",
  token: process.env.WORKER_TOKEN ?? "",
  mediaDir: process.env.MEDIA_DIR ?? "/var/www/media/content-pipeline",
  publicBase: (process.env.PUBLIC_BASE_URL ?? "https://n8n.zapoinov.com/media/content-pipeline").replace(/\/$/, ""),
  allowedHosts: parseAllowedHosts(process.env.ALLOWED_HOSTS),
  maxInputBytes: Number(process.env.MAX_INPUT_BYTES ?? 300 * 1024 * 1024),
  maxInputSeconds: Number(process.env.MAX_INPUT_SECONDS ?? 600),
  jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS ?? 8 * 60_000),
  downloadTimeoutMs: Number(process.env.DOWNLOAD_TIMEOUT_MS ?? 3 * 60_000),
  maxConcurrency: Number(process.env.MAX_CONCURRENCY ?? 2),
  ffmpeg: process.env.FFMPEG_PATH ?? "ffmpeg",
  ffprobe: process.env.FFPROBE_PATH ?? "ffprobe",
  width: Number(process.env.TARGET_WIDTH ?? 720),
  height: Number(process.env.TARGET_HEIGHT ?? 1280),
  crf: Number(process.env.X264_CRF ?? 20),
  preset: process.env.X264_PRESET ?? "medium",
  audioBitrate: process.env.AUDIO_BITRATE ?? "128k",
  diskWarnPct: Number(process.env.DISK_WARN_PCT ?? 70),
  diskCritPct: Number(process.env.DISK_CRIT_PCT ?? 85),
};

if (!cfg.token) {
  console.error(JSON.stringify({ level: "fatal", msg: "WORKER_TOKEN не задан — воркер не стартует без авторизации" }));
  process.exit(2);
}

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

/* ───────────────────────────── утилиты ───────────────────────────── */

function run(bin, args, { timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = timeoutMs
      ? setTimeout(() => {
        killed = true;
        proc.kill("SIGKILL");
      }, timeoutMs)
      : null;
    const onAbort = () => {
      killed = true;
      proc.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr = (stderr + d.toString()).slice(-4000); });
    proc.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (killed) return reject(new Error(`${path.basename(bin)} killed: timeout`));
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

async function probe(file, signal) {
  const { stdout } = await run(cfg.ffprobe, [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ], { timeoutMs: 60_000, signal });
  const info = JSON.parse(stdout);
  const video = (info.streams ?? []).find((s) => s.codec_type === "video");
  const audio = (info.streams ?? []).find((s) => s.codec_type === "audio");
  return {
    duration: Number(info.format?.duration ?? video?.duration ?? 0),
    size: Number(info.format?.size ?? 0),
    width: video ? Number(video.width) : null,
    height: video ? Number(video.height) : null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    pixFmt: video?.pix_fmt ?? null,
    hasAudio: Boolean(audio),
  };
}

async function sha256(file) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), async function* (src) {
    for await (const chunk of src) hash.update(chunk);
  });
  return hash.digest("hex");
}

async function diskStatus() {
  try {
    const s = await statfs(cfg.mediaDir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const usedPct = total ? Math.round(((total - free) / total) * 100) : 0;
    return {
      total_bytes: total,
      free_bytes: free,
      used_pct: usedPct,
      level: usedPct >= cfg.diskCritPct ? "critical" : usedPct >= cfg.diskWarnPct ? "warning" : "ok",
    };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

async function resolveAndCheck(hostname) {
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) throw httpError(400, "dns_empty", "хост не резолвится");
  for (const r of records) {
    if (isPrivateIp(r.address)) throw httpError(400, "private_ip", `хост резолвится в приватный адрес`);
  }
}

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** Потоковая загрузка с жёстким лимитом байт и таймаутом. */
async function download(url, dest, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.downloadTimeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "markvision-content-worker/1.0" } });
    if (res.status >= 300 && res.status < 400) {
      // Редиректы не следуем автоматически: цель могла уйти с allowlist.
      const loc = res.headers.get("location");
      throw httpError(400, "redirect", `источник редиректит на ${loc ? new URL(loc, url).hostname : "?"} — пришлите конечный URL`);
    }
    if (!res.ok || !res.body) throw httpError(502, "download_http", `источник ответил HTTP ${res.status}`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct && !/^(video\/|application\/octet-stream|binary\/)/.test(ct)) {
      throw httpError(415, "content_type", `неожиданный тип содержимого ${ct}`);
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > cfg.maxInputBytes) throw httpError(413, "too_large", `файл ${declared} байт больше лимита`);
    let received = 0;
    const limiter = async function* (src) {
      for await (const chunk of src) {
        received += chunk.length;
        if (received > cfg.maxInputBytes) throw httpError(413, "too_large", `файл больше лимита ${cfg.maxInputBytes} байт`);
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(res.body), limiter, createWriteStream(dest));
    if (received === 0) throw httpError(422, "empty", "пустой файл");
    return received;
  } catch (e) {
    if (e?.name === "AbortError") throw httpError(504, "download_timeout", "загрузка источника не уложилась в таймаут");
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Проверка, перекодирование и верификация локального файла — общий путь для /normalize и --self-test. */
async function processLocalFile(input, output, signal) {
  const src = await probe(input, signal).catch((e) => {
    throw httpError(422, "probe_failed", `ffprobe не смог прочитать файл: ${e.message.slice(0, 300)}`);
  });
  if (!src.videoCodec) throw httpError(422, "no_video", "в файле нет видеопотока");
  if (src.duration > cfg.maxInputSeconds) throw httpError(422, "too_long", `длительность ${Math.round(src.duration)} с больше лимита`);

  // scale вписывает в 720x1280 с сохранением пропорций (второй scale делает
  // размеры чётными — требование yuv420p, без force_divisible_by ради старых
  // сборок ffmpeg), pad добивает чёрными полями до точного размера.
  const vf = `scale=${cfg.width}:${cfg.height}:force_original_aspect_ratio=decrease,` +
    `scale=trunc(iw/2)*2:trunc(ih/2)*2,` +
    `pad=${cfg.width}:${cfg.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
  const args = [
    "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
    "-i", input,
    ...(src.hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]),
    "-map", "0:v:0",
    ...(src.hasAudio ? ["-map", "0:a:0"] : ["-map", "1:a:0", "-shortest"]),
    "-vf", vf,
    "-c:v", "libx264", "-preset", cfg.preset, "-crf", String(cfg.crf), "-profile:v", "high", "-level", "4.1",
    "-pix_fmt", "yuv420p", "-r", "30", "-g", "60",
    "-c:a", "aac", "-b:a", cfg.audioBitrate, "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    output,
  ];
  await run(cfg.ffmpeg, args, { timeoutMs: cfg.jobTimeoutMs, signal }).catch((e) => {
    throw httpError(500, "ffmpeg_failed", e.message.slice(0, 600));
  });

  const out = await probe(output, signal);
  if (out.videoCodec !== "h264" || out.pixFmt !== "yuv420p" || out.width !== cfg.width || out.height !== cfg.height || out.audioCodec !== "aac") {
    throw httpError(500, "verify_failed", `результат не соответствует формату: ${out.videoCodec}/${out.audioCodec}/${out.pixFmt} ${out.width}x${out.height}`);
  }
  const checksum = await sha256(output);
  return { src, out, checksum };
}

/* ───────────────────────────── нормализация ───────────────────────────── */

let active = 0;

async function normalize(body) {
  const sourceUrl = String(body.source_url ?? "").trim();
  const contentId = String(body.content_id ?? "").trim();
  const fileName = outputFileName(contentId, body.version);
  if (!fileName) throw httpError(400, "bad_content_id", "content_id/version некорректны");
  const check = checkSourceUrl(sourceUrl, cfg.allowedHosts);
  if (!check.ok) throw httpError(400, `url_${check.reason}`, `источник отклонён: ${check.reason}`);

  const target = path.join(cfg.mediaDir, fileName);
  try {
    await stat(target);
    throw httpError(409, "exists", `файл ${fileName} уже существует — укажите новый version`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  if (active >= cfg.maxConcurrency) throw httpError(429, "busy", "воркер занят, повторите позже");
  active++;
  const startedAt = Date.now();
  const ac = new AbortController();
  const jobTimer = setTimeout(() => ac.abort(), cfg.jobTimeoutMs);
  let dir = null;
  try {
    await resolveAndCheck(check.url.hostname);
    await mkdir(cfg.mediaDir, { recursive: true });
    dir = await mkdtemp(path.join(tmpdir(), "cw-"));
    const input = path.join(dir, "input.bin");
    const output = path.join(dir, "output.mp4");
    const bytesIn = await download(check.url.href, input, ac.signal);

    const { src, out, checksum } = await processLocalFile(input, output, ac.signal);
    const tmpTarget = `${target}.${process.pid}.tmp`;
    await rename(output, tmpTarget).catch(async () => {
      // tmpdir на другом диске — копируем, затем переименовываем в том же каталоге.
      const { copyFile } = await import("node:fs/promises");
      await copyFile(output, tmpTarget);
    });
    await rename(tmpTarget, target); // атомарно в пределах файловой системы
    const finalStat = await stat(target);

    const result = {
      ok: true,
      url: `${cfg.publicBase}/${fileName}`,
      file: fileName,
      path: target,
      size_bytes: finalStat.size,
      duration_seconds: Math.round(out.duration * 100) / 100,
      width: out.width,
      height: out.height,
      video_codec: out.videoCodec,
      audio_codec: out.audioCodec,
      pix_fmt: out.pixFmt,
      checksum_sha256: checksum,
      source: { bytes: bytesIn, width: src.width, height: src.height, video_codec: src.videoCodec, audio_codec: src.audioCodec, duration_seconds: src.duration },
      took_ms: Date.now() - startedAt,
    };
    log("info", "normalized", { content_id: contentId, file: fileName, took_ms: result.took_ms, size_bytes: finalStat.size });
    return result;
  } finally {
    clearTimeout(jobTimer);
    active--;
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function gc(keepDays) {
  const days = Math.max(1, Number(keepDays ?? 30));
  const cutoff = Date.now() - days * 86_400_000;
  const removed = [];
  for (const name of await readdir(cfg.mediaDir).catch(() => [])) {
    if (!/\.mp4$/.test(name)) continue;
    const full = path.join(cfg.mediaDir, name);
    const s = await stat(full).catch(() => null);
    if (s && s.mtimeMs < cutoff) {
      await rm(full, { force: true });
      removed.push(name);
    }
  }
  // Осиротевшие временные файлы (прерванный rename).
  for (const name of await readdir(cfg.mediaDir).catch(() => [])) {
    if (/\.tmp$/.test(name)) {
      const full = path.join(cfg.mediaDir, name);
      const s = await stat(full).catch(() => null);
      if (s && s.mtimeMs < Date.now() - 3_600_000) await rm(full, { force: true });
    }
  }
  return { ok: true, removed, keep_days: days };
}

/* ───────────────────────────── HTTP ───────────────────────────── */

function authorized(req) {
  const header = req.headers["x-worker-token"] ?? (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!header || header.length !== cfg.token.length) return false;
  let diff = 0;
  for (let i = 0; i < cfg.token.length; i++) diff |= header.charCodeAt(i) ^ cfg.token.charCodeAt(i);
  return diff === 0;
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) {
        reject(httpError(413, "body_too_large", "тело запроса слишком большое"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(httpError(400, "bad_json", "некорректный JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://worker");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const [ffmpegOk, ffprobeOk, disk] = await Promise.all([
        run(cfg.ffmpeg, ["-version"], { timeoutMs: 10_000 }).then(() => true).catch(() => false),
        run(cfg.ffprobe, ["-version"], { timeoutMs: 10_000 }).then(() => true).catch(() => false),
        diskStatus(),
      ]);
      return send(res, ffmpegOk && ffprobeOk ? 200 : 503, {
        ok: ffmpegOk && ffprobeOk,
        ffmpeg: ffmpegOk,
        ffprobe: ffprobeOk,
        active_jobs: active,
        max_concurrency: cfg.maxConcurrency,
        disk,
        target: `${cfg.width}x${cfg.height}`,
      });
    }
    if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
    const body = await readJson(req);
    if (url.pathname === "/normalize") return send(res, 200, await normalize(body));
    if (url.pathname === "/gc") return send(res, 200, await gc(body.keep_days));
    return send(res, 404, { error: "not_found" });
  } catch (e) {
    const status = e?.status ?? 500;
    log(status >= 500 ? "error" : "warn", "request_failed", { path: url.pathname, code: e?.code ?? "internal", message: String(e?.message ?? e).slice(0, 500) });
    return send(res, status, { error: e?.code ?? "internal", message: String(e?.message ?? e).slice(0, 500) });
  }
});

server.requestTimeout = cfg.jobTimeoutMs + 60_000;
server.headersTimeout = 30_000;

/* ───────────────────────────── self-test ───────────────────────────── */

/** node server.mjs --self-test: синтетический клип → тот же путь, что и /normalize. */
async function selfTest() {
  const dir = await mkdtemp(path.join(tmpdir(), "cw-selftest-"));
  try {
    const input = path.join(dir, "src.mp4");
    const output = path.join(dir, "out.mp4");
    await run(cfg.ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv444p", "-c:a", "aac", input,
    ], { timeoutMs: 60_000 });
    const t0 = Date.now();
    const r = await processLocalFile(input, output, undefined);
    const outStat = await stat(output);
    console.log(JSON.stringify({
      ok: true,
      took_ms: Date.now() - t0,
      source: { width: r.src.width, height: r.src.height, pix_fmt: r.src.pixFmt, video_codec: r.src.videoCodec },
      result: { width: r.out.width, height: r.out.height, pix_fmt: r.out.pixFmt, video_codec: r.out.videoCodec, audio_codec: r.out.audioCodec, duration_seconds: r.out.duration, size_bytes: outStat.size, checksum_sha256: r.checksum },
    }, null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv.includes("--self-test")) {
  selfTest().then(() => process.exit(0)).catch((e) => {
    console.error(JSON.stringify({ ok: false, error: e?.code ?? "internal", message: String(e?.message ?? e) }));
    process.exit(1);
  });
} else {
  server.listen(cfg.port, cfg.bind, () => {
    log("info", "listening", { bind: cfg.bind, port: cfg.port, media_dir: cfg.mediaDir, allowed_hosts: cfg.allowedHosts });
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log("info", "shutdown", { signal: sig, active_jobs: active });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
