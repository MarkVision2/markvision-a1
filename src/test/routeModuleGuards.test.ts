import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * «Один пункт меню = один модуль» (см. MODULES в useTeamStore).
 * Если гейт маршрута шире модуля его пункта в меню, гранулярный доступ ломается
 * в обе стороны: пункт видно, но страница редиректит — или пункт скрыт, а
 * страница открывается по прямой ссылке. Тест держит две стороны согласованными.
 */
const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

function routeGuards(): Map<string, string> {
  const src = read("App.tsx");
  const map = new Map<string, string>();
  const re = /path="([^"]+)"[^\n]*?<RequireModule module="([a-z_]+)"/g;
  for (const m of src.matchAll(re)) map.set(m[1], m[2]);
  return map;
}

function sidebarModules(): Map<string, string> {
  const src = read("components/layout/AppSidebar.tsx");
  const map = new Map<string, string>();
  const re = /url:\s*"([^"]+)"[^\n]*?module:\s*"([a-z_]+)"/g;
  for (const m of src.matchAll(re)) map.set(m[1], m[2]);
  return map;
}

describe("гейты маршрутов и модули меню", () => {
  const guards = routeGuards();
  const menu = sidebarModules();

  it("оба источника разобраны", () => {
    expect(guards.size).toBeGreaterThan(10);
    expect(menu.size).toBeGreaterThan(10);
  });

  it("каждый пункт меню ведёт на маршрут с тем же модулем", () => {
    const mismatched: string[] = [];
    for (const [url, mod] of menu) {
      const guard = guards.get(url);
      if (!guard) {
        mismatched.push(`${url}: нет маршрута с RequireModule`);
      } else if (guard !== mod) {
        mismatched.push(`${url}: меню "${mod}" ≠ маршрут "${guard}"`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});
