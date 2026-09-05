/**
 * Страница «Радар идей»: плитки, карточка идеи, продвижение в контент-план,
 * строка поста с ER и кнопкой «Разобрать». Хук и стор проектов замоканы.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Radar from "@/pages/Radar";
import type { Idea, RadarPost } from "@/lib/radarClient";

// jsdom не умеет то, на что опирается Radix Select.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/useProjectsStore", () => ({
  useProjectsStore: () => ({ activeId: "proj-1" }),
}));

const promoteIdea = vi.fn().mockResolvedValue({ item_id: "item-77" });
const analyzePost = vi.fn().mockResolvedValue({ ok: true, idea_id: null, error: null });
const updateIdea = vi.fn().mockResolvedValue({ idea: {} });

const idea: Idea = {
  id: "idea-1",
  title: "Три ошибки при отбеливании",
  hook: "Вы всё ещё отбеливаете зубы дома?",
  angle: "Показать, что домашнее отбеливание портит эмаль",
  niche: "стоматология",
  script_draft: null,
  structure: null,
  source_post_ids: [],
  score: 82,
  status: "new",
  target_group_id: null,
  content_item_id: null,
  outcome_score: null,
  created_at: "2026-09-01T10:00:00.000Z",
};

const post: RadarPost = {
  id: "post-1",
  source_id: "src-1",
  platform: "instagram",
  external_id: "C1abc",
  url: "https://www.instagram.com/p/C1abc/",
  author_handle: "clinic",
  published_at: "2026-09-01T10:00:00.000Z",
  media_type: "video",
  caption: "Три ошибки",
  thumbnail_url: null,
  metrics: { likes: 1200, comments: 45, shares: 3, saves: 10, views: 30000 },
  followers: 25000,
  engagement_rate: 0.0503,
  velocity: null,
  score: 61,
  analysis: null,
  analysis_status: "pending",
  analyzed_at: null,
  error: null,
  baseline_views: null,
  baseline_likes: 20,
  norm_views: null,
  x_factor: 1.9,
};

vi.mock("@/lib/radarClient", async (orig) => {
  const mod = await orig<typeof import("@/lib/radarClient")>();
  // Ленивое обращение к `post`: фабрика поднимается выше объявления константы.
  return { ...mod, radarApi: { ...mod.radarApi, post: vi.fn(async () => ({ post, ideas: [] })) } };
});

vi.mock("@/hooks/useRadar", () => ({
  useRadar: () => ({
    projectId: "proj-1",
    sources: [{
      id: "src-own", project_id: "proj-1", kind: "own_account", platform: "instagram", handle: "aiva",
      label: null, enabled: true, crawl_interval_hours: 24, last_crawled_at: null, last_error: null, created_at: "2026-09-01T10:00:00.000Z",
    }],
    metrics: { sources: 3, posts_total: 60, posts_7d: 42, posts_unanalyzed: 5, posts_viral: 4, ideas_new: 7, ideas_used: 2, spent_month_usd: 1.5, last_run_at: null },
    ideas: [idea],
    posts: [post, { ...post, id: "post-own", source_id: "src-own", author_handle: "aiva", external_id: "own-1" }],
    groups: [
      { id: "g-1", name: "Группа А", persona_id: null, review_mode: null },
      { id: "g-2", name: "Группа Б", persona_id: null, review_mode: null },
    ],
    runs: [],
    crawler: { direct: true, n8n: false, ai: true },
    crawling: false,
    loading: false,
    error: null,
    busy: null,
    refetch: vi.fn(),
    upsertSource: vi.fn(),
    deleteSource: vi.fn(),
    crawlSource: vi.fn(),
    analyzeUrl: vi.fn(),
    analyzePost,
    updateIdea,
    promoteIdea,
  }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <Radar />
    </MemoryRouter>,
  );

describe("Radar page", () => {
  beforeEach(() => {
    promoteIdea.mockClear();
    analyzePost.mockClear();
    updateIdea.mockClear();
  });

  it("рисует плитки метрик и строку статуса радара", () => {
    renderPage();
    expect(screen.getByText("Источников")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Залетевших")).toBeTruthy();
    expect(screen.getByText("Не разобрано")).toBeTruthy();
    expect(screen.getByText("Новых идей")).toBeTruthy();
    expect(screen.getByText("Использовано идей")).toBeTruthy();
    expect(screen.getByText("$1.50")).toBeTruthy();
    expect(screen.getByText(/постов под наблюдением/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Ссылка на публикацию" })).toBeTruthy();
  });

  const openIdeas = () => fireEvent.mouseDown(screen.getByRole("tab", { name: /Идеи/ }), { button: 0 });

  it("карточка идеи показывает оценку и хук", () => {
    renderPage();
    openIdeas();
    expect(screen.getByText("Три ошибки при отбеливании")).toBeTruthy();
    expect(screen.getByText("82")).toBeTruthy();
    expect(screen.getByText(/Вы всё ещё отбеливаете зубы дома\?/)).toBeTruthy();
  });

  it("продвижение: выбрать группу → подтвердить → promoteIdea с group_id", async () => {
    renderPage();
    openIdeas();
    fireEvent.click(screen.getByRole("button", { name: "В контент-план" }));

    const trigger = screen.getByRole("combobox", { name: /Группа аккаунтов/i });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = await screen.findByRole("option", { name: "Группа Б" });
    fireEvent.keyDown(option, { key: "Enter" });
    await waitFor(() => expect(trigger).toHaveTextContent("Группа Б"));

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    await waitFor(() => expect(promoteIdea).toHaveBeenCalledWith("idea-1", { group_id: "g-2" }));
  });

  it("карточка тренда: обычно / сейчас / ER, X-фактор и «Разобрать» → analyzePost", async () => {
    renderPage();
    // Вкладка «Тренды» открыта по умолчанию.
    const card = (await screen.findByText("@clinic")).closest("article") as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).getByText("5,0 %")).toBeTruthy();
    expect(within(card).getByText("обычно")).toBeTruthy();
    expect(within(card).getAllByText("×1,9").length).toBeGreaterThan(0);
    fireEvent.click(within(card).getByRole("button", { name: /Разобрать/ }));
    await waitFor(() => expect(analyzePost).toHaveBeenCalledWith("post-1"));
  });

  it("пост из собственного аккаунта помечен чипом «свой аккаунт»", async () => {
    renderPage();
    const own = (await screen.findByText("@aiva")).closest("article") as HTMLElement;
    expect(within(own).getByText("свой аккаунт")).toBeTruthy();
    const competitor = screen.getByText("@clinic").closest("article") as HTMLElement;
    expect(within(competitor).queryByText("свой аккаунт")).toBeNull();
  });

  it("«Авторы»: рейтинг по собранным постам с залетевшими и плотностью хитов", async () => {
    renderPage();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Авторы/ }), { button: 0 });
    expect((await screen.findAllByText("Залетевших постов")).length).toBe(2);
    expect(screen.getByText("@clinic")).toBeTruthy();
    expect(screen.getAllByText("0 % (0 из 1)").length).toBe(2);
  });

  it("клик по превью открывает «рентген» поста с динамикой", async () => {
    renderPage();
    const card = (await screen.findByText("@clinic")).closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Открыть разбор поста" }));
    expect(await screen.findByText("Динамика")).toBeTruthy();
    expect(screen.getByText("обычно у автора")).toBeTruthy();
  });
});
