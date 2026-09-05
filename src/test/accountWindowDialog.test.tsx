/**
 * «Окно публикаций» аккаунта: проверка границ окна, подстановка текущих
 * значений, сохранение и сброс к настройкам группы.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountWindowDialog, validateWindow } from "@/components/publishing/AccountWindowDialog";
import type { PublishAccount, PublishGroup } from "@/lib/publishingClient";

const account = (p: Partial<PublishAccount>): PublishAccount => ({
  id: "a1", platform: "instagram", account_name: "Клиника", handle: "clinic", external_account_id: "1",
  status: "active", publish_enabled: true, daily_limit: 5, last_post_at: null, consecutive_errors: 0, last_error: null,
  token_expires_at: null, group_id: "g1", persona_id: null, timezone: null, window_start: null, window_end: null,
  ramp_enabled: false, ramp_started_at: null, health_score: 90, published_today: 0, published_day: null,
  token_refreshed_at: null, followers: null,
  ...p,
});
const group: PublishGroup = {
  id: "g1", name: "Клиники", platform: "instagram", account_ids: [], publish_strategy: "drip", per_hour: 10,
  persona_id: null, review_mode: "review_required", timezone: "Europe/Moscow", window_start: "10:00:00", window_end: "20:00:00",
  min_gap_minutes: null, jitter_minutes: null, auto_publish_after: null, approved_streak: 0,
};

describe("validateWindow", () => {
  it("пусто — ок; половина окна — ошибка; совпадение — ошибка; формат", () => {
    expect(validateWindow("", "")).toBeNull();
    expect(validateWindow("09:00", "")).toMatch(/и начало, и конец/);
    expect(validateWindow("09:00", "09:00")).toMatch(/совпадают/);
    expect(validateWindow("9:00", "21:00")).toMatch(/ЧЧ:ММ/);
    expect(validateWindow("22:00", "02:00")).toBeNull();
  });
});

describe("AccountWindowDialog", () => {
  it("показывает наследуемые настройки группы и текущее окно аккаунта", () => {
    render(<AccountWindowDialog open account={account({ window_start: "09:00:00", window_end: "21:00:00" })} group={group} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText(/10:00–20:00, Europe\/Moscow/)).toBeTruthy();
    expect((screen.getByLabelText("Начало окна") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("Конец окна") as HTMLInputElement).value).toBe("21:00");
  });

  it("половина окна не сохраняется, полное окно уходит в onSave и закрывает диалог", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    render(<AccountWindowDialog open account={account({})} group={group} onClose={onClose} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Начало окна"), { target: { value: "22:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/и начало, и конец/);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Конец окна"), { target: { value: "02:00" } });
    expect(screen.getByText(/Окно через полночь/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ timezone: null, window_start: "22:00", window_end: "02:00" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("сброс окна шлёт null — публиковать как группа", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    render(<AccountWindowDialog open account={account({ window_start: "09:00:00", window_end: "21:00:00", timezone: "Asia/Almaty" })} group={group} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Сбросить окно/ }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ timezone: "Asia/Almaty", window_start: null, window_end: null }));
  });
});
