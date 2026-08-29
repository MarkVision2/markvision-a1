import { test, expect } from "@playwright/test";

test.describe("Login form validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  });

  test("показывает ошибки при пустой отправке", async ({ page }) => {
    await page.getByRole("button", { name: /Войти в платформу/i }).click();
    // Пустая отправка подсвечивает оба поля и называет их, а не «минимум N символов»
    const fieldErrors = page.locator("p.text-destructive");
    await expect(fieldErrors.filter({ hasText: /логин|email/i }).first()).toBeVisible();
    await expect(fieldErrors.filter({ hasText: /пароль/i }).first()).toBeVisible();
  });

  test("кнопка показывает/скрывает пароль", async ({ page }) => {
    const pw = page.getByLabel("Пароль");
    await pw.fill("secret123");
    await expect(pw).toHaveAttribute("type", "password");
    // Eye button — ближайшая кнопка справа от input
    await page.locator("button[type=button]").filter({ has: page.locator("svg") }).last().click();
    await expect(pw).toHaveAttribute("type", "text");
  });

  test("переход на восстановление пароля", async ({ page }) => {
    await page.getByRole("button", { name: /Забыли пароль\?/i }).click();
    await expect(page.getByRole("heading", { name: /Восстановл|Сброс|пароля/i })).toBeVisible();
  });
});
