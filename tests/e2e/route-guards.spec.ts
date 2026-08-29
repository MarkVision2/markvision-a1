import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Каждый маршрут под RequireAuth обязан уводить неавторизованного на /login.
 * Список берём из самого App.tsx, чтобы новый маршрут нельзя было добавить
 * мимо этой проверки. Публичные: /login, /reset-password, /lab, /client/:token.
 */
function protectedRoutes(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../../src/App.tsx"), "utf8");
  const routes: string[] = [];
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<RequireAuth>/g)) {
    // :id → конкретное значение, маршрут от этого не перестаёт быть защищённым
    routes.push(m[1].replace(/:[A-Za-z]+/g, "e2e-probe"));
  }
  return routes;
}

const PROTECTED = protectedRoutes();

test("список защищённых маршрутов разобран из App.tsx", () => {
  expect(PROTECTED.length).toBeGreaterThan(25);
  expect(PROTECTED).toContain("/dashboard");
});

for (const path of PROTECTED) {
  test(`без сессии ${path} уводит на /login`, async ({ page }) => {
    await page.goto(path);
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
    await expect(page.getByLabel("Email или Логин")).toBeVisible();
  });
}

test("публичные маршруты открываются без сессии", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();

  await page.goto("/reset-password");
  await expect(page).toHaveURL(/\/reset-password/);
});
