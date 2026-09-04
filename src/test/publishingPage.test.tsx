/**
 * Страница «Публикации»: плитки метрик, таблица аккаунтов, отключение
 * через confirm и валидация ссылки в диалоге «Залить видео».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Publishing from "@/pages/Publishing";
import type { PublishAccount } from "@/lib/publishingClient";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

vi.mock("@/hooks/useProjectsStore", () => ({
  useProjectsStore: () => ({ activeId: "proj-1" }),
}));

const disconnect = vi.fn().mockResolvedValue({ ok: true });
const publishVideo = vi.fn().mockResolvedValue({ video_id: "v1", created: 1, skipped: 0, jobs: [] });

const account: PublishAccount = {
  id: "acc-1",
  platform: "instagram",
  account_name: "Клиника Айва",
  handle: "aiva",
  external_account_id: "1789",
  status: "active",
  publish_enabled: true,
  daily_limit: 5,
  last_post_at: null,
  consecutive_errors: 0,
  last_error: null,
  token_expires_at: null,
  group_id: null,
  persona_id: null,
  timezone: null,
  window_start: null,
  window_end: null,
  ramp_enabled: true,
  ramp_started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), // 2 дня → ступень 1
  health_score: 82,
  published_today: 1,
  published_day: null,
  token_refreshed_at: null,
  followers: 1200,
};

// Переключатели состояния мока между тестами (vi.mock поднимается выше объявлений).
const mockFlags = vi.hoisted(() => ({ paused: false }));

vi.mock("@/hooks/usePublishing", () => ({
  usePublishing: () => ({
    projectId: "proj-1",
    accounts: [account],
    groups: [],
    personas: [],
    settings: {
      settings: { notify_mode: "digest", digest_chat_id: null, max_parallel_workers: 3 },
      budget: { daily_usd: 5, monthly_usd: 100 },
      spend: { today_usd: 0.5, month_usd: 12.34 },
    },
    metrics: {
      publish: {
        accounts_total: 7,
        accounts_active: 4,
        accounts_token_expired: 1,
        accounts_limited_or_error: 0,
        health_avg: 81.4,
        jobs_queued: 13,
        jobs_processing: 0,
        published_24h: 9,
        failed_24h: 2,
        manual_review: 0,
        next_slot_at: null,
        tokens_expiring_7d: 3,
        reach_d3_7d: 0,
        spent_month_usd: 12.34,
        paused: mockFlags.paused,
      },
      radar: null,
      videos: [],
      groups: [{
        group_id: "g1", name: "Алматы · IG", platform: "instagram", review_mode: "auto_publish", persona_id: null,
        accounts_total: 10, accounts_active: 8, accounts_token_expired: 1, health_avg: 77.2, jobs_queued: 4,
        published_7d: 21, failed_7d: 2, next_slot_at: null, reach_d3_7d: 15400, items_approved: 3,
      }],
    },
    jobs: [],
    jobsStatus: "all",
    setJobsStatus: vi.fn(),
    loading: false,
    error: null,
    busy: null,
    refetch: vi.fn(),
    loadAvailable: vi.fn().mockResolvedValue({ pages: [] }),
    connect: vi.fn(),
    connectThreads: vi.fn(),
    updateAccount: vi.fn().mockResolvedValue({ account: {} }),
    disconnect,
    groupUpsert: vi.fn(),
    groupDelete: vi.fn(),
    personaUpsert: vi.fn(),
    personaDelete: vi.fn(),
    settingsUpsert: vi.fn(),
    publishVideo,
  }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <Publishing />
    </MemoryRouter>,
  );

describe("страница «Публикации»", () => {
  beforeEach(() => {
    disconnect.mockClear();
    publishVideo.mockClear();
    toastError.mockClear();
    toastSuccess.mockClear();
  });

  it("плитки показывают числа из metrics", () => {
    renderPage();
    expect(screen.getByText("4 / 7")).toBeTruthy();
    expect(screen.getByText("13")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("81%")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("$12.34")).toBeTruthy();
  });

  it("вкладка «Сеть»: строка группы с составом, здоровьем и публикациями за неделю", async () => {
    renderPage();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Сеть" }));
    fireEvent.click(screen.getByRole("tab", { name: "Сеть" }));
    await waitFor(() => expect(screen.getByText("Алматы · IG")).toBeTruthy());
    expect(screen.getByText("8 / 10")).toBeTruthy();
    expect(screen.getByText("77%")).toBeTruthy();
    expect(screen.getByText("✓ 21")).toBeTruthy();
    expect(screen.getByText("✗ 2")).toBeTruthy();
    expect(screen.getByText("токен истёк: 1")).toBeTruthy();
  });

  it("баннер паузы показывается только когда проект на паузе", () => {
    const { unmount } = renderPage();
    expect(screen.queryByText(/Публикации проекта приостановлены/)).toBeNull();
    unmount();
    mockFlags.paused = true;
    try {
      renderPage();
      expect(screen.getByText(/Публикации проекта приостановлены/)).toBeTruthy();
    } finally {
      mockFlags.paused = false;
    }
  });

  it("таблица аккаунтов: чип статуса и ступень разгона", () => {
    renderPage();
    expect(screen.getByText("Клиника Айва")).toBeTruthy();
    expect(screen.getByText("Активен")).toBeTruthy();
    expect(screen.getByText(/Ступень 1 · 1\/день/)).toBeTruthy();
  });

  it("«Отключить» вызывает disconnect после подтверждения", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("acc-1"));
    confirmSpy.mockRestore();
  });

  it("«Отключить» не вызывает disconnect при отказе", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));
    expect(disconnect).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("«Залить видео» не отправляет пустую ссылку и показывает ошибку", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Залить видео/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Создать задания/ }));
    expect(publishVideo).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Укажите ссылку/);
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Укажите ссылку/));
  });

  it("«Залить видео» отклоняет не-mp4 ссылку", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Залить видео/ }));
    const input = await screen.findByLabelText("Ссылка на видео");
    fireEvent.change(input, { target: { value: "http://example.com/video.avi" } });
    fireEvent.click(screen.getByRole("button", { name: /Создать задания/ }));
    expect(publishVideo).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/https-ссылка/);
  });
});
