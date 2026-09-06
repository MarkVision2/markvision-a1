/**
 * Окно подключения Instagram: три двери и общий экран выбора аккаунтов.
 *
 * Что важно проверить: человек видит выбор способа (вход в Instagram, вход
 * через Facebook, страницы токена проекта), возврат со входа через Facebook
 * открывает список отложенных страниц, а фильтры отделяют доступные аккаунты
 * от уже подключённых — в сетке на сотню аккаунтов это единственный способ
 * что-то найти.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConnectInstagramDialog } from "@/components/publishing/ConnectInstagramDialog";
import type { UsePublishing } from "@/hooks/usePublishing";
import type { AvailablePage } from "@/lib/publishingClient";

const startInstagramConnect = vi.fn();
const fetchPendingPages = vi.fn();
const finishPendingPages = vi.fn();
const routineList = vi.fn().mockResolvedValue({ routines: [] });

vi.mock("@/lib/publishingClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publishingClient")>();
  return {
    ...actual,
    startInstagramConnect: (...a: unknown[]) => startInstagramConnect(...a),
    fetchPendingPages: (...a: unknown[]) => fetchPendingPages(...a),
    finishPendingPages: (...a: unknown[]) => finishPendingPages(...a),
    publishingApi: { ...actual.publishingApi, routineList: (...a: unknown[]) => routineList(...a) },
  };
});

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: (...a: unknown[]) => toastWarning(...a) },
}));

const page = (over: Partial<AvailablePage> = {}): AvailablePage => ({
  page_id: "p1",
  page_name: "Клиника",
  ig_user_id: "ig1",
  ig_username: "clinic",
  ig_name: "Клиника",
  ig_avatar_url: null,
  ig_followers: 1200,
  connectable: true,
  already_connected: false,
  ...over,
});

const loadAvailable = vi.fn();
const connect = vi.fn();
const bulkUpdateAccounts = vi.fn().mockResolvedValue({ updated: 1, missing: 0 });
const refetch = vi.fn().mockResolvedValue(undefined);

const pub = {
  projectId: "proj-1",
  groups: [{ id: "g1", name: "Клиники" }],
  personas: [{ id: "per1", name: "Врач" }],
  busy: null,
  loadAvailable,
  connect,
  bulkUpdateAccounts,
  refetch,
} as unknown as UsePublishing;

const renderDialog = (pendingId: string | null = null) =>
  render(
    <MemoryRouter>
      <ConnectInstagramDialog open onClose={vi.fn()} pub={pub} pendingId={pendingId} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  routineList.mockResolvedValue({ routines: [] });
  startInstagramConnect.mockResolvedValue("https://instagram/oauth");
  bulkUpdateAccounts.mockResolvedValue({ updated: 1, missing: 0 });
  refetch.mockResolvedValue(undefined);
  Object.defineProperty(window, "location", { writable: true, value: { ...window.location, assign: vi.fn() } });
});

describe("окно подключения Instagram", () => {
  it("предлагает три способа подключения", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: /Вход логином самого Instagram/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /через Facebook/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Из Meta-токена проекта/ })).toBeEnabled();
  });

  it("вход в Instagram уводит на площадку с режимом instagram", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Вход логином самого Instagram/ }));
    await waitFor(() => expect(startInstagramConnect).toHaveBeenCalledWith("proj-1", "instagram", null));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith("https://instagram/oauth"));
  });

  it("вход через Facebook уводит на площадку с режимом facebook", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /через Facebook/ }));
    await waitFor(() => expect(startInstagramConnect).toHaveBeenCalledWith("proj-1", "facebook", null));
  });

  it("ошибка входа показывается на месте, а не уводит в никуда", async () => {
    startInstagramConnect.mockRejectedValue(new Error("Вход через Instagram не настроен"));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Вход логином самого Instagram/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Вход через Instagram не настроен");
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("«Из Meta-токена проекта» показывает страницы токена и подключает отмеченные", async () => {
    loadAvailable.mockResolvedValue({ pages: [page(), page({ page_id: "p2", ig_user_id: "ig2", ig_username: "salon", page_name: "Салон", ig_followers: 800 })] });
    connect.mockResolvedValue({ connected: [{ id: "a1", account_name: "Клиника" }], skipped: [] });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Из Meta-токена проекта/ }));

    const row = await screen.findByRole("checkbox", { name: "@clinic" });
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: /Подключить 1/ }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith(["p1"], null, null, null));
    expect(toastSuccess).toHaveBeenCalledWith("Подключено: 1");
  });

  it("возврат со входа через Facebook открывает отложенные страницы и отмечает пригодные", async () => {
    fetchPendingPages.mockResolvedValue({
      pages: [page(), page({ page_id: "p2", ig_user_id: "ig2", ig_username: "old", already_connected: true })],
      group_id: null,
    });
    finishPendingPages.mockResolvedValue({ connected: [{ id: "a1", account_name: "Клиника", handle: "clinic" }], skipped: [] });
    renderDialog("pending-1");

    await waitFor(() => expect(fetchPendingPages).toHaveBeenCalledWith("proj-1", "pending-1"));
    // Аккаунты человек уже выбрал в самом Facebook — второй раз кликать не заставляем.
    expect(await screen.findByRole("checkbox", { name: "@clinic" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: /Подключить 1/ }));
    await waitFor(() => expect(finishPendingPages).toHaveBeenCalledWith("proj-1", "pending-1", ["p1"], null));
    expect(toastSuccess).toHaveBeenCalledWith("Подключено: 1");
  });

  it("фильтры делят список: доступные, подключённые, без Instagram", async () => {
    loadAvailable.mockResolvedValue({
      pages: [
        page(),
        page({ page_id: "p2", ig_user_id: "ig2", ig_username: "old", already_connected: true }),
        page({ page_id: "p3", ig_user_id: null, ig_username: null, page_name: "Пустая", connectable: false }),
      ],
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Из Meta-токена проекта/ }));
    await screen.findByRole("checkbox", { name: "@clinic" });

    fireEvent.click(screen.getByRole("button", { name: /Подключены/ }));
    expect(await screen.findByText("Подключён")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "@clinic" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Без Instagram/ }));
    expect(await screen.findByText("Нет Instagram")).toBeInTheDocument();
  });

  it("поиск ищет по @имени и названию страницы", async () => {
    loadAvailable.mockResolvedValue({
      pages: Array.from({ length: 8 }, (_, i) => page({ page_id: `p${i}`, ig_user_id: `ig${i}`, ig_username: `acc${i}`, page_name: `Страница ${i}` })),
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Из Meta-токена проекта/ }));
    const search = await screen.findByLabelText("Поиск аккаунтов");
    fireEvent.change(search, { target: { value: "acc3" } });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "@acc3" })).toBeInTheDocument());
    expect(screen.queryByRole("checkbox", { name: "@acc4" })).not.toBeInTheDocument();
  });

  it("пресет пачки после входа через Facebook применяется отдельной правкой", async () => {
    fetchPendingPages.mockResolvedValue({ pages: [page()], group_id: null });
    finishPendingPages.mockResolvedValue({ connected: [{ id: "a1", account_name: "Клиника", handle: "clinic" }], skipped: [] });
    renderDialog("pending-1");
    await screen.findByRole("checkbox", { name: "@clinic" });

    fireEvent.click(screen.getByRole("button", { name: /Настроить пачку сразу/ }));
    fireEvent.change(screen.getByLabelText("Лимит в день для новых аккаунтов"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Подключить 1/ }));

    await waitFor(() => expect(bulkUpdateAccounts).toHaveBeenCalledWith(["a1"], { daily_limit: 5 }));
  });

  it("неверный лимит останавливает подключение и объясняет почему", async () => {
    loadAvailable.mockResolvedValue({ pages: [page()] });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Из Meta-токена проекта/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "@clinic" }));

    fireEvent.click(screen.getByRole("button", { name: /Настроить пачку сразу/ }));
    fireEvent.change(screen.getByLabelText("Лимит в день для новых аккаунтов"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: /Подключить 1/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/целое число от 1 до 200/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("подвал считает выбранное и суммарную аудиторию", async () => {
    loadAvailable.mockResolvedValue({
      pages: [page(), page({ page_id: "p2", ig_user_id: "ig2", ig_username: "salon", ig_followers: 800 })],
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Из Meta-токена проекта/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "@clinic" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "@salon" }));

    const footer = screen.getByText(/подписчиков/);
    expect(footer).toHaveTextContent("2 аккаунта");
    // 1200 + 800 — сумма аудитории пачки в том же формате, что и в таблице.
    expect(footer).toHaveTextContent("2 тыс.");
  });
});
