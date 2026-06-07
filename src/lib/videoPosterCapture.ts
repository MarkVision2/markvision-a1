// Захват вертикального постера 1080×1920 из mp4-видео в браузере
// и заливка его в Supabase Storage через edge-функцию meta-poster-upload.
//
// Используем глобальную очередь (max 2 параллельно), чтобы не положить
// сеть/декодер при первом скролле сетки креативов.

import { supabase } from "@/integrations/supabase/client";

interface QueueItem {
  adId: string;
  videoUrl: string;
  resolve: (url: string | null) => void;
}

const queue: QueueItem[] = [];
let active = 0;
const MAX_PARALLEL = 2;
const inflight = new Set<string>();
const cache = new Map<string, string>(); // adId -> poster public url

function pump() {
  while (active < MAX_PARALLEL && queue.length > 0) {
    const item = queue.shift()!;
    active++;
    void runOne(item).finally(() => {
      active--;
      pump();
    });
  }
}

async function runOne({ adId, videoUrl, resolve }: QueueItem) {
  try {
    if (cache.has(adId)) {
      resolve(cache.get(adId)!);
      return;
    }
    const blob = await captureFrame(videoUrl);
    if (!blob) {
      resolve(null);
      return;
    }
    const b64 = await blobToBase64(blob);
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; poster_url?: string }>(
      "meta-poster-upload",
      { body: { ad_id: adId, image_base64: b64 } },
    );
    if (error || !data?.ok || !data.poster_url) {
      resolve(null);
      return;
    }
    cache.set(adId, data.poster_url);
    resolve(data.poster_url);
  } catch {
    resolve(null);
  } finally {
    inflight.delete(adId);
  }
}

function captureFrame(videoUrl: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = videoUrl;
    let done = false;
    const cleanup = () => {
      v.removeAttribute("src");
      try { v.load(); } catch { /* */ }
    };
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const fail = () => {
      if (done) return;
      done = true;
      if (timeoutId) clearTimeout(timeoutId);
      cleanup();
      resolve(null);
    };
    const success = (blob: Blob | null) => {
      if (done) return;
      done = true;
      if (timeoutId) clearTimeout(timeoutId);
      cleanup();
      resolve(blob);
    };
    v.addEventListener("error", fail, { once: true });
    timeoutId = setTimeout(fail, 15_000); // hard timeout

    v.addEventListener("loadedmetadata", () => {
      // Перематываем чуть-чуть, чтобы получить осмысленный кадр
      try {
        v.currentTime = Math.min(0.3, (v.duration || 1) * 0.05);
      } catch { fail(); }
    }, { once: true });

    v.addEventListener("seeked", () => {
      try {
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        if (!vw || !vh) return fail();
        // Целевой размер — фиксируем по большей стороне до 1280, сохраняя пропорции
        const maxSide = 1920;
        const scale = Math.min(1, maxSide / Math.max(vw, vh));
        const w = Math.round(vw * scale);
        const h = Math.round(vh * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return fail();
        ctx.drawImage(v, 0, 0, w, h);
        c.toBlob((b) => success(b), "image/jpeg", 0.85);
      } catch { fail(); }
    }, { once: true });
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const result = r.result as string;
      // Возвращаем чистый base64 без префикса data:
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Запросить захват постера. Резолвится URL'ом постера или null. Идемпотентно. */
export function enqueuePosterCapture(adId: string, videoUrl: string): Promise<string | null> {
  if (cache.has(adId)) return Promise.resolve(cache.get(adId)!);
  if (inflight.has(adId)) {
    // Уже в работе — подождём результат через polling кэша
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (cache.has(adId)) { clearInterval(t); resolve(cache.get(adId)!); }
        else if (!inflight.has(adId)) { clearInterval(t); resolve(null); }
      }, 250);
    });
  }
  inflight.add(adId);
  return new Promise<string | null>((resolve) => {
    queue.push({ adId, videoUrl, resolve });
    pump();
  });
}
