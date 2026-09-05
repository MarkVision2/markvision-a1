/**
 * «Задания»: почему задание встало, видно из строки.
 *
 * Раньше отказ прятался за значком ⚠, и четыре подряд «Ошибка» выглядели
 * одинаково — оператор не понимал, чинить токен, файл или просто подождать.
 * Ещё чипы статусов считались по загруженной странице и врали на большой
 * очереди; теперь счётчики приходят с сервера.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { JobsTab } from "@/components/publishing/JobsTab";
import { jobErrorHint, type PublishJob } from "@/lib/publishingClient";
import type { UsePublishing } from "@/hooks/usePublishing";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const job = (patch: Partial<PublishJob>): PublishJob => ({
  id: "j1", video_id: "v", account_id: "a", platform: "instagram", status: "failed",
  scheduled_at: new Date().toISOString(), attempts: 1, next_attempt_at: null,
  external_post_url: null, error_code: null, error_message: null, published_at: null,
  created_at: new Date().toISOString(),
  publish_accounts: { account_name: "Клиника Айва", handle: "aiva" },
  publish_videos: { title: null, file_url: "https://example.com/test-pipeline-check.mp4" },
  ...patch,
});

const makePub = (jobs: PublishJob[], patch: Partial<UsePublishing> = {}) => ({
  jobs, jobsStatus: "all", setJobsStatus: vi.fn(), setJobsVideo: vi.fn(), jobsVideo: null,
  jobCounts: {}, busy: null, jobRetry: vi.fn(), jobCancel: vi.fn(), metrics: null,
  ...patch,
} as unknown as UsePublishing);

describe("разбор кода отказа", () => {
  it("токен, лимит и файл разложены по разным причинам", () => {
    expect(jobErrorHint("190")?.title).toMatch(/токен/i);
    expect(jobErrorHint("no_token")?.title).toMatch(/токен/i);
    expect(jobErrorHint("4")?.title).toMatch(/лимит/i);
    expect(jobErrorHint("processing_timeout")?.title).toMatch(/не обработала/i);
  });

  it("незнакомый код разбора не выдумывает", () => {
    expect(jobErrorHint("хз_что_это")).toBeNull();
    expect(jobErrorHint(null)).toBeNull();
  });
});

describe("колонка «Что происходит»", () => {
  it("показывает причину и ответ площадки прямо в строке", () => {
    render(<JobsTab pub={makePub([job({ error_code: "190", error_message: "Session has expired" })])} />);
    const row = screen.getByText("Клиника Айва").closest("tr") as HTMLTableRowElement;
    expect(within(row).getByText("Площадка отвергла токен")).toBeTruthy();
    expect(within(row).getByText("Session has expired")).toBeTruthy();
  });

  it("незнакомый код показывает сам текст площадки, а не пустую ячейку", () => {
    render(<JobsTab pub={makePub([job({ error_code: "weird_thing", error_message: "видео не скачалось" })])} />);
    const row = screen.getByText("Клиника Айва").closest("tr") as HTMLTableRowElement;
    expect(within(row).getByText("видео не скачалось")).toBeTruthy();
    expect(within(row).getByText(/код площадки weird_thing/)).toBeTruthy();
  });

  it("задание без отказа объясняет, чего оно ждёт", () => {
    render(<JobsTab pub={makePub([job({ status: "pending" })])} />);
    const row = screen.getByText("Клиника Айва").closest("tr") as HTMLTableRowElement;
    expect(within(row).getByText(/Ждёт своего слота/)).toBeTruthy();
  });

  it("зависший воркер назван зависшим, а не «публикуется»", () => {
    const stale = job({ status: "processing", locked_at: new Date(Date.now() - 40 * 60_000).toISOString() });
    render(<JobsTab pub={makePub([stale])} />);
    const row = screen.getByText("Клиника Айва").closest("tr") as HTMLTableRowElement;
    expect(within(row).getByText(/Воркер не отвечает/)).toBeTruthy();
    // Повторить зависшее можно, не дожидаясь, пока аренда протухнет у сервера.
    expect(within(row).getByRole("button", { name: /Повторить/ })).toBeTruthy();
  });
});

describe("счётчики статусов", () => {
  it("берутся с сервера по всей очереди, а не по загруженной странице", () => {
    const pub = makePub([job({})], { jobCounts: { all: 412, failed: 37, pending: 300 } });
    render(<JobsTab pub={pub} />);
    expect(screen.getByRole("button", { name: /Все 412/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ошибка 37/ })).toBeTruthy();
  });
});
