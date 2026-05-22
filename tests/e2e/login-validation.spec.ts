import { test, expect } from "@playwright/test";

test.describe("Login form validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  });

  test("показывает ошибки при пустой отправке", async ({ page }) => {
    await page.getByRole("button", { name: /Войти в платформу/i }).click();
    // Один из двух селекторов гарантированно покажет ошибку валидации
    const idError = page.locator("p.text-destructive", { hasText: /логин|email/i }).first();
    const pwError = page.locator("p.text-destructive", { hasText: /пароль/i }).first();
    await expect(idError.or(pwError)).toBeVisible();
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
