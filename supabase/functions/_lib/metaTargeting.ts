// Сборка targeting spec для Meta ad set.
//
// Это тот кусок логики, который раньше жил только внутри n8n: фронт шлёт
// человеческие названия («Алматы», «фитнес»), а Meta принимает исключительно
// свои ключи (geo_locations.cities[].key, interests[].id). Резолв идёт через
// Graph /search и кэшируется в meta_targeting_cache — без кэша пакетный
// авто-запуск упирается в rate limit.
//
// Чистые функции (normalize/build/pick) покрыты src/test/metaTargeting.test.ts.
// Импорты Graph — только внутри resolveTargeting.

import { graphGet } from "./metaGraph.ts";

// ============================================================
// Типы
// ============================================================

export interface TargetingInput {
  /** Названия городов/регионов/стран как их ввёл человек. */
  geo: string[];
  ageMin: number | null;
  ageMax: number | null;
  gender: "all" | "male" | "female";
  /** Языки словами («Русский», «Russian») или готовые locale id. */
  languages: string[];
  /** Интересы: строки или объекты {id,name} — второе уже резолвить не нужно. */
  interests: Array<string | { id?: string; name?: string }>;
  exclusions: Array<string | { id?: string; name?: string }>;
  /** Двухбуквенный код страны по умолчанию, если гео не распознано. */
  defaultCountry: string;
}

export interface ResolvedGeo {
  countries: string[];
  cities: Array<{ key: string; radius: number; distance_unit: "kilometer" }>;
  regions: Array<{ key: string }>;
}

export interface ResolvedTargeting {
  geo: ResolvedGeo;
  ageMin: number;
  ageMax: number;
  genders: number[];
  locales: number[];
  interests: Array<{ id: string; name: string }>;
  exclusions: Array<{ id: string; name: string }>;
  /** Названия, которые Meta не опознала — показываем в статусе запуска. */
  unresolved: string[];
}

export interface GeoSearchItem {
  key: string;
  name: string;
  type: string;
  country_code?: string;
  region?: string;
}

// ============================================================
// Чистые функции
// ============================================================

/** Meta: 1 — мужчины, 2 — женщины; пустой массив = все. */
export function gendersToMeta(gender: string | null | undefined): number[] {
  const g = (gender ?? "all").toLowerCase();
  if (g === "male" || g === "m" || g === "муж") return [1];
  if (g === "female" || g === "f" || g === "жен") return [2];
  return [];
}

/** Meta принимает возраст 13..65; 65 означает «65+». */
export function clampAge(min: number | null, max: number | null): { ageMin: number; ageMax: number } {
  const lo = Number.isFinite(min as number) ? Math.max(13, Math.min(65, Math.round(min as number))) : 18;
  const hi = Number.isFinite(max as number) ? Math.max(13, Math.min(65, Math.round(max as number))) : 65;
  return lo <= hi ? { ageMin: lo, ageMax: hi } : { ageMin: hi, ageMax: lo };
}

/**
 * Страна по умолчанию, когда гео не задано или не распознано.
 * Кабинеты этого проекта — СНГ, дефолты берём из таймзоны, затем из валюты.
 */
export function defaultCountryFor(timezone?: string | null, currency?: string | null): string {
  const tz = (timezone ?? "").toLowerCase();
  if (tz.includes("almaty") || tz.includes("aqtobe") || tz.includes("qostanay")) return "KZ";
  if (tz.includes("moscow") || tz.includes("yekaterinburg") || tz.includes("novosibirsk")) return "RU";
  if (tz.includes("kyiv") || tz.includes("kiev")) return "UA";
  if (tz.includes("minsk")) return "BY";
  if (tz.includes("tashkent")) return "UZ";
  if (tz.includes("bishkek")) return "KG";
  if (tz.includes("baku")) return "AZ";
  if (tz.includes("tbilisi")) return "GE";
  if (tz.includes("dubai")) return "AE";

  const cur = (currency ?? "").toUpperCase();
  const byCurrency: Record<string, string> = {
    KZT: "KZ", RUB: "RU", UAH: "UA", BYN: "BY", UZS: "UZ", KGS: "KG", AZN: "AZ", GEL: "GE", AED: "AE",
  };
  return byCurrency[cur] ?? "KZ";
}

/** Нормализация строки запроса для ключа кэша. */
export function cacheKeyFor(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Лучшее совпадение из ответа /search?type=adgeolocation.
 * Приоритет: точное совпадение имени в нужной стране → любое в нужной стране
 * → точное совпадение где угодно → первый результат.
 */
export function pickGeoMatch(
  items: GeoSearchItem[],
  query: string,
  preferCountry?: string | null,
): GeoSearchItem | null {
  if (!items.length) return null;
  const q = cacheKeyFor(query);
  const country = (preferCountry ?? "").toUpperCase();
  const exact = items.filter((i) => cacheKeyFor(i.name ?? "") === q);
  const inCountry = (list: GeoSearchItem[]) =>
    country ? list.filter((i) => (i.country_code ?? "").toUpperCase() === country) : [];

  return inCountry(exact)[0] ?? inCountry(items)[0] ?? exact[0] ?? items[0] ?? null;
}

/** Раскладка найденного гео по секциям geo_locations. */
export function geoItemToSpec(item: GeoSearchItem, spec: ResolvedGeo, radiusKm = 25): void {
  const type = (item.type ?? "").toLowerCase();
  if (type === "country") {
    const code = (item.country_code ?? item.key ?? "").toUpperCase();
    if (code && !spec.countries.includes(code)) spec.countries.push(code);
    return;
  }
  if (type === "region") {
    if (!spec.regions.some((r) => r.key === item.key)) spec.regions.push({ key: item.key });
    return;
  }
  // city, zip, neighborhood, place — радиусом вокруг точки.
  if (!spec.cities.some((c) => c.key === item.key)) {
    spec.cities.push({ key: item.key, radius: radiusKm, distance_unit: "kilometer" });
  }
}

/** Пустой ли резолв гео — тогда падаем на страну по умолчанию. */
export function isGeoEmpty(geo: ResolvedGeo): boolean {
  return geo.countries.length === 0 && geo.cities.length === 0 && geo.regions.length === 0;
}

/**
 * Финальная сборка targeting для /act_X/adsets.
 * advantage_audience выключаем явно: Meta требует осознанного значения,
 * а расширение аудитории поверх ручного таргетинга — не то, что человек
 * ожидает, нажимая «Запустить» с конкретным списком городов.
 */
export function buildTargetingSpec(r: ResolvedTargeting): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    geo_locations: {
      ...(r.geo.countries.length ? { countries: r.geo.countries } : {}),
      ...(r.geo.cities.length ? { cities: r.geo.cities } : {}),
      ...(r.geo.regions.length ? { regions: r.geo.regions } : {}),
    },
    age_min: r.ageMin,
    age_max: r.ageMax,
    targeting_automation: { advantage_audience: 0 },
  };
  if (r.genders.length) spec.genders = r.genders;
  if (r.locales.length) spec.locales = r.locales;
  if (r.interests.length) spec.flexible_spec = [{ interests: r.interests }];
  if (r.exclusions.length) spec.exclusions = { interests: r.exclusions };
  return spec;
}

/** Приведение сырого ввода (кабинет + переопределения мастера) к TargetingInput. */
export function normalizeTargetingInput(raw: Record<string, unknown> | null | undefined, opts: {
  fallbackCity?: string | null;
  timezone?: string | null;
  currency?: string | null;
}): TargetingInput {
  const src = raw ?? {};
  const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const strings = (v: unknown): string[] =>
    asArray(v).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);

  const geo = strings(src.geo ?? src.target_geo);
  const fallback = (opts.fallbackCity ?? "").trim();
  if (!geo.length && fallback) geo.push(fallback);

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  return {
    geo,
    ageMin: num(src.age_min ?? src.ageMin),
    ageMax: num(src.age_max ?? src.ageMax),
    gender: (["male", "female"].includes(String(src.gender ?? "").toLowerCase())
      ? String(src.gender).toLowerCase()
      : "all") as "all" | "male" | "female",
    languages: strings(src.languages ?? src.target_languages),
    interests: asArray(src.interests ?? src.target_interests) as TargetingInput["interests"],
    exclusions: asArray(src.exclusions ?? src.target_exclusions) as TargetingInput["exclusions"],
    defaultCountry: defaultCountryFor(opts.timezone, opts.currency),
  };
}

/** Интерес, уже пришедший объектом {id,name}, резолвить не нужно. */
export function asResolvedInterest(
  item: string | { id?: string; name?: string },
): { id: string; name: string } | null {
  if (typeof item === "string") return null;
  const id = (item?.id ?? "").toString().trim();
  if (!id) return null;
  return { id, name: (item?.name ?? "").toString().trim() || id };
}

// ============================================================
// Резолв через Graph /search с кэшем
// ============================================================

export interface TargetingCacheStore {
  get(kind: string, query: string, country: string | null): Promise<unknown | null>;
  put(kind: string, query: string, country: string | null, result: unknown): Promise<void>;
}

async function searchCached<T>(
  store: TargetingCacheStore | null,
  kind: string,
  query: string,
  country: string | null,
  fetcher: () => Promise<T | null>,
): Promise<T | null> {
  const key = cacheKeyFor(query);
  if (store) {
    const hit = await store.get(kind, key, country).catch(() => null);
    if (hit !== null && hit !== undefined) return hit as T;
  }
  const fresh = await fetcher();
  if (fresh !== null && fresh !== undefined && store) {
    await store.put(kind, key, country, fresh).catch(() => {});
  }
  return fresh;
}

/**
 * Полный резолв таргетинга. Возвращает и spec, и список нераспознанных
 * названий — их видно в статусе запуска, чтобы человек поправил кабинет,
 * а не гадал, почему объявление крутится не там.
 */
export async function resolveTargeting(
  input: TargetingInput,
  token: string,
  store: TargetingCacheStore | null = null,
): Promise<ResolvedTargeting> {
  const geo: ResolvedGeo = { countries: [], cities: [], regions: [] };
  const unresolved: string[] = [];

  for (const name of input.geo) {
    // Двухбуквенный код страны — берём как есть, без обращения к Meta.
    if (/^[A-Za-z]{2}$/.test(name.trim())) {
      const code = name.trim().toUpperCase();
      if (!geo.countries.includes(code)) geo.countries.push(code);
      continue;
    }
    const item = await searchCached<GeoSearchItem | null>(
      store,
      "adgeolocation",
      name,
      input.defaultCountry,
      async () => {
        const res = await graphGet<{ data?: GeoSearchItem[] }>("search", token, {
          type: "adgeolocation",
          q: name,
          location_types: ["country", "region", "city"],
          limit: 10,
        });
        if (!res.ok) return null;
        return pickGeoMatch(res.data?.data ?? [], name, input.defaultCountry);
      },
    );
    if (item?.key) geoItemToSpec(item, geo);
    else unresolved.push(name);
  }

  if (isGeoEmpty(geo)) geo.countries.push(input.defaultCountry);

  const locales: number[] = [];
  for (const lang of input.languages) {
    if (/^\d+$/.test(lang.trim())) {
      locales.push(Number(lang.trim()));
      continue;
    }
    const key = await searchCached<number | null>(
      store,
      "adlocale",
      lang,
      null,
      async () => {
        const res = await graphGet<{ data?: Array<{ key?: number; name?: string }> }>("search", token, {
          type: "adlocale",
          q: lang,
          limit: 5,
        });
        if (!res.ok) return null;
        const found = (res.data?.data ?? []).find((x) => typeof x.key === "number");
        return found?.key ?? null;
      },
    );
    if (typeof key === "number") locales.push(key);
    else unresolved.push(lang);
  }

  const resolveInterests = async (
    items: TargetingInput["interests"],
  ): Promise<Array<{ id: string; name: string }>> => {
    const out: Array<{ id: string; name: string }> = [];
    for (const item of items) {
      const ready = asResolvedInterest(item);
      if (ready) {
        out.push(ready);
        continue;
      }
      const query = typeof item === "string" ? item : (item?.name ?? "");
      if (!query.trim()) continue;
      const found = await searchCached<{ id: string; name: string } | null>(
        store,
        "adinterest",
        query,
        null,
        async () => {
          const res = await graphGet<{ data?: Array<{ id?: string; name?: string }> }>("search", token, {
            type: "adinterest",
            q: query,
            limit: 5,
          });
          if (!res.ok) return null;
          const hit = (res.data?.data ?? []).find((x) => x.id);
          return hit?.id ? { id: String(hit.id), name: String(hit.name ?? query) } : null;
        },
      );
      if (found) out.push(found);
      else unresolved.push(query);
    }
    return out;
  };

  const { ageMin, ageMax } = clampAge(input.ageMin, input.ageMax);

  return {
    geo,
    ageMin,
    ageMax,
    genders: gendersToMeta(input.gender),
    locales,
    interests: await resolveInterests(input.interests),
    exclusions: await resolveInterests(input.exclusions),
    unresolved,
  };
}
