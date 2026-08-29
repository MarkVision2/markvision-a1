import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installSupabaseMock } from "./support/supabaseMock";

/** Внутренние маршруты берём из App.tsx, чтобы новый раздел не остался без проверки. */
function internalRoutes(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../../src/App.tsx"), "utf8");
  const routes: string[] = [];
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<RequireAuth>([\s\S]*?)\/>\n/g)) {
    // Маршруты-редиректы своей страницы не имеют — их проверяет отдельный тест ниже
    if (m[2].includes("<Navigate")) continue;
    routes.push(m[1].replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-0000000000f1"));
  }
  return routes;
}

/** Шум, не связанный с рендером: перехваченные фикстуры, realtime-сокет, картинки. */
const IGNORED = [
  /favicon/i,
  /websocket/i,
  /realtime/i,
  /Failed to load resource/i,
  /net::ERR_/i,
  /Download the React DevTools/i,
];

function collectProblems(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (IGNORED.some((re) => re.test(text))) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

test.describe("рендер внутренних страниц под сессией", () => {
  for (const path of internalRoutes()) {
    test(`${path} рендерится`, async ({ page }) => {
      const problems = collectProblems(page);
      await installSupabaseMock(page);

      await page.goto(path);

      // Не выкинуло на логин и не упёрлось в «нет доступа»
      await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
      await expect(page.getByText("Нет доступа к разделу")).toHaveCount(0);

      // Каркас приложения на месте — значит страница смонтировалась внутри AppLayout
      await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 15_000 });

      // Спиннер маршрута успел смениться содержимым.
      // textContent, а не innerText: innerText зависит от отрисовки и при
      // параллельных воркерах в headless периодически отдаёт пустую строку.
      await expect
        .poll(async () => ((await page.locator("body").textContent()) ?? "").trim().length, { timeout: 15_000 })
        .toBeGreaterThan(40);

      expect(problems, `ошибки на ${path}:\n${problems.join("\n")}`).toEqual([]);
    });
  }
});

test("маршрут-редирект /marketing/autopost ведёт в календарь контент-плана", async ({ page }) => {
  await installSupabaseMock(page);
  await page.goto("/marketing/autopost");
  await expect(page).toHaveURL(/\/marketing\/content-plan\?view=calendar$/);
});
