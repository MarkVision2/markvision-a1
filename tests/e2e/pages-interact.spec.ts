import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installSupabaseMock } from "./support/supabaseMock";

/**
 * Прожимаем вкладки и кнопки внутри каждого раздела и следим, что ничего не падает.
 * Весь трафик к Supabase перехвачен фикстурами, поэтому клики безопасны: наружу
 * ничего не уходит и прод-данные не меняются.
 */
function internalRoutes(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../../src/App.tsx"), "utf8");
  const routes: string[] = [];
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<RequireAuth>([\s\S]*?)\/>\n/g)) {
    if (m[2].includes("<Navigate")) continue;
    routes.push(m[1].replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-0000000000f1"));
  }
  return routes;
}

const IGNORED = [
  /favicon/i, /websocket/i, /realtime/i, /Failed to load resource/i,
  /net::ERR_/i, /Download the React DevTools/i,
];

function collectProblems(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    if (IGNORED.some((re) => re.test(m.text()))) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Кнопки выхода/удаления проекта увели бы прогон со страницы — их пропускаем. */
const SKIP_BUTTON = /выйти|выход|удалить проект|log ?out|sign ?out|toggle sidebar/i;
// В CRM и Настройках разделы переключаются кнопками, а не [role=tab] —
// лимит должен покрывать их все, иначе часть блоков останется непрожатой.
const MAX_BUTTONS = 25;

test.describe("вкладки и кнопки разделов", () => {
  for (const path of internalRoutes()) {
    test(`${path}: вкладки и кнопки не роняют страницу`, async ({ page }) => {
      const problems = collectProblems(page);
      await installSupabaseMock(page);
      await page.goto(path);
      await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 15_000 });

      // 1. Вкладки — основные «блоки» внутри раздела
      const tabs = await page.locator("[role=tab]").all();
      for (let i = 0; i < tabs.length; i++) {
        const tab = page.locator("[role=tab]").nth(i);
        if (!(await tab.isVisible().catch(() => false))) continue;
        await tab.click({ timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(150);
        await expect(page.locator("main, [role=main]").first()).toBeVisible();
      }

      // 2. Кнопки внутри контента: открывают диалоги, меню, формы
      const names = await page
        .locator("main button:not([disabled])")
        .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()).filter(Boolean));

      let clicked = 0;
      for (const name of [...new Set(names)]) {
        if (clicked >= MAX_BUTTONS) break;
        if (SKIP_BUTTON.test(name)) continue;
        const button = page.getByRole("button", { name, exact: true }).first();
        if (!(await button.isVisible().catch(() => false))) continue;
        await button.click({ timeout: 5_000 }).catch(() => {});
        clicked++;
        await page.waitForTimeout(150);
        // Закрываем то, что открылось, и возвращаемся, если увело с маршрута
        await page.keyboard.press("Escape").catch(() => {});
        if (!page.url().includes(path)) {
          await page.goto(path);
          await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 15_000 });
        }
      }

      expect(problems, `ошибки на ${path}:\n${problems.join("\n")}`).toEqual([]);
    });
  }
});
