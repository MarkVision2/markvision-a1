import { test, expect } from "@playwright/test";

test.describe("Smoke", () => {
  test("открывает страницу логина и рендерит форму", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveTitle(/MarkVision/i);
    await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
    await expect(page.getByLabel("Email или Логин")).toBeVisible();
    await expect(page.getByLabel("Пароль")).toBeVisible();
    await expect(page.getByRole("button", { name: /Войти в платформу/i })).toBeVisible();
  });

  test("неавторизованный пользователь перенаправляется на /login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  });

  test("страница 404 показывает NotFound", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-xyz");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Oops! Page not found")).toBeVisible();
  });

  test("главная без сессии редиректит на /login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
    await expect(page.getByLabel("Email или Логин")).toBeVisible();
  });
});
