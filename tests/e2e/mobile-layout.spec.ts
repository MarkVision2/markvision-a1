import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installSupabaseMock } from "./support/supabaseMock";

/**
 * Вёрстка внутренних страниц на телефоне (iPhone 13, 390×844).
 *
 * Проверяем две вещи, которые ломают пользование с телефона:
 *  1. страница не едет горизонтально;
 *  2. содержимое не уезжает за правый край экрана.
 *
 * Горизонтальные скроллеры (таблицы с min-w-[…], ряды чипов) — штатный приём,
 * поэтому элементы внутри прокручиваемого предка не считаются обрезанными.
 * Декоративные подсветки с pointer-events-none намеренно вынесены за край.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

function internalRoutes(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../../src/App.tsx"), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<RequireAuth>([\s\S]*?)\/>\n/g)) {
    if (m[2].includes("<Navigate")) continue;
    out.push(m[1].replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-0000000000f1"));
  }
  return out;
}

for (const path of internalRoutes()) {
  test(`телефон: ${path} помещается в экран`, async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto(path);
    await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);

    const r = await page.evaluate(() => {
      const vw = window.innerWidth;
      const scrollableAncestor = (el: Element | null): boolean => {
        while (el && el !== document.body) {
          const st = getComputedStyle(el);
          if (/(auto|scroll)/.test(st.overflowX) && el.scrollWidth > el.clientWidth + 1) return true;
          el = el.parentElement;
        }
        return false;
      };
      const clipped: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right <= vw + 1) continue;
        if (el.children.length > 0) continue;
        if (getComputedStyle(el).pointerEvents === "none") continue;
        if (scrollableAncestor(el.parentElement)) continue;
        const txt = (el.textContent ?? "").trim().slice(0, 30);
        clipped.push(`<${el.tagName.toLowerCase()}> "${txt}" правый край ${Math.round(b.right)} > ${vw}`);
      }
      return { vw, scrollWidth: document.documentElement.scrollWidth, clipped };
    });

    expect(r.scrollWidth, `${path}: страница едет горизонтально`).toBeLessThanOrEqual(r.vw + 1);
    expect(r.clipped, `${path}: содержимое уходит за правый край:\n${r.clipped.join("\n")}`).toEqual([]);
  });
}
