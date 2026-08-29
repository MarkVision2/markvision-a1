import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  DEFAULT_OG_IMAGE,
  SITE_LOCALE,
  SITE_NAME,
  TWITTER_HANDLE,
  canonicalFor,
  seoForPath,
} from "@/lib/seo";

/** Ставит/обновляет <meta>, не плодя дубли. */
function upsertMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** JSON-LD страницы держим отдельным помеченным тегом, чтобы чистить при переходе. */
const JSONLD_MARK = "data-seo-jsonld";

function applyJsonLd(blocks: Record<string, unknown>[]) {
  document.head.querySelectorAll(`script[${JSONLD_MARK}]`).forEach((n) => n.remove());
  for (const block of blocks) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute(JSONLD_MARK, "1");
    script.textContent = JSON.stringify(block);
    document.head.appendChild(script);
  }
}

/**
 * Единая точка SEO для SPA.
 *
 * Все маршруты отдают один index.html, поэтому без этого компонента у каждой
 * страницы был бы заголовок и описание главной. Здесь же решается вопрос
 * приватности: разделы за логином и отчёты клиентов по токен-ссылке получают
 * `robots: noindex, nofollow` — попадание такой ссылки в выдачу означало бы
 * публикацию данных клиента.
 */
export function SeoManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    const route = seoForPath(pathname);
    const canonical = canonicalFor(pathname);
    const image = route.ogImage ?? DEFAULT_OG_IMAGE;

    document.title = route.title;
    upsertMeta('meta[name="description"]', "name", "description", route.description);
    upsertMeta(
      'meta[name="robots"]',
      "name",
      "robots",
      route.index ? "index, follow, max-image-preview:large" : "noindex, nofollow",
    );
    upsertLink("canonical", canonical);

    upsertMeta('meta[property="og:type"]', "property", "og:type", route.ogType ?? "website");
    upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);
    upsertMeta('meta[property="og:locale"]', "property", "og:locale", SITE_LOCALE);
    upsertMeta('meta[property="og:title"]', "property", "og:title", route.title);
    upsertMeta('meta[property="og:description"]', "property", "og:description", route.description);
    upsertMeta('meta[property="og:url"]', "property", "og:url", canonical);
    upsertMeta('meta[property="og:image"]', "property", "og:image", image);

    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    upsertMeta('meta[name="twitter:site"]', "name", "twitter:site", TWITTER_HANDLE);
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", route.title);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", route.description);
    upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", image);

    applyJsonLd(route.jsonLd ?? []);
  }, [pathname]);

  return null;
}
