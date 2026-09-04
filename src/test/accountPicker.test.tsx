/**
 * Выбор аккаунтов для массовой заливки: пресеты не тянут негодные аккаунты,
 * поиск сужает список, «выбрать все показанные» работает по видимому срезу.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountPicker } from "@/components/publishing/AccountPicker";
import type { PublishAccount, PublishGroup } from "@/lib/publishingClient";

const base: PublishAccount = {
  id: "a1", platform: "instagram", account_name: "Клиника Айва", handle: "aiva",
  external_account_id: "1", status: "active", publish_enabled: true, daily_limit: 10,
  last_post_at: null, consecutive_errors: 0, last_error: null, token_expires_at: null,
  group_id: null, persona_id: null, timezone: null, window_start: null, window_end: null,
  ramp_enabled: false, ramp_started_at: null, health_score: 90, published_today: 0,
  published_day: null, token_refreshed_at: null, followers: null,
};
const acc = (p: Partial<PublishAccount>): PublishAccount => ({ ...base, ...p });

const accounts = [
  acc({ id: "ig1", account_name: "Клиника Айва", handle: "aiva", group_id: "g1" }),
  acc({ id: "ig2", account_name: "Автосалон Lexus", handle: "lexus_pvl" }),
  acc({ id: "tt1", account_name: "TikTok салона", handle: "lexus_tt", platform: "tiktok" }),
  acc({ id: "dead", account_name: "Протухший", handle: "old", status: "token_expired" }),
];

const groups: PublishGroup[] = [{
  id: "g1", name: "Клиники", platform: null, account_ids: [], publish_strategy: "drip",
  per_hour: 10, persona_id: null, review_mode: "auto_publish", timezone: null,
  window_start: null, window_end: null, min_gap_minutes: null, jitter_minutes: null,
  auto_publish_after: null, approved_streak: 0,
}];

function setup(selected: string[] = []) {
  const onChange = vi.fn();
  render(
    <AccountPicker accounts={accounts} groups={groups} selected={new Set(selected)} onChange={onChange} />,
  );
  return onChange;
}

describe("AccountPicker", () => {
  it("пресет «Все активные» не берёт аккаунт с протухшим токеном", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /Все активные \(3\)/ }));
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(["ig1", "ig2", "tt1"]);
  });

  it("пресет площадки выбирает только её аккаунты", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /TikTok \(1\)/ }));
    expect([...onChange.mock.calls[0][0]]).toEqual(["tt1"]);
  });

  it("пресет группы выбирает её состав", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /Клиники \(1\)/ }));
    expect([...onChange.mock.calls[0][0]]).toEqual(["ig1"]);
  });

  it("негодный аккаунт помечен подсказкой и его чекбокс заблокирован", () => {
    setup();
    const cb = screen.getByRole("checkbox", { name: "Выбрать Протухший" }) as HTMLButtonElement;
    expect(cb.disabled).toBe(true);
    expect(screen.getByText(/статус не «Активен»/)).toBeTruthy();
  });

  it("поиск сужает список, «выбрать все показанные» берёт только найденное", () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText("Поиск аккаунтов"), { target: { value: "lexus" } });
    expect(screen.queryByText("Клиника Айва")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Выбрать все показанные аккаунты" }));
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(["ig2", "tt1"]);
  });

  it("«Снять выбор» очищает набор", () => {
    const onChange = setup(["ig1", "ig2"]);
    fireEvent.click(screen.getByRole("button", { name: /Снять выбор/ }));
    expect([...onChange.mock.calls[0][0]]).toEqual([]);
  });

  it("показывает счётчик выбранных", () => {
    setup(["ig1", "ig2"]);
    expect(screen.getByText("Выбрано: 2")).toBeTruthy();
  });
});
