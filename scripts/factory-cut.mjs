#!/usr/bin/env node
/**
 * Контент-завод, этап 6: режет длинное видео аватара на отдельные ролики по паузам.
 *
 *   node scripts/factory-cut.mjs <long.mp4> <outdir> [--ids id1,id2,…] [--min-silence 3] [--noise -35dB] [--pad 0.15]
 *
 * Все сценарии одного аккаунта озвучиваются одним заходом с паузой 5 с между ними; здесь
 * ffmpeg silencedetect находит паузы ≥ min-silence и вырезает отрезки между ними.
 * Имена файлов — из --ids по порядку (столько же, сколько отрезков), иначе part-01.mp4….
 * Видео перекодируется (libx264 crf 15), звук — aac без обработки; никакой нормализации.
 * Печатает JSON со списком отрезков; код возврата 2, если число отрезков ≠ числу id.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** Паузы [{start,end}] из silencedetect. Чистая функция — вынесена ради теста. */
export function parseSilences(stderr) {
  const out = [];
  let start = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start != null) { out.push({ start, end: Number(e[1]) }); start = null; }
  }
  return out;
}

/** Отрезки речи между паузами; края отрезков расширяются на pad, но не залезают в соседа. */
export function segmentsFromSilences(silences, total, padSec) {
  const segs = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start - cursor > 0.5) segs.push({ from: cursor, to: s.start });
    cursor = s.end;
  }
  if (total - cursor > 0.5) segs.push({ from: cursor, to: total });
  return segs.map((seg, i) => ({
    from: Math.max(i === 0 ? 0 : segs[i - 1].to, seg.from - padSec),
    to: Math.min(i === segs.length - 1 ? total : segs[i + 1].from, seg.to + padSec),
  }));
}

function probeDuration(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe: ${r.stderr}`);
  return Number(r.stdout.trim());
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const [, , input, outdir] = process.argv;
  if (!input || !outdir) {
    console.error("usage: factory-cut.mjs <long.mp4> <outdir> [--ids a,b,c] [--min-silence 3] [--noise -35dB] [--pad 0.15]");
    process.exit(1);
  }
  if (!existsSync(input)) { console.error(`нет файла: ${input}`); process.exit(1); }
  const minSilence = Number(arg("--min-silence", "3"));
  const noise = arg("--noise", "-35dB");
  const pad = Number(arg("--pad", "0.15"));
  const ids = arg("--ids", "").split(",").map((s) => s.trim()).filter(Boolean);

  const total = probeDuration(input);
  const det = spawnSync("ffmpeg", ["-hide_banner", "-i", input, "-af", `silencedetect=noise=${noise}:d=${minSilence}`, "-f", "null", "-"], { encoding: "utf8" });
  const silences = parseSilences(det.stderr);
  const segments = segmentsFromSilences(silences, total, pad);

  if (ids.length && ids.length !== segments.length) {
    console.error(`отрезков ${segments.length}, а id передано ${ids.length}: проверьте паузы (--min-silence/--noise)`);
    console.error(JSON.stringify(segments));
    process.exit(2);
  }
  mkdirSync(outdir, { recursive: true });
  const result = segments.map((seg, i) => {
    const name = ids[i] ?? `part-${String(i + 1).padStart(2, "0")}`;
    const file = join(outdir, `${name}.mp4`);
    const r = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-ss", seg.from.toFixed(3), "-to", seg.to.toFixed(3), "-i", input,
      "-c:v", "libx264", "-crf", "15", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", file,
    ], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`ffmpeg ${file}: ${r.stderr}`);
    return { id: name, file, from: seg.from, to: seg.to, duration: Number((seg.to - seg.from).toFixed(3)) };
  });
  console.log(JSON.stringify({ input, total, silences: silences.length, segments: result }, null, 2));
}
