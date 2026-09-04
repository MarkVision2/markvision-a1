/**
 * Массовые действия над выделенными аккаунтами: одна правка на всю пачку,
 * последовательными вызовами, с честным отчётом о частичном провале.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BulkAccountsBar } from "@/components/publishing/BulkAccountsBar";
import type { UsePublishing } from "@/hooks/usePublishing";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

const updateAccount = vi.fn().mockResolvedValue({ account: {} });
const refetch = vi.fn().mockResolvedValue(undefined);

const pub = {
  accounts: [], groups: [{ id: "g1", name: "Клиники" }], personas: [{ id: "p1", name: "Врач" }],
  updateAccount, refetch,
} as unknown as UsePublishing;

const renderBar = (selected = ["a1", "a2"]) =>
  render(<BulkAccountsBar pub={pub} selected={selected} onClear={vi.fn()} />);

beforeEach(() => {
  updateAccount.mockClear().mockResolvedValue({ account: {} });
  refetch.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("BulkAccountsBar", () => {
  it("без выделения не отображается", () => {
    const { container } = renderBar([]);
    expect(container.firstChild).toBeNull();
  });

  it("«Включить» шлёт publish_enabled на каждый выделенный аккаунт", async () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Включить/ }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledTimes(2));
    expect(updateAccount).toHaveBeenCalledWith("a1", { publish_enabled: true });
    expect(updateAccount).toHaveBeenCalledWith("a2", { publish_enabled: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Публикации включены: 2"));
  });

  it("«Разгон выкл» шлёт ramp_enabled: false", async () => {
    renderBar(["a1"]);
    fireEvent.click(screen.getByRole("button", { name: /Разгон выкл/ }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith("a1", { ramp_enabled: false }));
  });

  it("общий лимит применяется ко всей пачке и валидируется", async () => {
    renderBar();
    const input = screen.getByLabelText("Лимит в день для выделенных");
    fireEvent.change(input, { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: /Задать/ }));
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/целое число/));
    expect(updateAccount).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Задать/ }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith("a1", { daily_limit: 4 }));
  });

  it("частичный провал сообщает, сколько прошло и что упало", async () => {
    updateAccount
      .mockResolvedValueOnce({ account: {} })
      .mockRejectedValueOnce(new Error("Meta отклонила токен"));
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Выключить/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/1 из 2, ошибок 1 — Meta отклонила токен/)),
    );
  });

  it("после пачки данные перечитываются", async () => {
    renderBar(["a1"]);
    fireEvent.click(screen.getByRole("button", { name: /Включить/ }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
