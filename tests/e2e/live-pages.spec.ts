import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installLiveSupabaseProxy, type ProxyStats } from "./support/liveProxy";

/**
 * Прогон внутренних страниц на РЕАЛЬНЫХ данных.
 *
 * Запускается только когда заданы E2E_EMAIL и E2E_PASSWORD — в CI без них
 * пропускается. Учётные данные берутся исключительно из переменных окружения:
 * в репозиторий они не попадают.
 *
 * Строго только навигация и чтение. Ничего не кликаем: аккаунт боевой, и клик
 * по «Запустить рассылку» или «Удалить» затронул бы живых клиентов.
 */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const PROJECT_REF = "szfgdruhlebfvcmlvxdk";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const ANON = "sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-";

test.skip(!EMAIL || !PASSWORD, "нет E2E_EMAIL / E2E_PASSWORD — прогон на живых данных пропущен");

function internalRoutes(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../../src/App.tsx"), "utf8");
  const routes: string[] = [];
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<RequireAuth>([\s\S]*?)\/>\n/g)) {
    if (m[2].includes("<Navigate")) continue;
    if (m[1].includes(":")) continue; // маршруты с :id требуют настоящую запись — отдельная история
    routes.push(m[1]);
  }
  return routes;
}

let sessionJson = "";

// Через curl, а не через request-контекст Playwright: тот не ходит сквозь
// egress-прокси окружения и получает 403 ещё до Supabase.
const run = promisify(execFile);

test.beforeAll(async () => {
  const { stdout } = await run("curl", [
    "-s", "--max-time", "30",
    "-X", "POST", `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    "-H", `apikey: ${ANON}`,
    "-H", "Content-Type: application/json",
    "--data-binary", JSON.stringify({ email: EMAIL, password: PASSWORD }),
  ], { maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(stdout) as { access_token?: string };
  expect(parsed.access_token, "вход по E2E_EMAIL/E2E_PASSWORD не прошёл").toBeTruthy();
  sessionJson = stdout;
});

const IGNORED = [
  /favicon/i, /Download the React DevTools/i, /ERR_BLOCKED_BY_CLIENT/i,
  // Мост работает на HTTP-перехвате; realtime-вебсокет через него не проходит
  /websocket/i, /realtime/i,
  // Картинки креативов лежат на fbcdn/cdninstagram — из контейнера они недоступны.
  // Прятать этим реальные проблемы нельзя: ответы Supabase с кодом >= 400 мост
  // считает отдельно и они попадают в stats.failures.
  /Failed to load resource/i, /net::ERR_/i,
];

function collect(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    if (IGNORED.some((re) => re.test(m.text()))) return;
    problems.push(`console: ${m.text()}`);
  });
  return problems;
}

for (const path of internalRoutes()) {
  test(`живые данные: ${path}`, async ({ page }) => {
    const problems = collect(page);
    const stats: ProxyStats = { requests: 0, failures: [] };
    await installLiveSupabaseProxy(page, stats);
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [`sb-${PROJECT_REF}-auth-token`, sessionJson] as const,
    );

    await page.goto(path);
    await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Нет доступа к разделу")).toHaveCount(0);
    await expect
      .poll(async () => ((await page.locator("body").textContent()) ?? "").trim().length, { timeout: 20_000 })
      .toBeGreaterThan(40);
    // Даём догрузиться отложенным запросам раздела
    await page.waitForTimeout(3_000);

    // Страница должна была реально сходить в базу, иначе проверка ничего не значит
    expect(stats.requests, `${path}: ни одного запроса к Supabase — мост не сработал`).toBeGreaterThan(0);
    expect(
      [...problems, ...stats.failures],
      `проблемы на ${path} (запросов к Supabase: ${stats.requests}):\n${[...problems, ...stats.failures].join("\n")}`,
    ).toEqual([]);
  });
}
