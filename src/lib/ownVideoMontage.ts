// Монтаж своего видео без HeyGen: транскрипция (Whisper, montage-transcribe)
// уже определяет пословные таймкоды, здесь — прожиг субтитров через FFmpeg
// (api/montage/burn, Vercel Node-функция) и загрузка результата в R2.
//
// R2-загрузка результата переиспользует ту же presigned-схему, что и
// Автопостинг (r2-presign-upload + x-app-key) — секретов тут не требуется,
// сама burn-функция просто PUT'ит готовый файл по уже подписанному URL.
import { clientSupabasePublishableKey, clientSupabaseUrl } from "@/lib/supabaseConfig";
import type { TranscriptWord } from "@/hooks/useHeygen";

async function presignUpload(filename: string, contentType: string, size: number): Promise<{ uploadUrl: string; publicUrl: string }> {
  const res = await fetch(`${clientSupabaseUrl}/functions/v1/r2-presign-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-key": clientSupabasePublishableKey },
    body: JSON.stringify({ filename, contentType, size }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.error) throw new Error(j?.error || `Не удалось получить ссылку для загрузки (HTTP ${res.status})`);
  return { uploadUrl: j.uploadUrl as string, publicUrl: j.publicUrl as string };
}

/** Прожигает динамичные субтитры на видео и возвращает публичную ссылку на результат. */
export async function addDynamicCaptions(sourceUrl: string, sourceSizeBytes: number, words: TranscriptWord[]): Promise<string> {
  const { uploadUrl, publicUrl } = await presignUpload(`montage-${Date.now()}.mp4`, "video/mp4", sourceSizeBytes || 1);
  const res = await fetch("/api/montage/burn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_url: sourceUrl, words, upload_url: uploadUrl }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.error) throw new Error(j?.error || `Монтаж не удался (HTTP ${res.status})`);
  return publicUrl;
}
