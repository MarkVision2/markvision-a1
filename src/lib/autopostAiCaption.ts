/** Compress local images / video frames for vision caption generation. */
import { isVideoFile, schedulerApi } from "@/lib/autopostClient";

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

/** Meta Reels cover_url принимает только JPEG — PNG/WebP конвертим. */
export async function ensureJpegCoverFile(file: File, maxEdge = 1920): Promise<File> {
  if (file.type === "image/jpeg" || file.type === "image/jpg") return file;
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
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("Не удалось конвертировать обложку в JPEG");
  return new File([blob], `cover-${Date.now()}.jpg`, { type: "image/jpeg" });
}

export type CaptureFrameAt = number | { ratio?: number; seconds?: number };

function resolveCaptureTime(dur: number, at: CaptureFrameAt): number {
  const maxT = Math.max(dur - 0.05, 0);
  if (typeof at === "number") {
    // Legacy ratio 0..1 — без старого clamp 0.15, чтобы можно было взять кадр у старта.
    return Math.min(Math.max(dur * at, 0), maxT);
  }
  if (typeof at.seconds === "number" && Number.isFinite(at.seconds)) {
    return Math.min(Math.max(at.seconds, 0), maxT);
  }
  const ratio = typeof at.ratio === "number" ? at.ratio : 0.2;
  return Math.min(Math.max(dur * ratio, 0), maxT);
}

/** Capture a still frame from a local video File (for OCR + cover). */
export function captureFrameFromVideoFile(
  file: File,
  at: CaptureFrameAt = 0.2,
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
      try {
        video.load();
      } catch {
        /* */
      }
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
      const t = resolveCaptureTime(dur, at);
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
          0.92,
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
  projectId?: string | null;
}): Promise<string> {
  if (!input.files.length) throw new Error("Сначала загрузите медиа");

  const images = await pickImagesForCaption(input.files, input.mediaType);
  if (!images.length) throw new Error("Нет кадров для анализа");

  const res = await schedulerApi<{ ok?: boolean; caption?: string; error?: string }>(
    "ai_caption",
    {
      media_type: input.mediaType,
      title: input.title ?? "",
      images,
    },
    input.projectId,
  );

  if (!res?.ok || !res.caption) throw new Error(res?.error || "Пустой ответ AI");
  return res.caption.trim();
}
