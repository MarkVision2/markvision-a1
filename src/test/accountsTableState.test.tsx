/**
 * Строка аккаунта говорит правду о состоянии.
 *
 * Три вещи, на которые оператор смотрит перед заливкой ролика: возьмёт ли
 * планировщик аккаунт, сколько он уже опубликовал сегодня и когда выходил
 * последний пост. Каждая из них раньше показывала не то: «Активен» у аккаунта
 * с выключенной публикацией, вчерашний счётчик как сегодняшний, и своё
 * округление дней вместо общего формата.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AccountsTable } from "@/components/publishing/AccountsTable";
import type { PublishAccount, PublishGroup } from "@/lib/publishingClient";
import type { UsePublishing } from "@/hooks/usePublishing";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date());

const base: PublishAccount = {
  id: "a1", platform: "instagram", account_name: "Клиника Айва", handle: "aiva",
  external_account_id: "1", status: "active", publish_enabled: true, daily_limit: 3,
  last_post_at: null, consecutive_errors: 0, last_error: null, token_expires_at: null,
  group_id: null, persona_id: null, timezone: null, window_start: null, window_end: null,
  ramp_enabled: false, ramp_started_at: null, health_score: 85, published_today: 0,
  published_day: null, token_refreshed_at: null, followers: null,
};

const group: PublishGroup = {
  id: "g1", name: "Алматы", platform: null, account_ids: [], publish_strategy: "drip", per_hour: 10,
  persona_id: null, review_mode: "review_required", timezone: "Asia/Almaty", window_start: null,
  window_end: null, min_gap_minutes: 120, jitter_minutes: 20, auto_publish_after: null, approved_streak: 0,
};

const makePub = (accounts: PublishAccount[], patch: Partial<UsePublishing> = {}) => ({
  accounts, groups: [group], personas: [], busy: null, settings: null, metrics: null,
  healthCheck: vi.fn(), updateAccount: vi.fn().mockResolvedValue({}), disconnect: vi.fn(), refetch: vi.fn(),
  ...patch,
} as unknown as UsePublishing);

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLTableRowElement;

describe("состояние аккаунта в таблице", () => {
  it("«Активен» с выключенной публикацией честно говорит, что заданий не будет", () => {
    render(<AccountsTable pub={makePub([{ ...base, publish_enabled: false }])} />);
    const row = rowOf("Клиника Айва");
    expect(within(row).getByText("Активен")).toBeTruthy();
    expect(within(row).getByText(/не публикует: публикация выключена/)).toBeTruthy();
  });

  it("здоровье ниже порога планировщика тоже видно в строке, а не только в тултипе", () => {
    render(<AccountsTable pub={makePub([{ ...base, health_score: 5 }])} />);
    expect(within(rowOf("Клиника Айва")).getByText(/не публикует: здоровье ниже 20/)).toBeTruthy();
  });

  it("годный аккаунт лишних пометок не носит", () => {
    render(<AccountsTable pub={makePub([base])} />);
    expect(within(rowOf("Клиника Айва")).queryByText(/не публикует/)).toBeNull();
  });

  it("«Сегодня» обнуляется со сменой дня — как считает claim_publish_jobs", () => {
    render(<AccountsTable pub={makePub([{ ...base, published_today: 3, published_day: "2020-01-01" }])} />);
    const cell = within(rowOf("Клиника Айва")).getByLabelText("Публикаций сегодня у Клиника Айва");
    expect(cell.textContent).toMatch(/0 \/ 3/);
  });

  it("сегодняшний счётчик показывается как есть", () => {
    render(<AccountsTable pub={makePub([{ ...base, published_today: 2, published_day: today }])} />);
    const cell = within(rowOf("Клиника Айва")).getByLabelText("Публикаций сегодня у Клиника Айва");
    expect(cell.textContent).toMatch(/2 \/ 3/);
  });

  it("последний пост — общий формат раздела, а не своё округление дней", () => {
    const iso = new Date(Date.now() - 3.6 * 86_400_000).toISOString();
    render(<AccountsTable pub={makePub([{ ...base, last_post_at: iso }])} />);
    // 3,6 суток: округление вверх, как в fmtRelative у заданий. Раньше здесь
    // было усечение вниз, и та же публикация значилась «3 дн. назад» в
    // аккаунтах и «4 дн. назад» в очереди.
    expect(within(rowOf("Клиника Айва")).getByText("4 дн. назад")).toBeTruthy();
  });

  it("группа показана подписью, а назначается из меню строки", async () => {
    const updateAccount = vi.fn().mockResolvedValue({});
    render(<AccountsTable pub={makePub([{ ...base, group_id: "g1" }], { updateAccount })} />);
    expect(within(rowOf("Клиника Айва")).getByText("Алматы")).toBeTruthy();
    // Колонки с выпадающим списком «Без…» больше нет — её место заняло состояние.
    expect(screen.queryByRole("columnheader", { name: "Группа" })).toBeNull();

    // Radix DropdownMenu раскрывается с клавиатуры — как в остальных тестах раздела.
    fireEvent.keyDown(screen.getByRole("button", { name: "Действия для Клиника Айва" }), { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("menuitem", { name: /Группа: Алматы/ }), { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Без группы" }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith("a1", { group_id: null }));
  });
});
