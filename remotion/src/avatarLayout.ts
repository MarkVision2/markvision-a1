// Геометрия и тайминги композиции ReelsAvatar (аватар поверх анимации).
// Чистый модуль без React и без импортов CSS — покрыт vitest'ом
// (src/test/avatarLayout.test.ts), потому что именно здесь ошибаются:
// перекрытия сцен, аватар меньше нормы, раскладка не из списка.
// Правила — .claude/skills/content-factory/templates/scenes.md.

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/** Безопасные поля 9:16: сверху шапка площадки, снизу подпись и кнопки. */
export const SAFE = { top: 220, bottom: 320, side: 60 } as const;

/** Круглый аватар — не меньше 28 % ширины кадра (реальная ошибка: был в 1,5 раза меньше). */
export const MIN_CIRCLE_RATIO = 0.28;

export const LAYOUTS = ["avatar_full", "avatar_bottom", "avatar_circle", "content_full"] as const;
export type Layout = (typeof LAYOUTS)[number];

export type AvatarScene = {
  from_ms: number;
  to_ms: number;
  layout: Layout | string;
  title?: string | null;
  bullets?: string[];
  visual?: "stat" | "list" | "quote" | "compare" | string | null;
  /** Для visual = "stat" / "compare". */
  value?: string | null;
  label?: string | null;
  left?: string | null;
  right?: string | null;
};

export type AvatarWord = { text: string; from_ms: number; to_ms?: number; accent?: boolean };

/** Сцена, пересчитанная в кадры: [from, to) — to не входит, чтобы не было дублей на стыке. */
export type FrameScene = AvatarScene & { layout: Layout; from: number; to: number };

export const msToFrames = (ms: number, fps: number): number => Math.round((ms / 1000) * fps);

export function isLayout(value: unknown): value is Layout {
  return typeof value === "string" && (LAYOUTS as readonly string[]).includes(value);
}

/**
 * Сцены в кадрах: неизвестная раскладка → avatar_full (рендер не должен падать
 * на опечатке, критик такие ловит отдельно), границы приводятся к возрастающим.
 */
export function toFrameScenes(scenes: readonly AvatarScene[], fps: number): FrameScene[] {
  const out: FrameScene[] = [];
  for (const s of scenes) {
    const from = Math.max(0, msToFrames(s.from_ms, fps));
    const to = Math.max(from + 1, msToFrames(s.to_ms, fps));
    out.push({ ...s, layout: isLayout(s.layout) ? s.layout : "avatar_full", from, to });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Индекс активной сцены на кадре; -1 до первой сцены. Последняя держится до конца. */
export function activeSceneIndex(scenes: readonly FrameScene[], frame: number): number {
  let idx = -1;
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].from <= frame) idx = i;
    else break;
  }
  if (idx >= 0 && frame >= scenes[idx].to && idx === scenes.length - 1) return idx;
  return idx;
}

export type Geometry = { left: number; top: number; width: number; height: number; radius: number; opacity: number };

/** Где и какого размера аватар в каждой раскладке. */
export function avatarGeometry(layout: Layout): Geometry {
  switch (layout) {
    case "avatar_bottom": {
      const height = Math.round(CANVAS_H * 0.34);
      return { left: 0, top: CANVAS_H - height, width: CANVAS_W, height, radius: 0, opacity: 1 };
    }
    case "avatar_circle": {
      const size = Math.round(CANVAS_W * 0.38);
      return {
        left: CANVAS_W - SAFE.side - size,
        top: CANVAS_H - SAFE.bottom - size,
        width: size,
        height: size,
        radius: size / 2,
        opacity: 1,
      };
    }
    case "content_full":
      // Аватар не виден, но звук идёт: элемент остаётся смонтированным, только прозрачным.
      return { left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, radius: 0, opacity: 0 };
    case "avatar_full":
    default:
      return { left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, radius: 0, opacity: 1 };
  }
}

/** Область контента: непрозрачная подложка нужна там, где аватар не должен просвечивать. */
export function contentBox(layout: Layout): { top: number; height: number; opaque: boolean } {
  switch (layout) {
    case "avatar_bottom":
      return { top: 0, height: CANVAS_H - Math.round(CANVAS_H * 0.34), opaque: true };
    case "avatar_circle":
    case "content_full":
      return { top: 0, height: CANVAS_H, opaque: true };
    case "avatar_full":
    default:
      return { top: 0, height: CANVAS_H, opaque: false };
  }
}

/** Круг рисуется поверх контента, во всех остальных раскладках — под ним. */
export const avatarAboveContent = (layout: Layout): boolean => layout === "avatar_circle";

export function lerpGeometry(a: Geometry, b: Geometry, t: number): Geometry {
  const k = Math.min(1, Math.max(0, t));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    left: mix(a.left, b.left),
    top: mix(a.top, b.top),
    width: mix(a.width, b.width),
    height: mix(a.height, b.height),
    radius: mix(a.radius, b.radius),
    opacity: mix(a.opacity, b.opacity),
  };
}

/** Сколько титр держится на экране после конца последнего слова. */
export const CAPTION_TAIL_MS = 600;

/**
 * Слова текущего фрагмента титров: до `size` слов, заканчивая произносимым сейчас.
 * После конца последнего слова титр гаснет через CAPTION_TAIL_MS — иначе он висит
 * до конца ролика (в паузах и на CTA), хотя речь давно кончилась.
 */
export function captionChunk(
  words: readonly AvatarWord[],
  frameMs: number,
  size = 3,
  tailMs = CAPTION_TAIL_MS,
): AvatarWord[] {
  let ci = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].from_ms <= frameMs) ci = i;
    else break;
  }
  if (ci < 0) return [];
  const end = words[ci].to_ms;
  if (end != null && frameMs >= end + tailMs) return [];
  const start = Math.floor(ci / size) * size;
  return words.slice(start, ci + 1);
}

export type SceneProblem = { index: number; kind: string; note: string };

/**
 * Проверки, которые делает критик сцен (этап 7): дыры и перекрытия по времени,
 * раскладка не из четырёх, круг меньше нормы, сцена без содержимого,
 * расхождение конца последней сцены с длительностью аватара.
 */
export function validateScenes(
  scenes: readonly AvatarScene[],
  opts: { fps: number; avatarDurationMs?: number; toleranceMs?: number } = { fps: 30 },
): SceneProblem[] {
  const fps = opts.fps || 30;
  const tol = opts.toleranceMs ?? 100;
  const problems: SceneProblem[] = [];

  scenes.forEach((s, i) => {
    if (!isLayout(s.layout)) problems.push({ index: i, kind: "layout", note: `раскладка «${String(s.layout)}» не из четырёх` });
    if (s.to_ms <= s.from_ms) problems.push({ index: i, kind: "duration", note: "конец сцены не позже начала" });
    const hasContent = Boolean(s.title || s.bullets?.length || s.value || s.left);
    if (s.layout !== "avatar_full" && !hasContent) {
      problems.push({ index: i, kind: "empty", note: "сцена без текста и без визуала" });
    }
    if (i > 0) {
      const prev = scenes[i - 1];
      if (s.from_ms > prev.to_ms) problems.push({ index: i, kind: "gap", note: `дыра ${s.from_ms - prev.to_ms} мс после предыдущей сцены` });
      if (s.from_ms < prev.to_ms) problems.push({ index: i, kind: "overlap", note: `перекрытие ${prev.to_ms - s.from_ms} мс с предыдущей сценой` });
    }
  });
  const framed = toFrameScenes(scenes, fps);

  if (framed.length && framed[0].from > 0) {
    problems.push({ index: 0, kind: "gap", note: "первая сцена начинается не с нуля" });
  }
  const circle = avatarGeometry("avatar_circle");
  if (circle.width < CANVAS_W * MIN_CIRCLE_RATIO) {
    problems.push({ index: -1, kind: "size", note: "круглый аватар меньше 28 % ширины кадра" });
  }
  if (opts.avatarDurationMs != null && framed.length) {
    const end = scenes[scenes.length - 1].to_ms;
    if (Math.abs(end - opts.avatarDurationMs) > tol) {
      problems.push({
        index: framed.length - 1,
        kind: "duration_mismatch",
        note: `сцены кончаются на ${end} мс, аватар длится ${opts.avatarDurationMs} мс`,
      });
    }
  }
  return problems;
}
