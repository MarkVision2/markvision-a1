#!/usr/bin/env node
/**
 * Контент-завод, этап 9: проверка готового ролика перед раскладкой по сети.
 *
 *   node scripts/factory-check.mjs <video.mp4> [ещё файлы…] [--width 1080] [--height 1920] [--tolerance 0.1]
 *
 * Правила (из практики: обложка, вклеенная кадром, удлиняла видео на секунду):
 *   - длительность видеодорожки = длительность аудиодорожки ± tolerance с;
 *   - разрешение ровно width×height (композиция равна целевому, иначе мыло);
 *   - есть аудиодорожка; длительность 3 с … 15 мин; размер < 1 ГБ (лимиты площадок).
 * Печатает JSON по каждому файлу; код возврата 1, если хоть один не прошёл.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const WIDTH = Number(arg("--width", "1080"));
const HEIGHT = Number(arg("--height", "1920"));
const TOL = Number(arg("--tolerance", "0.1"));
const MIN_SEC = 3;
const MAX_SEC = 15 * 60;
const MAX_BYTES = 1024 * 1024 * 1024;

/** Правила на разобранных данных — чистая функция ради теста. */
export function verify(info, opts = {}) {
  const width = opts.width ?? 1080, height = opts.height ?? 1920, tol = opts.tolerance ?? 0.1;
  const errors = [];
  if (!info.video) errors.push("нет видеодорожки");
  if (!info.audio) errors.push("нет аудиодорожки");
  if (info.video && info.audio && Math.abs(info.video.duration - info.audio.duration) > tol) {
    errors.push(`видео ${info.video.duration.toFixed(2)} с ≠ звук ${info.audio.duration.toFixed(2)} с (допуск ${tol} с)`);
  }
  if (info.video && (info.video.width !== width || info.video.height !== height)) {
    errors.push(`разрешение ${info.video.width}×${info.video.height}, нужно ${width}×${height}`);
  }
  const dur = info.video?.duration ?? info.format.duration;
  if (dur < MIN_SEC || dur > MAX_SEC) errors.push(`длительность ${dur.toFixed(1)} с вне ${MIN_SEC}–${MAX_SEC} с`);
  if (info.format.size > MAX_BYTES) errors.push(`размер ${(info.format.size / 1e6).toFixed(0)} МБ больше 1 ГБ`);
  return { ok: errors.length === 0, errors };
}

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const pick = (type) => j.streams.find((s) => s.codec_type === type);
  const v = pick("video"), a = pick("audio");
  const dur = (s) => Number(s?.duration ?? s?.tags?.DURATION ?? j.format.duration);
  return {
    format: { duration: Number(j.format.duration), size: Number(j.format.size ?? statSync(file).size) },
    video: v ? { width: Number(v.width), height: Number(v.height), duration: dur(v), codec: v.codec_name } : null,
    audio: a ? { duration: dur(a), codec: a.codec_name, sample_rate: Number(a.sample_rate) } : null,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const files = process.argv.slice(2).filter((x, i, all) => !x.startsWith("--") && !(all[i - 1] ?? "").startsWith("--"));
  if (!files.length) { console.error("usage: factory-check.mjs <video.mp4> [...]"); process.exit(1); }
  let failed = 0;
  const report = files.map((file) => {
    try {
      const info = probe(file);
      const res = verify(info, { width: WIDTH, height: HEIGHT, tolerance: TOL });
      if (!res.ok) failed += 1;
      return { file, ...res, video: info.video, audio: info.audio, size_bytes: info.format.size };
    } catch (e) {
      failed += 1;
      return { file, ok: false, errors: [e instanceof Error ? e.message : String(e)] };
    }
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed ? 1 : 0);
}
