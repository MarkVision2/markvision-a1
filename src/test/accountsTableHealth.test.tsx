/**
 * Здоровье в таблице аккаунтов: подсказка объясняет оценку и время проверки,
 * «Проверить все» / «Проверить сейчас» зовут проверку с нужными id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountsTable } from "@/components/publishing/AccountsTable";
import type { PublishAccount } from "@/lib/publishingClient";
import type { UsePublishing } from "@/hooks/usePublishing";

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: (...a: unknown[]) => toastWarning(...a), error: vi.fn() },
}));

const base: PublishAccount = {
  id: "a1", platform: "instagram", account_name: "Клиника Айва", handle: "aiva",
  external_account_id: "1", status: "active", publish_enabled: true, daily_limit: 10,
  last_post_at: null, consecutive_errors: 0, last_error: null, token_expires_at: null,
  group_id: null, persona_id: null, timezone: null, window_start: null, window_end: null,
  ramp_enabled: false, ramp_started_at: null, health_score: 85, published_today: 0,
  published_day: null, token_refreshed_at: null, followers: null,
  health_reasons: ["токен истекает через 5 дн."], last_checked_at: new Date(Date.now() - 3_600_000).toISOString(),
};
const never: PublishAccount = { ...base, id: "a2", account_name: "Новый", handle: "new", health_score: 100, health_reasons: [], last_checked_at: null };

const healthCheck = vi.fn();
const pub = {
  accounts: [base, never], groups: [], personas: [], busy: null,
  healthCheck, updateAccount: vi.fn(), disconnect: vi.fn(), refetch: vi.fn(),
} as unknown as UsePublishing;

beforeEach(() => {
  healthCheck.mockReset().mockResolvedValue({ checked: 2, token_expired: 0, accounts: [] });
  toastSuccess.mockClear();
  toastWarning.mockClear();
});

describe("здоровье в таблице аккаунтов", () => {
  it("подсказка показывает причины и время проверки", async () => {
    render(<AccountsTable pub={pub} />);
    fireEvent.focus(screen.getByLabelText("Здоровье Клиника Айва"));
    expect((await screen.findAllByText(/истекает через 5 дн/))[0]).toBeTruthy();
    expect((await screen.findAllByText(/Проверен 1 час назад/))[0]).toBeTruthy();
  });

  it("непроверенный аккаунт честно говорит, что оценка ещё не считалась", async () => {
    render(<AccountsTable pub={pub} />);
    fireEvent.focus(screen.getByLabelText("Здоровье Новый"));
    expect((await screen.findAllByText(/ещё не считалась/))[0]).toBeTruthy();
    expect((await screen.findAllByText(/ещё не проверялся/))[0]).toBeTruthy();
  });

  it("«Проверить все» зовёт проверку всего проекта и отчитывается цифрами", async () => {
    render(<AccountsTable pub={pub} />);
    fireEvent.click(screen.getByRole("button", { name: /Проверить все/ }));
    await waitFor(() => expect(healthCheck).toHaveBeenCalledWith());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Проверено 2 — все токены живые"));
  });

  it("протухшие токены — предупреждение, а не «успех»", async () => {
    healthCheck.mockResolvedValueOnce({ checked: 2, token_expired: 1, accounts: [] });
    render(<AccountsTable pub={pub} />);
    fireEvent.click(screen.getByRole("button", { name: /Проверить все/ }));
    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith("Проверено 2, протухших токенов: 1"));
  });

  it("«Проверить сейчас» в меню строки — только этот аккаунт", async () => {
    render(<AccountsTable pub={pub} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Действия для Клиника Айва" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Проверить сейчас/ }));
    await waitFor(() => expect(healthCheck).toHaveBeenCalledWith(["a1"]));
  });
});
