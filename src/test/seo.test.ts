import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ROBOTS_DISALLOW,
  SEO_ROUTES,
  SITE_URL,
  canonicalFor,
  indexableRoutes,
  seoForPath,
} from "@/lib/seo";

const appSource = readFileSync("src/App.tsx", "utf8");

/** Пути из <Route path="..."> в App.tsx — кроме служебного "*". */
function routerPaths(): string[] {
  return [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== "*");
}

describe("реестр SEO покрывает роутер", () => {
  it("у каждого маршрута приложения есть описание", () => {
    const known = new Set(SEO_ROUTES.map((r) => r.path));
    const missing = routerPaths().filter((p) => !known.has(p));
    expect(missing, `Добавьте эти маршруты в src/lib/seo.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("в реестре нет путей, которых больше нет в роутере", () => {
    const inRouter = new Set(routerPaths());
    const stale = SEO_ROUTES.filter((r) => !inRouter.has(r.path)).map((r) => r.path);
    expect(stale, `Удалите из src/lib/seo.ts: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("качество заголовков и описаний", () => {
  it("title не длиннее 65 символов — иначе Google обрежет", () => {
    const tooLong = SEO_ROUTES.filter((r) => r.title.length > 65).map(
      (r) => `${r.path} (${r.title.length})`,
    );
    expect(tooLong).toEqual([]);
  });

  it("description индексируемых страниц укладывается в 80–170 символов", () => {
    const bad = indexableRoutes()
      .filter((r) => r.description.length < 80 || r.description.length > 170)
      .map((r) => `${r.path} (${r.description.length})`);
    expect(bad).toEqual([]);
  });

  it("заголовки уникальны — дубли размывают выдачу", () => {
    const titles = indexableRoutes().map((r) => r.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("описания непустые у всех маршрутов", () => {
    expect(SEO_ROUTES.every((r) => r.description.trim().length > 0)).toBe(true);
  });
});

describe("приватные разделы закрыты от индексации", () => {
  const PRIVATE = [
    "/client/:token",
    "/crm",
    "/settings",
    "/settings/connection",
    "/dashboard",
    "/analytics",
    "/finance",
    "/reports",
    "/login",
    "/reset-password",
  ];

  it.each(PRIVATE)("%s помечен noindex", (path) => {
    expect(seoForPath(path.replace(":token", "abc123")).index).toBe(false);
  });

  it("в индекс попадают только главная и лендинг практикума", () => {
    expect(indexableRoutes().map((r) => r.path).sort()).toEqual(["/", "/lab"]);
  });

  it("отчёт клиента по токен-ссылке не индексируется ни при каком токене", () => {
    for (const token of ["abc", "9f2c-31", "TOKEN_1"]) {
      expect(seoForPath(`/client/${token}`).index).toBe(false);
    }
  });

  it("robots.txt закрывает все приватные префиксы", () => {
    const privatePrefixes = ["/client/", "/crm", "/settings", "/create/", "/projects/"];
    for (const prefix of privatePrefixes) {
      expect(ROBOTS_DISALLOW).toContain(prefix);
    }
  });

  it("неизвестный маршрут по умолчанию noindex", () => {
    expect(seoForPath("/какая-то-выдуманная-страница").index).toBe(false);
  });
});

describe("канонические адреса", () => {
  it("строятся от боевого домена без хвостового слэша", () => {
    expect(canonicalFor("/lab")).toBe(`${SITE_URL}/lab`);
    expect(canonicalFor("/lab/")).toBe(`${SITE_URL}/lab`);
    expect(canonicalFor("/")).toBe(`${SITE_URL}/`);
  });

  it("домен боевой, а не превью Lovable", () => {
    expect(SITE_URL).toBe("https://www.markvision.kz");
    expect(SITE_URL).not.toContain("lovable.app");
  });
});
