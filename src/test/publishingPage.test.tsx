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
const loadAvailable = vi.fn().mockResolvedValue({ pages: [] });
const connect = vi.fn().mockResolvedValue({ connected: [{}], skipped: [] });
const publishVideo = vi.fn().mockResolvedValue({ video_id: "v1", created: 1, skipped: 0, jobs: [] });

const tiktokOld: PublishAccount = {
  id: "acc-tt",
  platform: "tiktok",
  account_name: "Клиника TikTok",
  handle: "aiva.tt",
  external_account_id: "open-1",
  status: "active",
  publish_enabled: true,
  daily_limit: 2,
  last_post_at: null,
  consecutive_errors: 0,
  last_error: null,
  token_expires_at: null,
  group_id: null,
  persona_id: null,
  timezone: null,
  window_start: null,
  window_end: null,
  ramp_enabled: false,
  ramp_started_at: null,
  health_score: 90,
  published_today: 0,
  published_day: null,
  token_refreshed_at: null,
  followers: null,
  oauth_scope: "user.info.basic,video.publish,video.upload", // подключён до появления video.list
};

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
    accounts: [account, tiktokOld],
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
    loadAvailable,
    connect,
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
    loadAvailable.mockReset().mockResolvedValue({ pages: [] });
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
    expect(screen.getAllByText("Активен")[0]).toBeTruthy();
    expect(screen.getByText(/Ступень 1 · 1\/день/)).toBeTruthy();
  });

  it("«Отключить» вызывает disconnect после подтверждения", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Отключить" })[0]);
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("acc-1"));
    confirmSpy.mockRestore();
  });

  it("«Отключить» не вызывает disconnect при отказе", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Отключить" })[0]);
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

  it("подключение Instagram: отказ Meta показывает причину и принимает вставленный токен", async () => {
    loadAvailable
      .mockRejectedValueOnce(new Error("Meta отклонила токен проекта: Invalid OAuth access token"))
      .mockResolvedValueOnce({ pages: [] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Подключить Instagram/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Invalid OAuth access token/);
    fireEvent.change(screen.getByLabelText("User Access Token"), { target: { value: "EAABtoken" } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));
    await waitFor(() => expect(loadAvailable).toHaveBeenLastCalledWith("EAABtoken"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("подключение Instagram: поиск, «выбрать все», уже подключённые отдельно, connect с выбранными", async () => {
    loadAvailable.mockResolvedValueOnce({
      pages: [
        { page_id: "p1", page_name: "VM Клиника", ig_user_id: "1", ig_username: "vm.clinic.ast", ig_name: "VM", ig_followers: 12400, connectable: true, already_connected: false },
        { page_id: "p2", page_name: "Dagestan.topteam", ig_user_id: "2", ig_username: "dagestan.topteam", ig_name: null, connectable: true, already_connected: false },
        { page_id: "p3", page_name: "Старый", ig_user_id: "3", ig_username: "old", ig_name: null, connectable: true, already_connected: true },
        { page_id: "p4", page_name: "Без IG", ig_user_id: null, ig_username: null, ig_name: null, connectable: false, already_connected: false },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Подключить Instagram/ }));
    await screen.findByRole("checkbox", { name: "@vm.clinic.ast" });
    expect(screen.getByText("12,4 тыс.")).toBeTruthy();
    // Подключённые и страницы без Instagram свёрнуты и не предлагаются к выбору.
    expect(screen.queryByRole("checkbox", { name: "@old" })).toBeNull();
    expect(screen.getByText(/подключено 1, без Instagram 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Выбрать все" }));
    expect(screen.getByRole("button", { name: /Подключить 2/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "@dagestan.topteam" }));
    fireEvent.click(screen.getByRole("button", { name: /Подключить 1/ }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith(["p1"], null, null));
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

  it("TikTok без права video.list получает подсказку о переподключении", () => {
    renderPage();
    const row = screen.getByText("Клиника TikTok").closest("tr") as HTMLTableRowElement;
    expect(row.textContent).toMatch(/без права video.list/);
    const ig = screen.getByText("Клиника Айва").closest("tr") as HTMLTableRowElement;
    expect(ig.textContent).not.toMatch(/video.list/);
  });
});
