/**
 * Вид «Статистика» в таблице аккаунтов: сводка, сортировка по колонкам и честные
 * прочерки там, где метрики ещё не сняты (ноль соврал бы про отсутствие
 * вовлечения). Фильтр по площадке — чипы со счётчиками.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AccountsTable } from "@/components/publishing/AccountsTable";
import type { AccountMetrics, PublishAccount } from "@/lib/publishingClient";
import type { UsePublishing } from "@/hooks/usePublishing";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const acc = (p: Partial<PublishAccount>): PublishAccount => ({
  id: "a1", platform: "instagram", account_name: "Клиника Айва", handle: "aiva", external_account_id: "1",
  status: "active", publish_enabled: true, daily_limit: 5, last_post_at: null, consecutive_errors: 0, last_error: null,
  token_expires_at: null, group_id: null, persona_id: null, timezone: null, window_start: null, window_end: null,
  ramp_enabled: false, ramp_started_at: null, health_score: 90, health_reasons: [], last_checked_at: null,
  published_today: 0, published_day: null, token_refreshed_at: null, followers: 12400,
  ...p,
});
const met = (p: Partial<AccountMetrics>): AccountMetrics => ({
  account_id: "a1", platform: "instagram", account_name: "Клиника Айва", handle: "aiva",
  status: "active", publish_enabled: true, health_score: 90, health_reasons: [], last_checked_at: null,
  followers: 12400, group_id: null, last_post_at: null, token_expires_at: null, consecutive_errors: 0,
  posts_total: 10, posts_30d: 4, jobs_queued: 0, failed_30d: 0,
  measured_posts: 10, reach: 50000, views: 62000, likes: 2400, comments: 180, shares: 60, saves: 40,
  er_percent: 5.36, metrics_updated_at: "2026-09-05T10:00:00Z",
  ...p,
});

const accounts = [
  acc({}),
  acc({ id: "a2", account_name: "Автосалон Lexus", handle: "lexus_pvl", platform: "tiktok", followers: 3100, health_score: 45, status: "token_expired", publish_enabled: false }),
];
const metrics = [
  met({}),
  met({ account_id: "a2", account_name: "Автосалон Lexus", handle: "lexus_pvl", platform: "tiktok", followers: 3100, posts_total: 3, posts_30d: 3, measured_posts: 0, reach: 0, comments: 0, er_percent: null, health_score: 45, status: "token_expired", publish_enabled: false, failed_30d: 2, jobs_queued: 1 }),
];

const pub = {
  accounts, groups: [], personas: [], busy: null, metrics: { publish: null, radar: null, videos: [], groups: [], accounts: metrics },
  healthCheck: vi.fn(), updateAccount: vi.fn(), disconnect: vi.fn(), refetch: vi.fn(),
} as unknown as UsePublishing;

const renderStats = () => {
  const r = render(<AccountsTable pub={pub} />);
  fireEvent.click(screen.getByRole("tab", { name: "Статистика" }));
  return r;
};
const bodyRows = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");

describe("таблица аккаунтов: вид «Статистика»", () => {
  it("чипы площадок показывают счётчики, вид переключается", () => {
    render(<AccountsTable pub={pub} />);
    expect(screen.getByRole("button", { name: /Instagram 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /YouTube 0/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Управление" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Статистика" }));
    expect(screen.getByText("Опубликовано постов")).toBeTruthy();
  });

  it("сводка суммирует подписчиков, посты и показы", () => {
    renderStats();
    const tile = (label: string) => (screen.getByText(label).parentElement?.textContent ?? "").replace(/\u00A0/g, " ");
    expect(tile("Аккаунтов")).toMatch(/2$/);
    expect(tile("Подписчиков")).toMatch(/15,5 тыс\./);
    expect(tile("Опубликовано постов")).toMatch(/13$/);
    expect(tile("Показов")).toMatch(/50 000$/);
  });

  it("строка: посты, комментарии, ER, здоровье и статус", () => {
    renderStats();
    const r = screen.getByText("Клиника Айва").closest("tr") as HTMLTableRowElement;
    expect(r.textContent).toMatch(/за 30 дн\. 4/);
    expect(r.textContent).toMatch(/180/);
    expect(r.textContent).toMatch(/5,36%/);
    expect(r.textContent).toMatch(/Активен/);
  });

  it("аккаунт без снятых метрик получает прочерки и пояснения, а не нули", () => {
    renderStats();
    const r = screen.getByText("Автосалон Lexus").closest("tr") as HTMLTableRowElement;
    expect(r.textContent).toMatch(/ждём метрики: 3/);
    expect(r.textContent).toMatch(/Токен истёк/);
    expect(r.textContent).toMatch(/публикация выключена/);
    expect(r.textContent).toMatch(/ошибок за 30 дн\.: 2/);
    expect(r.textContent).toMatch(/в очереди: 1/);
  });

  it("сортировка: по подписчикам вниз по умолчанию, клик меняет направление, пустой ER внизу", () => {
    renderStats();
    expect(bodyRows()[0].textContent).toMatch(/Клиника Айва/);
    fireEvent.click(screen.getByRole("button", { name: /Подписчики/ }));
    expect(bodyRows()[0].textContent).toMatch(/Автосалон Lexus/);
    fireEvent.click(screen.getByRole("button", { name: /^ER$/ }));
    expect(bodyRows()[0].textContent).toMatch(/Клиника Айва/);
    fireEvent.click(screen.getByRole("button", { name: /^ER$/ }));
    expect(bodyRows()[1].textContent).toMatch(/Автосалон Lexus/);
  });

  it("чип площадки и поиск сужают таблицу в обоих видах", () => {
    renderStats();
    fireEvent.click(screen.getByRole("button", { name: /TikTok 1/ }));
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].textContent).toMatch(/Автосалон Lexus/);
    fireEvent.click(screen.getByRole("tab", { name: "Управление" }));
    expect(bodyRows()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Все 2/ }));
    fireEvent.change(screen.getByLabelText("Поиск аккаунтов"), { target: { value: "@aiva" } });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].textContent).toMatch(/Клиника Айва/);
  });
});
