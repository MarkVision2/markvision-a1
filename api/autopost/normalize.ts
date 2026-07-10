// Нормализация видео перед публикацией в Instagram — устраняет самую частую
// причину отказа "Media upload has failed with error code 2207052" (Instagram
// не смог обработать медиа), которую мы диагностировали на реальном упавшем
// автопосте: атом moov в конце файла вместо начала. Обычные экспорты (не через
// ffmpeg с -movflags +faststart) кладут moov в конец — Instagram читает файл
// потоково и не успевает добраться до метаданных, из-за чего файл выглядит
// "нечитаемым", хотя по обычной HTTP-ссылке скачивается прекрасно.
//
// Supabase Edge Functions (Deno) не умеют запускать сторонние бинарники —
// поэтому сам ffmpeg-проход живёт здесь, как обычная Vercel Node-функция
// (тот же паттерн, что и api/montage/burn.ts).
//
// Вход: POST { source_url: string; upload_url: string }
// Выход: { ok: true }
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";

// С запасом под лимит Reels/каруселей в приложении (500 МБ) — но полный
// ре-энкод (шаг 2 ниже) на серверлесс-функции с ограничением по времени не
// должен упираться в таймаут, поэтому здесь порог ниже, чем на клиенте.
const MAX_INPUT_BYTES = 300 * 1024 * 1024;

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

interface VercelReq { method?: string; body?: unknown }
interface VercelRes {
  status(code: number): VercelRes;
  json(body: unknown): void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const sourceUrl = String(body.source_url ?? "").trim();
  const uploadUrl = String(body.upload_url ?? "").trim();
  if (!sourceUrl) return res.status(400).json({ error: "source_url обязателен" });
  if (!uploadUrl) return res.status(400).json({ error: "upload_url обязателен" });

  let dir: string | null = null;
  try {
    const srcRes = await fetch(sourceUrl);
    if (!srcRes.ok) return res.status(502).json({ error: `Не удалось скачать видео (HTTP ${srcRes.status})` });
    const inputBuf = Buffer.from(await srcRes.arrayBuffer());
    if (inputBuf.byteLength > MAX_INPUT_BYTES) {
      return res.status(413).json({ error: `Видео больше ${MAX_INPUT_BYTES / 1024 / 1024} МБ — нормализация пропущена` });
    }

    dir = await mkdtemp(path.join(tmpdir(), "autopost-"));
    const inputPath = path.join(dir, "input.mp4");
    const outputPath = path.join(dir, "output.mp4");
    await writeFile(inputPath, inputBuf);

    // Шаг 1 — быстрый remux без потери качества: просто переносим moov вперёд
    // (-c copy, никакого перекодирования) — секунды вне зависимости от размера
    // файла. Устраняет ту самую частую причину отказа.
    try {
      await runFfmpeg(["-y", "-i", inputPath, "-c", "copy", "-movflags", "+faststart", outputPath]);
    } catch {
      // Шаг 2 — remux не удался: контейнер/кодек несовместим (экзотический
      // кодек, битый поток и т.п.) — перекодируем в гарантированно совместимый
      // H.264/AAC. Медленнее, но надёжно устраняет любые проблемы формата.
      await runFfmpeg([
        "-y", "-i", inputPath,
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
        "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-movflags", "+faststart",
        outputPath,
      ]);
    }

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
