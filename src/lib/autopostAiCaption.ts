/** Compress local images / video frames for vision caption generation. */
import { supabase } from "@/integrations/supabase/client";
import { isVideoFile } from "@/lib/autopostClient";

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.72;
const MAX_SLIDES = 6;

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    img.src = url;
  });
}

export async function fileToJpegDataUrl(file: Blob, maxEdge = MAX_EDGE): Promise<string> {
  const img = await loadImageFromBlob(file);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

/** Capture a still frame from a local video File (for OCR + cover). */
export function captureFrameFromVideoFile(
  file: File,
  atRatio = 0.2,
): Promise<{ dataUrl: string; blob: Blob; file: File }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    let settled = false;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      try { video.load(); } catch { /* */ }
    };
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(msg));
    };
    const done = (blob: Blob, dataUrl: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        blob,
        dataUrl,
        file: new File([blob], `cover-${Date.now()}.jpg`, { type: "image/jpeg" }),
      });
    };

    const timeout = window.setTimeout(() => fail("Таймаут чтения видео"), 20_000);

    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const t = Math.min(Math.max(dur * atRatio, 0.15), Math.max(dur - 0.05, 0.15));
      try {
        video.currentTime = t;
      } catch {
        window.clearTimeout(timeout);
        fail("Не удалось перемотать видео");
      }
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = video.videoWidth || 1080;
        const h = video.videoHeight || 1920;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          window.clearTimeout(timeout);
          fail("Canvas недоступен");
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        canvas.toBlob(
          (blob) => {
            window.clearTimeout(timeout);
            if (!blob) {
              fail("Не удалось сохранить кадр");
              return;
            }
            done(blob, dataUrl);
          },
          "image/jpeg",
          0.9,
        );
      } catch (e) {
        window.clearTimeout(timeout);
        fail(e instanceof Error ? e.message : "Ошибка кадра");
      }
    };

    video.onerror = () => {
      window.clearTimeout(timeout);
      fail("Не удалось открыть видео");
    };
  });
}

async function pickImagesForCaption(files: File[], mediaType: string): Promise<string[]> {
  if (mediaType === "REELS" || (files.length === 1 && isVideoFile(files[0]))) {
    const frame = await captureFrameFromVideoFile(files[0], 0.25);
    return [frame.dataUrl];
  }

  const imageFiles = files.filter((f) => !isVideoFile(f));
  const picked =
    imageFiles.length <= MAX_SLIDES
      ? imageFiles
      : [
          imageFiles[0],
          ...imageFiles.slice(1, MAX_SLIDES - 1),
          imageFiles[imageFiles.length - 1],
        ].filter(Boolean);

  const urls: string[] = [];
  for (const f of picked.slice(0, MAX_SLIDES)) {
    urls.push(await fileToJpegDataUrl(f));
  }
  return urls;
}

export async function generateAutopostCaption(input: {
  mediaType: string;
  title?: string;
  files: File[];
}): Promise<string> {
  if (!input.files.length) throw new Error("Сначала загрузите медиа");

  const images = await pickImagesForCaption(input.files, input.mediaType);
  if (!images.length) throw new Error("Нет кадров для анализа");

  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    caption?: string;
    error?: string;
  }>("autopost-ai-caption", {
    body: {
      mediaType: input.mediaType,
      title: input.title ?? "",
      images,
    },
  });

  if (error) throw new Error(error.message || "Не удалось сгенерировать описание");
  if (!data?.ok || !data.caption) throw new Error(data?.error || "Пустой ответ AI");
  return data.caption.trim();
}
