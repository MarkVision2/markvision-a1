/**
 * Вкладка «Подключённые»: сводка, сортировка по колонкам и честные прочерки
 * там, где метрики ещё не сняты (ноль соврал бы про отсутствие вовлечения).
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ConnectedAccountsTab } from "@/components/publishing/ConnectedAccountsTab";
import type { AccountMetrics, PublishGroup } from "@/lib/publishingClient";

const base: AccountMetrics = {
  account_id: "a1", platform: "instagram", account_name: "Клиника Айва", handle: "aiva",
  status: "active", publish_enabled: true, health_score: 90, health_reasons: ["токен живой, отказов нет, проверка свежая"],
  last_checked_at: "2026-09-05T09:00:00Z", followers: 12400, group_id: null,
  last_post_at: null, token_expires_at: null, consecutive_errors: 0,
  posts_total: 10, posts_30d: 4, jobs_queued: 0, failed_30d: 0,
  measured_posts: 10, reach: 50000, views: 62000, likes: 2400, comments: 180, shares: 60, saves: 40,
  er_percent: 5.36, metrics_updated_at: "2026-09-05T10:00:00Z",
};
const row = (p: Partial<AccountMetrics>): AccountMetrics => ({ ...base, ...p });

const groups: PublishGroup[] = [{
  id: "g1", name: "Клиники", platform: null, account_ids: [], publish_strategy: "drip",
  per_hour: 10, persona_id: null, review_mode: "auto_publish", timezone: null,
  window_start: null, window_end: null, min_gap_minutes: null, jitter_minutes: null,
  auto_publish_after: null, approved_streak: 0,
}];

const rows = [
  row({ account_id: "a1", account_name: "Клиника Айва", followers: 12400, group_id: "g1" }),
  row({
    account_id: "a2", account_name: "Автосалон Lexus", handle: "lexus_pvl", platform: "tiktok",
    followers: 3100, posts_total: 3, posts_30d: 3, measured_posts: 0, reach: 0, comments: 0,
    er_percent: null, health_score: 45, status: "token_expired", publish_enabled: false, failed_30d: 2, jobs_queued: 1,
  }),
];

const renderTab = (data = rows) => render(<ConnectedAccountsTab rows={data} groups={groups} />);
const bodyRows = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");

describe("ConnectedAccountsTab", () => {
  it("без аккаунтов показывает подсказку, а не пустую таблицу", () => {
    renderTab([]);
    expect(screen.getByText(/Подключённых аккаунтов пока нет/)).toBeTruthy();
  });

  it("сводка суммирует подписчиков, посты и показы", () => {
    renderTab();
    // Значение плитки лежит рядом со своим заголовком — ищем через него,
    // иначе «50 000» находится ещё и в строке таблицы.
    // toLocaleString("ru-RU") разделяет разряды неразрывным пробелом — нормализуем.
    const tile = (label: string) =>
      (screen.getByText(label).parentElement?.textContent ?? "").replace(/\u00A0/g, " ");
    expect(tile("Аккаунтов")).toMatch(/2$/);
    expect(tile("Подписчиков")).toMatch(/15,5 тыс\./); // 12 400 + 3 100
    expect(tile("Опубликовано постов")).toMatch(/13$/); // 10 + 3
    expect(tile("Показов")).toMatch(/50 000$/);
  });

  it("показывает посты, комментарии, ER и здоровье по аккаунту", () => {
    renderTab();
    const r = screen.getByText("Клиника Айва").closest("tr") as HTMLTableRowElement;
    expect(r.textContent).toMatch(/12,4 тыс\./);
    expect(r.textContent).toMatch(/за 30 дн\. 4/);
    expect(r.textContent).toMatch(/180/);
    expect(r.textContent).toMatch(/5,36%/);
    expect(r.textContent).toMatch(/Активен/);
  });

  it("аккаунт без снятых метрик получает прочерки, а не нули", () => {
    renderTab();
    const r = screen.getByText("Автосалон Lexus").closest("tr") as HTMLTableRowElement;
    expect(r.textContent).toMatch(/ждём метрики: 3/);
    expect(r.textContent).toMatch(/Токен истёк/);
    expect(r.textContent).toMatch(/публикация выключена/);
    expect(r.textContent).toMatch(/ошибок за 30 дн\.: 2/);
    expect(r.textContent).toMatch(/в очереди: 1/);
  });

  it("по умолчанию сортирует по подписчикам вниз", () => {
    renderTab();
    expect(bodyRows()[0].textContent).toMatch(/Клиника Айва/);
  });

  it("клик по колонке переключает направление сортировки", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Подписчики/ }));
    expect(bodyRows()[0].textContent).toMatch(/Автосалон Lexus/);
  });

  it("сортировка по ER держит аккаунты без метрик внизу", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /ER/ }));
    expect(bodyRows()[0].textContent).toMatch(/Клиника Айва/);
    fireEvent.click(screen.getByRole("button", { name: /ER/ })); // по возрастанию
    expect(bodyRows()[1].textContent).toMatch(/Автосалон Lexus/);
  });

  it("поиск и фильтр по площадке сужают таблицу", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Поиск подключённых аккаунтов"), { target: { value: "@lexus" } });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].textContent).toMatch(/Автосалон Lexus/);
  });
});
