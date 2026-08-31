/**
 * Сборка targeting spec — тот кусок, который раньше жил только в n8n.
 * Проверяем, что человеческий ввод («Алматы», «фитнес», «муж») превращается
 * ровно в те структуры, которые принимает Meta ad set.
 */
import { describe, expect, it } from "vitest";
import {
  asResolvedInterest,
  buildTargetingSpec,
  cacheKeyFor,
  clampAge,
  defaultCountryFor,
  type GeoSearchItem,
  gendersToMeta,
  geoItemToSpec,
  isGeoEmpty,
  normalizeTargetingInput,
  pickGeoMatch,
  type ResolvedGeo,
  type ResolvedTargeting,
} from "../../supabase/functions/_lib/metaTargeting.ts";

function emptyGeo(): ResolvedGeo {
  return { countries: [], cities: [], regions: [] };
}

function resolved(over: Partial<ResolvedTargeting> = {}): ResolvedTargeting {
  return {
    geo: { countries: ["KZ"], cities: [], regions: [] },
    ageMin: 18,
    ageMax: 65,
    genders: [],
    locales: [],
    interests: [],
    exclusions: [],
    unresolved: [],
    ...over,
  };
}

describe("gendersToMeta", () => {
  it("мужчины — 1, женщины — 2, все — пустой массив", () => {
    expect(gendersToMeta("male")).toEqual([1]);
    expect(gendersToMeta("female")).toEqual([2]);
    expect(gendersToMeta("all")).toEqual([]);
    expect(gendersToMeta(null)).toEqual([]);
    expect(gendersToMeta("что-то")).toEqual([]);
  });
});

describe("clampAge", () => {
  it("держит возраст в допустимом Meta диапазоне 13..65", () => {
    expect(clampAge(10, 90)).toEqual({ ageMin: 13, ageMax: 65 });
    expect(clampAge(null, null)).toEqual({ ageMin: 18, ageMax: 65 });
    expect(clampAge(25, 40)).toEqual({ ageMin: 25, ageMax: 40 });
  });

  it("переставляет границы, если их ввели наоборот", () => {
    expect(clampAge(50, 25)).toEqual({ ageMin: 25, ageMax: 50 });
  });
});

describe("defaultCountryFor", () => {
  it("выводит страну из таймзоны кабинета", () => {
    expect(defaultCountryFor("Asia/Almaty", null)).toBe("KZ");
    expect(defaultCountryFor("Europe/Moscow", null)).toBe("RU");
    expect(defaultCountryFor("Europe/Kyiv", null)).toBe("UA");
  });

  it("падает на валюту, когда таймзона незнакомая", () => {
    expect(defaultCountryFor("Mars/Olympus", "RUB")).toBe("RU");
    expect(defaultCountryFor(null, "UZS")).toBe("UZ");
  });

  it("последний рубеж — KZ, а не пустая строка", () => {
    expect(defaultCountryFor(null, null)).toBe("KZ");
  });
});

describe("pickGeoMatch", () => {
  const items: GeoSearchItem[] = [
    { key: "1", name: "Almaty", type: "city", country_code: "US" },
    { key: "2", name: "Almaty", type: "city", country_code: "KZ" },
    { key: "3", name: "Almaty Oblast", type: "region", country_code: "KZ" },
  ];

  it("точное совпадение в нужной стране выигрывает", () => {
    expect(pickGeoMatch(items, "Almaty", "KZ")?.key).toBe("2");
  });

  it("без страны берётся точное совпадение по имени", () => {
    expect(pickGeoMatch(items, "Almaty")?.key).toBe("1");
  });

  it("нет совпадений — берётся первый результат, а не null", () => {
    expect(pickGeoMatch(items, "Караганда", "KZ")?.key).toBe("2");
  });

  it("пустой ответ Meta даёт null", () => {
    expect(pickGeoMatch([], "Алматы", "KZ")).toBeNull();
  });
});

describe("geoItemToSpec", () => {
  it("страна, регион и город попадают в разные секции", () => {
    const geo = emptyGeo();
    geoItemToSpec({ key: "KZ", name: "Kazakhstan", type: "country", country_code: "KZ" }, geo);
    geoItemToSpec({ key: "r1", name: "Almaty Oblast", type: "region" }, geo);
    geoItemToSpec({ key: "c1", name: "Almaty", type: "city" }, geo);

    expect(geo.countries).toEqual(["KZ"]);
    expect(geo.regions).toEqual([{ key: "r1" }]);
    expect(geo.cities).toEqual([{ key: "c1", radius: 25, distance_unit: "kilometer" }]);
  });

  it("повторный город не дублируется", () => {
    const geo = emptyGeo();
    geoItemToSpec({ key: "c1", name: "Almaty", type: "city" }, geo);
    geoItemToSpec({ key: "c1", name: "Almaty", type: "city" }, geo);
    expect(geo.cities.length).toBe(1);
  });
});

describe("isGeoEmpty", () => {
  it("пустой гео распознаётся — иначе Meta отклонит адсет", () => {
    expect(isGeoEmpty(emptyGeo())).toBe(true);
    expect(isGeoEmpty({ ...emptyGeo(), countries: ["KZ"] })).toBe(false);
  });
});

describe("buildTargetingSpec", () => {
  it("собирает минимальный валидный spec", () => {
    const spec = buildTargetingSpec(resolved());
    expect(spec.geo_locations).toEqual({ countries: ["KZ"] });
    expect(spec.age_min).toBe(18);
    expect(spec.targeting_automation).toEqual({ advantage_audience: 0 });
    expect(spec.genders).toBeUndefined();
    expect(spec.flexible_spec).toBeUndefined();
  });

  it("интересы уходят во flexible_spec, исключения — в exclusions", () => {
    const spec = buildTargetingSpec(resolved({
      genders: [2],
      locales: [7],
      interests: [{ id: "i1", name: "Фитнес" }],
      exclusions: [{ id: "i2", name: "Спортпит" }],
    }));
    expect(spec.genders).toEqual([2]);
    expect(spec.locales).toEqual([7]);
    expect(spec.flexible_spec).toEqual([{ interests: [{ id: "i1", name: "Фитнес" }] }]);
    expect(spec.exclusions).toEqual({ interests: [{ id: "i2", name: "Спортпит" }] });
  });

  it("пустые секции гео не попадают в spec", () => {
    const spec = buildTargetingSpec(resolved({
      geo: { countries: [], cities: [{ key: "c1", radius: 25, distance_unit: "kilometer" }], regions: [] },
    }));
    expect(spec.geo_locations).toEqual({
      cities: [{ key: "c1", radius: 25, distance_unit: "kilometer" }],
    });
  });
});

describe("normalizeTargetingInput", () => {
  it("читает и camelCase, и snake_case имена полей", () => {
    const input = normalizeTargetingInput(
      { target_geo: ["Алматы"], age_min: 25, gender: "male", target_interests: ["фитнес"] },
      { timezone: "Asia/Almaty", currency: "KZT" },
    );
    expect(input.geo).toEqual(["Алматы"]);
    expect(input.ageMin).toBe(25);
    expect(input.gender).toBe("male");
    expect(input.interests).toEqual(["фитнес"]);
    expect(input.defaultCountry).toBe("KZ");
  });

  it("пустое гео заполняется городом кабинета", () => {
    const input = normalizeTargetingInput({}, { fallbackCity: "Астана" });
    expect(input.geo).toEqual(["Астана"]);
  });

  it("мусор вместо массивов не роняет сборку", () => {
    const input = normalizeTargetingInput(
      { geo: "не массив", interests: null, languages: [1, "", "Русский"] },
      {},
    );
    expect(input.geo).toEqual([]);
    expect(input.interests).toEqual([]);
    expect(input.languages).toEqual(["Русский"]);
  });
});

describe("asResolvedInterest", () => {
  it("готовый {id,name} не требует обращения к Meta", () => {
    expect(asResolvedInterest({ id: "5", name: "Фитнес" })).toEqual({ id: "5", name: "Фитнес" });
  });

  it("строку резолвить надо — возвращает null", () => {
    expect(asResolvedInterest("фитнес")).toBeNull();
    expect(asResolvedInterest({ name: "фитнес" })).toBeNull();
  });
});

describe("cacheKeyFor", () => {
  it("нормализует регистр и пробелы — один ключ на один запрос", () => {
    expect(cacheKeyFor("  Нур-Султан  ")).toBe("нур-султан");
    expect(cacheKeyFor("New   York")).toBe("new york");
  });
});
