// Прожигает динамичные (по словам) субтитры на уже готовое видео через FFmpeg —
// альтернатива HeyGen Video Agent для случая "видео уже есть, нужен только монтаж".
//
// Supabase Edge Functions (Deno) не умеют запускать сторонние бинарники —
// поэтому сам ffmpeg-проход живёт здесь, как обычная Vercel Node-функция.
// Секретов не требует: presigned upload-URL для результата браузер получает
// сам через существующий r2-presign-upload (как и обычная загрузка в
// Автопостинге) и передаёт сюда уже готовым — эта функция просто качает
// исходное видео, жжёт субтитры и кладёт результат по этому URL.
//
// Вход: POST { video_url: string; words: {word,start,end}[]; upload_url: string }
// Выход: { ok: true }
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

const FONT_PATH = path.join(process.cwd(), "api/montage/assets/DejaVuSans-Bold.ttf");
const MAX_INPUT_BYTES = 60 * 1024 * 1024; // с запасом сверх лимита транскрипции (50 МБ)
const WORDS_PER_CHUNK = 3; // 1 слово мигает слишком быстро для комфортного чтения, 3 — золотая середина

interface Word { word: string; start: number; end: number }
interface Chunk { text: string; start: number; end: number }

function chunkWords(words: Word[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
    const slice = words.slice(i, i + WORDS_PER_CHUNK);
    if (!slice.length) continue;
    chunks.push({
      text: slice.map((w) => w.word.trim()).filter(Boolean).join(" "),
      start: slice[0].start,
      end: slice[slice.length - 1].end,
    });
  }
  return chunks;
}

// drawtext использует свой мини-язык экранирования: одинарные кавычки,
// двоеточия и обратные слэши ломают парсинг фильтра, если их не escape'ить.
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’"); // одинарную кавычку заменяем на типографскую — экранировать её в drawtext крайне ненадёжно
}

function buildFilter(chunks: Chunk[]): string {
  return chunks
    .map((c) => {
      const text = escapeDrawtext(c.text.toUpperCase());
      return (
        `drawtext=fontfile='${FONT_PATH}':text='${text}':fontcolor=white:fontsize=64:` +
        `box=1:boxcolor=black@0.55:boxborderw=16:x=(w-text_w)/2:y=h*0.78:` +
        `enable='between(t,${c.start},${c.end})'`
      );
    })
    .join(",");
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg.path, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

// Минимальные типы вместо @vercel/node — не хотим тянуть лишнюю зависимость
// ради одной сигнатуры.
interface VercelReq { method?: string; body?: unknown }
interface VercelRes {
  status(code: number): VercelRes;
  json(body: unknown): void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const videoUrl = String(body.video_url ?? "").trim();
  const uploadUrl = String(body.upload_url ?? "").trim();
  const words = Array.isArray(body.words) ? (body.words as Word[]) : [];
  if (!videoUrl) return res.status(400).json({ error: "video_url обязателен" });
  if (!uploadUrl) return res.status(400).json({ error: "upload_url обязателен" });

  let dir: string | null = null;
  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) return res.status(502).json({ error: `Не удалось скачать видео (HTTP ${videoRes.status})` });
    const inputBuf = Buffer.from(await videoRes.arrayBuffer());
    if (inputBuf.byteLength > MAX_INPUT_BYTES) {
      return res.status(400).json({ error: `Видео больше ${MAX_INPUT_BYTES / 1024 / 1024} МБ` });
    }

    dir = await mkdtemp(path.join(tmpdir(), "montage-"));
    const inputPath = path.join(dir, "input.mp4");
    const outputPath = path.join(dir, "output.mp4");
    await writeFile(inputPath, inputBuf);

    const chunks = chunkWords(words);
    const args = ["-y", "-i", inputPath];
    if (chunks.length) args.push("-vf", buildFilter(chunks));
    args.push("-c:a", "copy", "-preset", "veryfast", "-crf", "20", outputPath);
    await runFfmpeg(args);

    const outputBuf = await readFile(outputPath);
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: outputBuf,
    });
    if (!putRes.ok) return res.status(502).json({ error: `Не удалось загрузить результат (HTTP ${putRes.status})` });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
