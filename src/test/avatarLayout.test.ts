/**
 * Геометрия и тайминги композиции ReelsAvatar (аватар поверх анимации):
 * раскладки, переходы, титры и проверки критика сцен.
 */
import { describe, expect, it } from "vitest";
import {
  activeSceneIndex,
  avatarAboveContent,
  avatarGeometry,
  captionChunk,
  contentBox,
  CANVAS_H,
  CANVAS_W,
  isLayout,
  lerpGeometry,
  MIN_CIRCLE_RATIO,
  msToFrames,
  toFrameScenes,
  validateScenes,
  type AvatarScene,
} from "../../remotion/src/avatarLayout.ts";

const scene = (from_ms: number, to_ms: number, layout: string, extra: Partial<AvatarScene> = {}): AvatarScene =>
  ({ from_ms, to_ms, layout, title: "т", ...extra });

describe("геометрия раскладок", () => {
  it("аватар на весь кадр занимает всю композицию", () => {
    expect(avatarGeometry("avatar_full")).toMatchObject({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, opacity: 1 });
  });

  it("аватар снизу — нижняя треть, контент занимает остальное без наложения", () => {
    const g = avatarGeometry("avatar_bottom");
    const box = contentBox("avatar_bottom");
    expect(g.top + g.height).toBe(CANVAS_H);
    expect(box.top + box.height).toBe(g.top);
    expect(box.opaque).toBe(true);
  });

  it("круглый аватар не меньше 28 % ширины, вписан в безопасные поля и лежит поверх контента", () => {
    const g = avatarGeometry("avatar_circle");
    expect(g.width).toBeGreaterThanOrEqual(CANVAS_W * MIN_CIRCLE_RATIO);
    expect(g.radius).toBe(g.width / 2);
    expect(g.left + g.width).toBe(CANVAS_W - 60);
    expect(g.top + g.height).toBe(CANVAS_H - 320);
    expect(avatarAboveContent("avatar_circle")).toBe(true);
    expect(avatarAboveContent("avatar_full")).toBe(false);
  });

  it("контент на весь экран прячет аватар прозрачностью, не размонтируя его (звук идёт)", () => {
    const g = avatarGeometry("content_full");
    expect(g.opacity).toBe(0);
    expect(g.width).toBe(CANVAS_W);
    expect(contentBox("content_full").opaque).toBe(true);
  });

  it("в avatar_full подложка контента прозрачная — иначе видео не видно", () => {
    expect(contentBox("avatar_full").opaque).toBe(false);
  });

  it("переход между раскладками интерполируется покадрово", () => {
    const a = avatarGeometry("avatar_full");
    const b = avatarGeometry("avatar_circle");
    expect(lerpGeometry(a, b, 0)).toEqual(a);
    expect(lerpGeometry(a, b, 1)).toEqual(b);
    const mid = lerpGeometry(a, b, 0.5);
    expect(mid.width).toBeCloseTo((a.width + b.width) / 2);
    expect(lerpGeometry(a, b, 5).width).toBe(b.width);
  });
});

describe("тайминги сцен", () => {
  it("миллисекунды переводятся в кадры по частоте", () => {
    expect(msToFrames(0, 30)).toBe(0);
    expect(msToFrames(4200, 30)).toBe(126);
    expect(msToFrames(1000, 25)).toBe(25);
  });

  it("сцены сортируются, неизвестная раскладка становится avatar_full", () => {
    const framed = toFrameScenes([scene(4000, 8000, "avatar_bottom"), scene(0, 4000, "чепуха")], 30);
    expect(framed.map((s) => s.from)).toEqual([0, 120]);
    expect(framed[0].layout).toBe("avatar_full");
    expect(isLayout("чепуха")).toBe(false);
  });

  it("активная сцена по кадру; последняя держится до конца ролика", () => {
    const framed = toFrameScenes([scene(0, 4000, "avatar_full"), scene(4000, 9000, "avatar_bottom")], 30);
    expect(activeSceneIndex(framed, 0)).toBe(0);
    expect(activeSceneIndex(framed, 119)).toBe(0);
    expect(activeSceneIndex(framed, 120)).toBe(1);
    expect(activeSceneIndex(framed, 5000)).toBe(1);
  });
});

describe("титры", () => {
  const words = [
    { text: "Один", from_ms: 300 },
    { text: "аккаунт", from_ms: 700 },
    { text: "растёт", from_ms: 1200 },
    { text: "год", from_ms: 1700 },
  ];

  it("до первого слова титров нет", () => {
    expect(captionChunk(words, 100)).toEqual([]);
  });

  it("фрагмент заканчивается произносимым словом и не длиннее размера группы", () => {
    expect(captionChunk(words, 800).map((w) => w.text)).toEqual(["Один", "аккаунт"]);
    expect(captionChunk(words, 1300).map((w) => w.text)).toEqual(["Один", "аккаунт", "растёт"]);
    expect(captionChunk(words, 1800).map((w) => w.text)).toEqual(["год"]);
  });

  it("после конца речи титр гаснет, а не висит до конца ролика", () => {
    const timed = [{ text: "год", from_ms: 1700, to_ms: 2200 }];
    expect(captionChunk(timed, 2500).map((w) => w.text)).toEqual(["год"]);
    expect(captionChunk(timed, 2800)).toEqual([]);
    expect(captionChunk(timed, 29000)).toEqual([]);
  });

  it("без to_ms слово держится — тайминги старого формата не ломают рендер", () => {
    expect(captionChunk([{ text: "год", from_ms: 1700 }], 29000).map((w) => w.text)).toEqual(["год"]);
  });
});

describe("проверки критика сцен", () => {
  it("ровная раскадровка без замечаний", () => {
    const ok: AvatarScene[] = [
      scene(0, 4000, "avatar_full"),
      scene(4000, 13000, "avatar_bottom", { visual: "stat", value: "92 %" }),
      scene(13000, 20000, "content_full", { visual: "quote" }),
    ];
    expect(validateScenes(ok, { fps: 30, avatarDurationMs: 20000 })).toEqual([]);
  });

  it("дыра, перекрытие, чужая раскладка и пустая сцена находятся по отдельности", () => {
    const bad: AvatarScene[] = [
      scene(0, 4000, "avatar_full"),
      scene(5000, 9000, "avatar_bottom"),
      scene(8000, 12000, "карусель", { title: "" }),
    ];
    const kinds = validateScenes(bad, { fps: 30 }).map((p) => p.kind);
    expect(kinds).toContain("gap");
    expect(kinds).toContain("overlap");
    expect(kinds).toContain("layout");
    expect(kinds).toContain("empty");
  });

  it("сцены короче или длиннее аватара — duration_mismatch с допуском 100 мс", () => {
    const s = [scene(0, 20000, "avatar_full")];
    expect(validateScenes(s, { fps: 30, avatarDurationMs: 20050 })).toEqual([]);
    const bad = validateScenes(s, { fps: 30, avatarDurationMs: 21000 });
    expect(bad).toHaveLength(1);
    expect(bad[0].kind).toBe("duration_mismatch");
  });

  it("первая сцена не с нуля — тоже дыра", () => {
    expect(validateScenes([scene(500, 4000, "avatar_full")], { fps: 30 }).map((p) => p.kind)).toContain("gap");
  });
});
