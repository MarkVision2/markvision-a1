/**
 * Запекание визуального кропа (fit / zoom / pos), который пользователь
 * настроил в превью креатива, в готовый файл нужного аспекта.
 *
 * Главная идея: пересчитать «что именно видно в фрейме» в координатах
 * исходного медиа (sx, sy, sw, sh — пиксели исходника), а затем отрендерить
 * этот прямоугольник в canvas (для фото) или вырезать через ffmpeg crop+scale
 * (для видео).
 *
 * Геометрия (повторяет CSS):
 *   contain: media полностью вписана в frame, по короткой стороне ничего
 *            не обрезано (есть поля).
 *   cover : media полностью закрывает frame, по длинной стороне обрезано.
 * Затем применяется translate(pos) и scale(zoom) от центра.
 */

export type Fit = "contain" | "cover";

/** Геометрия кропа без natural-размера (его вытащим из файла). */
export interface ViewParams {
  ratio: string;
  fit: Fit;
  zoom: number;
  pos: { x: number; y: number };
  frame: { w: number; h: number };
}

export interface CropParams extends ViewParams {
  /** Желаемый аспект выходного файла, например "4:5" или "9:16". */
  /** Натуральный размер исходного медиа в пикселях. */
  natural: { w: number; h: number };
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  outW: number;
  outH: number;
}

/**
 * Рассчитывает, какой прямоугольник исходника попадает в выходной кадр.
 * Возвращает координаты в пикселях исходника + размер выходного кадра.
 */
export function computeSourceRect(p: CropParams): SourceRect {
  const [ratioWStr, ratioHStr] = p.ratio.split(":");
  const ratioW = Number(ratioWStr) || 1;
  const ratioH = Number(ratioHStr) || 1;
  const targetAspect = ratioW / ratioH;

  // Размер media внутри frame после object-fit (без zoom/pos):
  const naturalAspect = p.natural.w / p.natural.h;
  let fittedW: number;
  let fittedH: number;
  if (p.fit === "contain") {
    if (naturalAspect > p.frame.w / p.frame.h) {
      fittedW = p.frame.w;
      fittedH = p.frame.w / naturalAspect;
    } else {
      fittedH = p.frame.h;
      fittedW = p.frame.h * naturalAspect;
    }
  } else {
    // cover
    if (naturalAspect > p.frame.w / p.frame.h) {
      fittedH = p.frame.h;
      fittedW = p.frame.h * naturalAspect;
    } else {
      fittedW = p.frame.w;
      fittedH = p.frame.w / naturalAspect;
    }
  }

  // Применяем zoom от центра и translate(pos):
  const scaledW = fittedW * p.zoom;
  const scaledH = fittedH * p.zoom;
  const cx = p.frame.w / 2 + p.pos.x; // центр media в координатах frame
  const cy = p.frame.h / 2 + p.pos.y;
  // Прямоугольник media в координатах frame:
  const mediaLeft = cx - scaledW / 2;
  const mediaTop = cy - scaledH / 2;

  // Обратное преобразование: точка frame (fx, fy) → точка исходника:
  //   srcX = (fx - mediaLeft) / scaledW * natural.w
  //   srcY = (fy - mediaTop)  / scaledH * natural.h
  const toSrc = (fx: number, fy: number) => ({
    x: ((fx - mediaLeft) / scaledW) * p.natural.w,
    y: ((fy - mediaTop) / scaledH) * p.natural.h,
  });

  const tl = toSrc(0, 0);
  const br = toSrc(p.frame.w, p.frame.h);

  // Клипуем по границам исходника (если в кадре есть «пустота» — будет letterbox):
  const clip = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const sxRaw = tl.x;
  const syRaw = tl.y;
  const swRaw = br.x - tl.x;
  const shRaw = br.y - tl.y;

  const sx = clip(sxRaw, p.natural.w);
  const sy = clip(syRaw, p.natural.h);
  const sw = clip(sxRaw + swRaw, p.natural.w) - sx;
  const sh = clip(syRaw + shRaw, p.natural.h) - sy;

  // Размер выхода: подгоняем под целевой аспект, используя короткую сторону
  // исходника как опору, чтобы не апскейлить.
  let outH = Math.round(sh);
  let outW = Math.round(outH * targetAspect);
  if (outW > Math.round(sw) + 2) {
    outW = Math.round(sw);
    outH = Math.round(outW / targetAspect);
  }
  // Чётные размеры — требование большинства видео-кодеков (yuv420p):
  outW = outW - (outW % 2);
  outH = outH - (outH % 2);

  return { sx, sy, sw, sh, outW, outH };
}

/** Запекает фото в файл нужного аспекта через canvas. */
export async function cropImageFile(file: File, p: ViewParams): Promise<File> {
  const img = await loadImage(file);
  const natural = { w: img.naturalWidth, h: img.naturalHeight };
  const rect = computeSourceRect({ ...p, natural });

  const canvas = document.createElement("canvas");
  canvas.width = rect.outW;
  canvas.height = rect.outH;
  const ctx = canvas.getContext("2d")!;
  // Чёрная подложка на случай contain-полей:
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.outW, rect.outH);

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92),
  );
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}__${p.ratio.replace(":", "x")}.jpg`, {
    type: "image/jpeg",
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/* ============================ ВИДЕО (ffmpeg.wasm) ============================ */

let ffmpegInstance: import("@ffmpeg/ffmpeg").FFmpeg | null = null;
let ffmpegLoading: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

async function getFfmpeg(onProgress?: (p: number) => void) {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ff = new FFmpeg();
    if (onProgress) {
      ff.on("progress", ({ progress }) => onProgress(Math.min(99, Math.round(progress * 100))));
    }
    // Грузим ядро через CDN с правильным MIME (jsdelivr отдаёт application/wasm).
    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ff;
    return ff;
  })();
  return ffmpegLoading;
}

/** Запекает видео через ffmpeg crop+scale. Прогресс — 0..100. */
export async function cropVideoFile(
  file: File,
  p: ViewParams,
  onProgress?: (pct: number) => void,
): Promise<File> {
  // Натуральный размер видео нужен для геометрии — берём из <video>.
  const natural = await readVideoSize(file);
  const rect = computeSourceRect({ ...p, natural });

  const ff = await getFfmpeg(onProgress);
  const inputName = "in_" + sanitizeName(file.name);
  const outputName = "out.mp4";

  const { fetchFile } = await import("@ffmpeg/util");
  await ff.writeFile(inputName, await fetchFile(file));

  // crop=w:h:x:y, затем scale до выходного размера. Аудио копируем как есть.
  const vf = `crop=${Math.round(rect.sw)}:${Math.round(rect.sh)}:${Math.round(rect.sx)}:${Math.round(rect.sy)},scale=${rect.outW}:${rect.outH}`;

  await ff.exec([
    "-i", inputName,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-c:a", "aac",
    "-b:a", "128k",
    outputName,
  ]);

  const data = await ff.readFile(outputName);
  // Чистим временные файлы, чтобы не копились в виртуальной FS.
  try { await ff.deleteFile(inputName); } catch { /* ignore */ }
  try { await ff.deleteFile(outputName); } catch { /* ignore */ }

  const baseName = file.name.replace(/\.[^.]+$/, "");
  const blob = new Blob([data as BlobPart], { type: "video/mp4" });
  onProgress?.(100);
  return new File([blob], `${baseName}__${p.ratio.replace(":", "x")}.mp4`, {
    type: "video/mp4",
  });
}

function readVideoSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      const size = { w: v.videoWidth, h: v.videoHeight };
      URL.revokeObjectURL(url);
      resolve(size);
    };
    v.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    v.src = url;
  });
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
