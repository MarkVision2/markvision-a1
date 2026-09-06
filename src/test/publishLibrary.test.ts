/**
 * Шов «цех → библиотека публикации»: готовый рендер монтажа или Reels должен доходить
 * до очереди, но ровно один раз.
 */
import { describe, expect, it, vi } from "vitest";
import { addToPublishLibrary } from "../../supabase/functions/_lib/publishLibrary.ts";

/** Минимальный двойник PostgREST: цепочка select→eq→maybeSingle и insert→select→maybeSingle. */
function fakeDb(existing: { id: string } | null, inserted: { id: string } | null = { id: "new" }) {
  const insert = vi.fn(() => chain(inserted));
  const chain = (result: unknown) => ({
    select: () => chain(result),
    eq: () => chain(result),
    maybeSingle: () => Promise.resolve({ data: result, error: null }),
    insert,
  });
  const from = vi.fn(() => ({
    select: () => chain(existing),
    insert,
  }));
  return { db: { from } as never, insert, from };
}

const INPUT = {
  projectId: "p1",
  fileUrl: "https://cdn/render.mp4",
  title: "Ролик",
  caption: "описание",
  source: "montage",
  sourceRef: "montage-main169.mp4",
};

describe("рендер попадает в библиотеку публикации", () => {
  it("новый ролик заводится со статусом ready — в библиотеку, а не сразу в эфир", async () => {
    const { db, insert } = fakeDb(null, { id: "v1" });
    const r = await addToPublishLibrary(db, INPUT);
    expect(r.videoId).toBe("v1");
    // Публиковать всё, что отрендерилось, система не должна — раскладку запускает человек.
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      status: "ready", source: "montage", source_ref: "montage-main169.mp4", file_url: INPUT.fileUrl,
    }));
  });

  it("повторный прогон того же рендера не плодит вторую карточку", async () => {
    // Иначе один ролик разошёлся бы по аккаунтам дважды.
    const { db, insert } = fakeDb({ id: "уже-есть" });
    const r = await addToPublishLibrary(db, INPUT);
    expect(r.videoId).toBe("уже-есть");
    expect(insert).not.toHaveBeenCalled();
  });

  it("описание и обложка переносятся, длинный заголовок обрезается", async () => {
    const { db, insert } = fakeDb(null);
    await addToPublishLibrary(db, { ...INPUT, title: "я".repeat(300), thumbnailUrl: "https://cdn/t.jpg", durationSec: 42 });
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect((row.title as string).length).toBe(200);
    expect(row.base_caption).toBe("описание");
    expect(row.thumbnail_url).toBe("https://cdn/t.jpg");
    expect(row.duration_sec).toBe(42);
  });

  it("сбой вставки возвращается предупреждением, а не роняет публикацию рендера", async () => {
    const insert = vi.fn(() => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "нет колонки" } }) }),
    }));
    const db = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }), insert }) } as never;
    const r = await addToPublishLibrary(db, INPUT);
    expect(r.videoId).toBeNull();
    expect(r.warning).toMatch(/нет колонки/);
  });
});
