/**
 * Массовые действия над выделенными аккаунтами: одна правка на всю пачку
 * одним запросом, с честным отчётом о частичном провале.
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

const bulkUpdateAccounts = vi.fn().mockResolvedValue({ updated: 2, missing: 0 });

const pub = {
  accounts: [], groups: [{ id: "g1", name: "Клиники" }], personas: [{ id: "p1", name: "Врач" }],
  bulkUpdateAccounts,
} as unknown as UsePublishing;

const renderBar = (selected = ["a1", "a2"]) =>
  render(<BulkAccountsBar pub={pub} selected={selected} onClear={vi.fn()} />);

beforeEach(() => {
  bulkUpdateAccounts.mockClear().mockResolvedValue({ updated: 2, missing: 0 });
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("BulkAccountsBar", () => {
  it("без выделения не отображается", () => {
    const { container } = renderBar([]);
    expect(container.firstChild).toBeNull();
  });

  it("«Включить» шлёт publish_enabled одним запросом на всю пачку", async () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Включить/ }));
    await waitFor(() => expect(bulkUpdateAccounts).toHaveBeenCalledTimes(1));
    expect(bulkUpdateAccounts).toHaveBeenCalledWith(["a1", "a2"], { publish_enabled: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Публикации включены: 2"));
  });

  it("«Разгон выкл» шлёт ramp_enabled: false", async () => {
    bulkUpdateAccounts.mockResolvedValueOnce({ updated: 1, missing: 0 });
    renderBar(["a1"]);
    fireEvent.click(screen.getByRole("button", { name: /Разгон выкл/ }));
    await waitFor(() => expect(bulkUpdateAccounts).toHaveBeenCalledWith(["a1"], { ramp_enabled: false }));
  });

  it("общий лимит применяется ко всей пачке и валидируется", async () => {
    renderBar();
    const input = screen.getByLabelText("Лимит в день для выделенных");
    fireEvent.change(input, { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: /Задать/ }));
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/целое число/));
    expect(bulkUpdateAccounts).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Задать/ }));
    await waitFor(() => expect(bulkUpdateAccounts).toHaveBeenCalledWith(["a1", "a2"], { daily_limit: 4 }));
  });

  it("частичный провал сообщает, сколько прошло и сколько не нашлось", async () => {
    bulkUpdateAccounts.mockResolvedValueOnce({ updated: 1, missing: 1 });
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Выключить/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/1 из 2, не найдено 1/)));
  });

  it("отказ сервера — ошибка с текстом, без успеха", async () => {
    bulkUpdateAccounts.mockRejectedValueOnce(new Error("группа не из этого проекта"));
    renderBar(["a1"]);
    fireEvent.click(screen.getByRole("button", { name: /Включить/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/группа не из этого проекта/)));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
