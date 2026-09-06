/**
 * Публичная страница /connect/:token глазами клиента.
 *
 * Что здесь важно проверить: клиенту не показывают кнопку, которая не сработает
 * (ссылка отозвана / площадка не настроена), и результат возврата с площадки
 * читается из адреса — иначе человек уходит, не поняв, получилось или нет.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ConnectAccount from "@/pages/ConnectAccount";
import type { ConnectInvite } from "@/lib/publishingClient";

const fetchConnectInvite = vi.fn();
const startConnectInvite = vi.fn();
const connectInvitePages = vi.fn();
const finishConnectInvite = vi.fn();

vi.mock("@/lib/publishingClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publishingClient")>();
  return {
    ...actual,
    fetchConnectInvite: (...a: unknown[]) => fetchConnectInvite(...a),
    startConnectInvite: (...a: unknown[]) => startConnectInvite(...a),
    connectInvitePages: (...a: unknown[]) => connectInvitePages(...a),
    finishConnectInvite: (...a: unknown[]) => finishConnectInvite(...a),
  };
});

const invite = (over: Partial<ConnectInvite> = {}): ConnectInvite => ({
  state: "active",
  state_text: "Ссылка активна",
  project_name: "Стоматология Уали",
  label: "Блогер Асель",
  note: null,
  expires_at: null,
  remaining: null,
  platforms: [
    { platform: "instagram", ready: true, hint: null },
    { platform: "tiktok", ready: false, hint: "TIKTOK_CLIENT_KEY не задан" },
  ],
  connected: [],
  ...over,
});

function renderAt(path = "/connect/tok-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/connect/:token" element={<ConnectAccount />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchConnectInvite.mockResolvedValue(invite());
  startConnectInvite.mockResolvedValue("https://площадка/oauth");
  // window.location.assign в jsdom не реализован — подменяем на шпиона.
  Object.defineProperty(window, "location", { writable: true, value: { ...window.location, assign: vi.fn() } });
});

describe("страница подключения по ссылке", () => {
  it("показывает проект и кнопки площадок из ссылки", async () => {
    renderAt();
    expect(await screen.findByText("Стоматология Уали")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Подключить Instagram/ })).toBeEnabled();
  });

  it("не даёт нажать площадку, которая не настроена на сервере, и объясняет почему", async () => {
    renderAt();
    await screen.findByRole("button", { name: /Подключить Instagram/ });
    expect(screen.getByRole("button", { name: /Подключить TikTok/ })).toBeDisabled();
    expect(screen.getByText(/TIKTOK_CLIENT_KEY не задан/)).toBeInTheDocument();
  });

  it("уводит на площадку по нажатию", async () => {
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /Подключить Instagram/ }));
    await waitFor(() => expect(startConnectInvite).toHaveBeenCalledWith("tok-1", "instagram"));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith("https://площадка/oauth"));
  });

  it("отозванная ссылка: причина видна, кнопки неактивны", async () => {
    fetchConnectInvite.mockResolvedValue(invite({ state: "revoked", state_text: "Ссылка отозвана — попросите новую у менеджера." }));
    renderAt();
    expect(await screen.findByText(/Ссылка отозвана/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Подключить Instagram/ })).toBeDisabled();
  });

  it("сломанная ссылка не показывает форму вовсе", async () => {
    fetchConnectInvite.mockRejectedValue(new Error("Ссылка не найдена."));
    renderAt();
    expect(await screen.findByText("Ссылка не работает")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Подключить/ })).not.toBeInTheDocument();
  });

  it("возврат с площадки с успехом — экран «Успешно подключено»", async () => {
    renderAt("/connect/tok-1?publish_connected=instagram&account=clinic");
    expect(await screen.findByText("Успешно подключено")).toBeInTheDocument();
    expect(screen.getByText(/clinic/)).toBeInTheDocument();
  });

  it("возврат с ошибкой площадки показывает её текст", async () => {
    renderAt("/connect/tok-1?publish_error=%D0%BD%D0%B5%20%D0%B2%D1%8B%D0%B4%D0%B0%D0%BD%D0%BE%20%D0%BF%D1%80%D0%B0%D0%B2%D0%BE");
    expect(await screen.findByText("не выдано право")).toBeInTheDocument();
  });

  it("несколько Instagram — клиент выбирает, что подключить", async () => {
    connectInvitePages.mockResolvedValue([
      { page_id: "p1", page_name: "Клиника", ig_user_id: "ig1", ig_username: "clinic", ig_name: "Клиника", ig_avatar_url: null, ig_followers: 1200, connectable: true },
      { page_id: "p2", page_name: "Салон", ig_user_id: "ig2", ig_username: "salon", ig_name: "Салон", ig_avatar_url: null, ig_followers: 800, connectable: true },
    ]);
    finishConnectInvite.mockResolvedValue([{ platform: "instagram", account_name: "Клиника", handle: "clinic", status: "active" }]);
    renderAt("/connect/tok-1?publish_select=pending-1");

    const salon = await screen.findByText("Салон");
    fireEvent.click(salon);
    fireEvent.click(screen.getByRole("button", { name: /Подключить аккаунт/ }));
    await waitFor(() => expect(finishConnectInvite).toHaveBeenCalledWith("tok-1", "pending-1", ["p2"]));
    expect(await screen.findByText("Успешно подключено")).toBeInTheDocument();
  });
});
