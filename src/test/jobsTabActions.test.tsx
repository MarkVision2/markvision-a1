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
    expect(screen.queryByRole("button", { name: /^(Повторить|Отменить) Готовый/ })).toBeNull();
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
