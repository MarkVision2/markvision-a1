import { test, expect } from "@playwright/test";

test.describe("Login form validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Добро пожаловать" })).toBeVisible();
  });

  test("показывает ошибки при пустой отправке", async ({ page }) => {
    // Тексты ошибок приходят из zod-схемы AuthForm («Минимум 3 символа» и т.п.) и
    // названий полей не содержат, поэтому проверяем факт ошибки под каждым полем,
    // а не конкретную формулировку.
    const errors = page.locator("form p.text-destructive");
    await expect(errors).toHaveCount(0);

    await page.getByRole("button", { name: /Войти в платформу/i }).click();

    await expect(errors).toHaveCount(2);
    await expect(errors.first()).toBeVisible();
    await expect(errors.first()).not.toBeEmpty();
    // Форма не отправилась — остались на /login
    await expect(page).toHaveURL(/\/login$/);
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
