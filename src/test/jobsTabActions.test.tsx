/**
 * «Задания»: повтор и отмена доступны ровно в тех статусах, где сервер их
 * примет (JOB_ACTIONS — зеркало job_retry/job_cancel), и зовут нужный id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JobsTab } from "@/components/publishing/JobsTab";
import type { PublishJob } from "@/lib/publishingClient";
import type { UsePublishing } from "@/hooks/usePublishing";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const job = (id: string, status: PublishJob["status"], name: string): PublishJob => ({
  id, video_id: "v", account_id: id, platform: "instagram", status, scheduled_at: new Date().toISOString(),
  attempts: 1, next_attempt_at: null, external_post_url: null, error_code: null, error_message: null,
  published_at: null, created_at: new Date().toISOString(),
  publish_accounts: { account_name: name, handle: null }, publish_videos: { title: "Ролик", file_url: "https://x/v.mp4" },
});

const jobRetry = vi.fn().mockResolvedValue({ ok: true });
const jobCancel = vi.fn().mockResolvedValue({ ok: true });
const pub = {
  jobs: [job("f", "failed", "Упавший"), job("p", "pending", "Ждущий"), job("d", "published", "Готовый"), job("m", "manual_review", "Ручной")],
  jobsStatus: "all", setJobsStatus: vi.fn(), busy: null, jobRetry, jobCancel,
} as unknown as UsePublishing;

beforeEach(() => { jobRetry.mockClear(); jobCancel.mockClear(); });

describe("действия над заданиями", () => {
  it("упавшее можно повторить, но не отменить", () => {
    render(<JobsTab pub={pub} />);
    expect(screen.getByRole("button", { name: "Повторить Упавший" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отменить Упавший" })).toBeNull();
  });

  it("ждущее можно отменить, но не повторить", () => {
    render(<JobsTab pub={pub} />);
    expect(screen.getByRole("button", { name: "Отменить Ждущий" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Повторить Ждущий" })).toBeNull();
  });

  it("опубликованное — ни того, ни другого", () => {
    render(<JobsTab pub={pub} />);
    expect(screen.queryByRole("button", { name: /Готовый/ })).toBeNull();
  });

  it("ручной разбор — и повторить, и отменить", () => {
    render(<JobsTab pub={pub} />);
    expect(screen.getByRole("button", { name: "Повторить Ручной" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Отменить Ручной" })).toBeTruthy();
  });

  it("кнопки зовут хук с id задания", async () => {
    render(<JobsTab pub={pub} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить Упавший" }));
    await waitFor(() => expect(jobRetry).toHaveBeenCalledWith("f"));
    fireEvent.click(screen.getByRole("button", { name: "Отменить Ждущий" }));
    await waitFor(() => expect(jobCancel).toHaveBeenCalledWith("p"));
  });
});

describe("поиск, фильтр по видео и подгрузка", () => {
  const setJobsVideo = vi.fn();
  const loadMoreJobs = vi.fn();
  const pub2 = {
    ...pub,
    jobsVideo: "v",
    metrics: { publish: null, radar: null, videos: [{ id: "v", title: "Ролик", file_url: "https://x/v.mp4", status: "queued", created_at: "", source: "manual" }] },
    jobsHasMore: true,
    setJobsVideo,
    loadMoreJobs,
  } as unknown as UsePublishing;

  it("строка поиска сужает выборку по имени аккаунта", () => {
    render(<JobsTab pub={pub2} />);
    fireEvent.change(screen.getByLabelText("Поиск по заданиям"), { target: { value: "упав" } });
    expect(screen.getByText("Упавший")).toBeTruthy();
    expect(screen.queryByText("Ждущий")).toBeNull();
    fireEvent.change(screen.getByLabelText("Поиск по заданиям"), { target: { value: "нет такого" } });
    expect(screen.getByText(/Ничего не найдено/)).toBeTruthy();
  });

  it("чип видео снимается крестиком, «Показать ещё» зовёт подгрузку", () => {
    render(<JobsTab pub={pub2} />);
    expect(screen.getByText("Только видео:")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Снять фильтр по видео" }));
    expect(setJobsVideo).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(loadMoreJobs).toHaveBeenCalled();
  });
});
