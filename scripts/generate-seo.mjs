#!/usr/bin/env node
/**
 * Пост-сборка SEO: robots.txt, sitemap.xml, llms.txt и статические HTML для
 * индексируемых страниц — всё из одного реестра `src/lib/seo.ts`.
 *
 * Зачем статический HTML на каждую индексируемую страницу: приложение —
 * SPA, все маршруты отдают один index.html. Googlebot JS исполняет, а вот
 * краулеры соцсетей (Facebook, WhatsApp, Telegram, Twitter) — нет. Без этого
 * шага ссылка на /lab в мессенджере показывала бы заголовок и картинку
 * главной. Vercel отдаёт существующий файл раньше SPA-rewrite, поэтому
 * dist/lab/index.html подхватывается автоматически.
 */
import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

/** Реестр написан на TS — собираем его во временный .mjs и импортируем. */
async function loadSeoRegistry() {
  const outfile = path.join(ROOT, "node_modules", ".cache", "seo-registry.mjs");
  await mkdir(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(ROOT, "src", "lib", "seo.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  return import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
}

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const escapeAttr = (s) => escapeXml(s).replace(/'/g, "&#39;");

function buildRobots({ SITE_URL, ROBOTS_DISALLOW }) {
  const disallow = ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`).join("\n");
  return `# robots.txt — генерируется scripts/generate-seo.mjs из src/lib/seo.ts.
# Правки вносить в реестр, а не сюда: файл перезаписывается при каждой сборке.

User-agent: *
Allow: /$
Allow: /lab
${disallow}

# Личный кабинет и отчёты клиентов по токен-ссылке не должны попадать в выдачу.

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

function buildSitemap({ SITE_URL }, routes) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = routes
    .map((r) => {
      const loc = `${SITE_URL}${r.path === "/" ? "/" : r.path}`;
      return [
        "  <url>",
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <lastmod>${today}</lastmod>`,
        `    <changefreq>${r.changefreq ?? "monthly"}</changefreq>`,
        `    <priority>${(r.priority ?? 0.5).toFixed(1)}</priority>`,
        "  </url>",
      ].join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildLlmsTxt({ SITE_NAME, SITE_URL }, routes) {
  const lines = routes
    .map((r) => `- [${r.title}](${SITE_URL}${r.path}): ${r.description}`)
    .join("\n");
  return `# ${SITE_NAME}

> Платформа для маркетологов и агентств: запуск рекламы Meta, CRM с WhatsApp,
> сквозная аналитика от клика до продажи и AI-генерация контента.

## Pages

${lines}
`;
}

/** Подстановка мета-тегов конкретной страницы в шаблон index.html. */
function renderHtml(template, seo, route, canonical) {
  const { SITE_NAME, SITE_LOCALE, TWITTER_HANDLE, DEFAULT_OG_IMAGE } = seo;
  const image = route.ogImage ?? DEFAULT_OG_IMAGE;
  const robots = route.index ? "index, follow, max-image-preview:large" : "noindex, nofollow";

  let html = template;

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeXml(route.title)}</title>`);
  html = html.replace(
    /<meta name="description" content="[^"]*"\s*\/>/,
    `<meta name="description" content="${escapeAttr(route.description)}" />`,
  );
  html = html.replace(
    /<link rel="canonical" href="[^"]*"\s*\/>/,
    `<link rel="canonical" href="${escapeAttr(canonical)}" />`,
  );

  const replaceMeta = (attr, key, value) => {
    const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*"\\s*/>`);
    const tag = `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`;
    html = re.test(html) ? html.replace(re, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
  };

  replaceMeta("name", "robots", robots);
  replaceMeta("property", "og:type", route.ogType ?? "website");
  replaceMeta("property", "og:site_name", SITE_NAME);
  replaceMeta("property", "og:locale", SITE_LOCALE);
  replaceMeta("property", "og:title", route.title);
  replaceMeta("property", "og:description", route.description);
  replaceMeta("property", "og:url", canonical);
  replaceMeta("property", "og:image", image);
  replaceMeta("name", "twitter:card", "summary_large_image");
  replaceMeta("name", "twitter:site", TWITTER_HANDLE);
  replaceMeta("name", "twitter:title", route.title);
  replaceMeta("name", "twitter:description", route.description);
  replaceMeta("name", "twitter:image", image);

  if (route.jsonLd?.length) {
    const blocks = route.jsonLd
      .map((b) => `    <script type="application/ld+json">\n${JSON.stringify(b, null, 2)}\n    </script>`)
      .join("\n");
    html = html.replace("</head>", `${blocks}\n  </head>`);
  }

  return html;
}

async function main() {
  if (!existsSync(DIST)) {
    console.error("[seo] dist/ не найден — сначала vite build");
    process.exit(1);
  }

  const seo = await loadSeoRegistry();
  const routes = seo.indexableRoutes();

  await writeFile(path.join(DIST, "robots.txt"), buildRobots(seo), "utf8");
  await writeFile(path.join(DIST, "sitemap.xml"), buildSitemap(seo, routes), "utf8");
  await writeFile(path.join(DIST, "llms.txt"), buildLlmsTxt(seo, routes), "utf8");

  const template = await readFile(path.join(DIST, "index.html"), "utf8");
  const written = [];

  for (const route of routes) {
    const canonical = seo.canonicalFor(route.path);
    const html = renderHtml(template, seo, route, canonical);
    if (route.path === "/") {
      await writeFile(path.join(DIST, "index.html"), html, "utf8");
    } else {
      const dir = path.join(DIST, route.path.replace(/^\//, ""));
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "index.html"), html, "utf8");
    }
    written.push(route.path);
  }

  // Отдельная заглушка SPA для всех НЕиндексируемых маршрутов.
  //
  // Раньше её роль играл dist/index.html — тот же файл, что и главная. Из-за
  // этого сырой HTML любого приватного адреса (включая отчёт клиента по
  // токен-ссылке) содержал `robots: index`, и только потом JS менял его на
  // noindex. Теперь vercel.json отправляет такие адреса на app.html, где
  // noindex стоит сразу; конкретные метатеги дорисует SeoManager.
  const fallback = renderHtml(
    template,
    seo,
    {
      path: "*",
      title: `${seo.SITE_NAME} — личный кабинет`,
      description: "Личный кабинет MarkVision AI.",
      index: false,
    },
    `${seo.SITE_URL}/`,
  );
  await writeFile(path.join(DIST, "app.html"), fallback, "utf8");

  await rm(path.join(ROOT, "node_modules", ".cache", "seo-registry.mjs"), { force: true });

  console.log(
    `[seo] robots.txt, sitemap.xml, llms.txt, app.html + статический HTML: ${written.join(", ")}`,
  );
}

main().catch((e) => {
  console.error("[seo] ошибка:", e);
  process.exit(1);
});
