/**
 * «Видео»: библиотека роликов со счётчиками заданий; «Опубликовать ещё» и
 * «Задания» зовут страницу с нужным роликом; ни разу не выходивший ролик —
 * только «Опубликовать».
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VideosTab, videoLabel } from "@/components/publishing/VideosTab";
import { PublishApiError, type PublishVideo } from "@/lib/publishingClient";
import type { UsePublishing } from "@/hooks/usePublishing";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), warning: vi.fn() },
}));

const video = (p: Partial<PublishVideo>): PublishVideo => ({
  id: "v1", title: "Осенняя акция", status: "queued", file_url: "https://cdn/x/osen.mp4", created_at: new Date().toISOString(), source: "manual",
  jobs_total: 0, queued: 0, published: 0, failed: 0, last_published_at: null, next_scheduled_at: null,
  ...p,
});

const pubWith = (videos: PublishVideo[], patch: Partial<UsePublishing> = {}) =>
  ({ metrics: { publish: null, radar: null, videos }, busy: null, videoDelete: vi.fn(), ...patch }) as unknown as UsePublishing;

afterEach(() => { toastSuccess.mockClear(); toastError.mockClear(); vi.restoreAllMocks(); });

describe("videoLabel", () => {
  it("заголовок, иначе имя файла из ссылки", () => {
    expect(videoLabel({ title: "Акция", file_url: "https://cdn/x/a.mp4" })).toBe("Акция");
    expect(videoLabel({ title: null, file_url: "https://cdn/x/%D0%BE%D1%81%D0%B5%D0%BD%D1%8C.mp4" })).toBe("осень.mp4");
    expect(videoLabel({ title: "  ", file_url: "not a url/clip.mov" })).toBe("clip.mov");
  });
});

describe("VideosTab", () => {
  it("пустая библиотека — подсказка", () => {
    render(<VideosTab pub={pubWith([])} onRepost={vi.fn()} onShowJobs={vi.fn()} />);
    expect(screen.getByText(/Библиотека пуста/)).toBeTruthy();
  });

  it("счётчики заданий и действия", () => {
    const onRepost = vi.fn();
    const onShowJobs = vi.fn();
    const seasoned = video({ id: "v1", jobs_total: 4, published: 2, queued: 1, failed: 1, source: "content_pipeline" });
    const fresh = video({ id: "v2", title: "Новый ролик", file_url: "https://cdn/x/new.mp4" });
    render(<VideosTab pub={pubWith([seasoned, fresh])} onRepost={onRepost} onShowJobs={onShowJobs} />);

    expect(screen.getByText("2 опубл.")).toBeTruthy();
    expect(screen.getByText("1 в очереди")).toBeTruthy();
    expect(screen.getByText("1 с ошибкой")).toBeTruthy();
    expect(screen.getByText("конвейер")).toBeTruthy();
    expect(screen.getByText("ещё не публиковался")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Опубликовать ещё Осенняя акция" }));
    expect(onRepost).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }));
    fireEvent.click(screen.getByRole("button", { name: "Задания по видео Осенняя акция" }));
    expect(onShowJobs).toHaveBeenCalledWith(expect.objectContaining({ id: "v1" }));

    // Ролик без заданий: кнопка называется «Опубликовать», «Заданий» нет.
    expect(screen.getByRole("button", { name: "Опубликовать ещё Новый ролик" }).textContent).toMatch(/^\s*Опубликовать\s*$/);
    expect(screen.queryByRole("button", { name: "Задания по видео Новый ролик" })).toBeNull();
  });
});

describe("удаление ролика из библиотеки", () => {
  it("спрашивает подтверждение и удаляет вместе с заданиями", async () => {
    const videoDelete = vi.fn().mockResolvedValue({ deleted_jobs: 3 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VideosTab pub={pubWith([video({ id: "v1" })], { videoDelete })} onRepost={vi.fn()} onShowJobs={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Удалить видео Осенняя акция" }));
    await waitFor(() => expect(videoDelete).toHaveBeenCalledWith("v1"));
  });

  it("отказ — ничего не удаляем", () => {
    const videoDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<VideosTab pub={pubWith([video({ id: "v1" })], { videoDelete })} onRepost={vi.fn()} onShowJobs={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Удалить видео Осенняя акция" }));
    expect(videoDelete).not.toHaveBeenCalled();
  });

  it("ролик с опубликованными постами удаляется только после второго подтверждения", async () => {
    // Сервер отбивает первую попытку (needs_force): вместе с роликом пропадёт
    // история живых постов, поэтому спрашиваем ещё раз и называем цену.
    const videoDelete = vi.fn()
      .mockRejectedValueOnce(new PublishApiError("у ролика 2 опубликованных постов", { needs_force: true, published_jobs: 2 }))
      .mockResolvedValueOnce({ deleted_jobs: 2 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VideosTab pub={pubWith([video({ id: "v1", published: 2, jobs_total: 2 })], { videoDelete })} onRepost={vi.fn()} onShowJobs={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Удалить видео Осенняя акция" }));
    await waitFor(() => expect(videoDelete).toHaveBeenLastCalledWith("v1", true));
    expect(confirmSpy.mock.calls[1][0]).toMatch(/2 опубликованных постов/);
  });
});
