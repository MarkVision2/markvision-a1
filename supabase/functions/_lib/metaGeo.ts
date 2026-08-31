/**
 * Резолв гео-таргетинга: город из настроек кабинета → объект `geo_locations`
 * для Meta. Порт функции `buildGeoLocations` из ноды n8n `Parse JSON1`.
 *
 * Поиск по справочнику Meta передаётся аргументом, поэтому вся логика разбора
 * (страна / регион / город, точные и частичные совпадения, несколько городов
 * через запятую) покрывается unit-тестами без сети.
 */

/** Строка справочника Meta `/search?type=adgeolocation`. */
export interface GeoSearchItem {
  key?: string | number;
  name?: string;
  type?: string;
  country_code?: string;
  country_name?: string;
}

/** Поиск по справочнику Meta. В тестах подменяется фейком. */
export type GeoSearch = (query: string) => Promise<GeoSearchItem[]>;

export interface GeoConfig {
  city?: string | null;
  /** Точка на карте: если задана вместе с радиусом, перекрывает города. */
  latitude?: number | string | null;
  longitude?: number | string | null;
  radiusKm?: number | string | null;
  addressLabel?: string | null;
}

export const DEFAULT_GEO = {
  countries: ["KZ"],
  location_types: ["home", "recent"],
} as const;

const COUNTRY_MAP: Record<string, string> = {
  "казахстан": "KZ", "kazakhstan": "KZ", "kz": "KZ",
  "россия": "RU", "russia": "RU", "ru": "RU", "рф": "RU",
  "узбекистан": "UZ", "uzbekistan": "UZ", "uz": "UZ",
  "кыргызстан": "KG", "киргизия": "KG", "kyrgyzstan": "KG", "kg": "KG",
  "беларусь": "BY", "belarus": "BY", "by": "BY",
  "украина": "UA", "ukraine": "UA", "ua": "UA",
  "азербайджан": "AZ", "azerbaijan": "AZ", "az": "AZ",
  "грузия": "GE", "georgia": "GE", "ge": "GE",
  "армения": "AM", "armenia": "AM", "am": "AM",
  "таджикистан": "TJ", "tajikistan": "TJ", "tj": "TJ",
  "туркменистан": "TM", "turkmenistan": "TM", "tm": "TM",
  "молдова": "MD", "moldova": "MD", "md": "MD",
};

/**
 * Готовые ключи городов Казахстана. Не только ускорение: Meta на запрос
 * «Almaty» возвращает «Алма-Ата» и точное совпадение по имени не срабатывает.
 */
const KZ_CITY_KEYS: Record<string, string> = {
  "алматы": "1289662", "almaty": "1289662", "алма-ата": "1289662", "alma-ata": "1289662",
  "астана": "1301648", "astana": "1301648", "нур-султан": "1301648", "nur-sultan": "1301648",
  "шымкент": "1300313", "shymkent": "1300313", "чимкент": "1300313",
  "караганда": "1293836", "karaganda": "1293836",
  "актобе": "1289458", "aktobe": "1289458", "актюбинск": "1289458",
  "актау": "1289448", "aktau": "1289448",
  "атырау": "1290182", "atyrau": "1290182",
  "павлодар": "1298304", "pavlodar": "1298304",
  "усть-каменогорск": "1298160", "oskemen": "1298160", "өскемен": "1298160",
  "семей": "1299700", "semey": "1299700", "семипалатинск": "1299700",
  "тараз": "1301044", "taraz": "1301044", "джамбул": "1301044",
  "кызылорда": "1296326", "kyzylorda": "1296326",
  "петропавловск": "1298439", "petropavl": "1298439",
  "костанай": "1295460", "kostanay": "1295460", "кустанай": "1295460",
  "талдыкорган": "1300928", "taldykorgan": "1300928",
  "туркестан": "1301740", "turkestan": "1301740",
  "уральск": "1298077", "uralsk": "1298077", "орал": "1298077",
};

const TRANSLITS: Record<string, string> = {
  "алматы": "Almaty", "астана": "Astana", "нур-султан": "Astana",
  "шымкент": "Shymkent", "караганда": "Karaganda", "актобе": "Aktobe",
  "актау": "Aktau", "атырау": "Atyrau", "уральск": "Uralsk", "павлодар": "Pavlodar",
  "усть-каменогорск": "Oskemen", "семей": "Semey", "тараз": "Taraz",
  "кызылорда": "Kyzylorda", "петропавловск": "Petropavl", "костанай": "Kostanay",
  "талдыкорган": "Taldykorgan", "туркестан": "Turkestan",
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().trim();
const squash = (s: unknown) => norm(s).replace(/[^a-zа-я0-9]/gi, "");

type Resolved =
  | { kind: "country"; code: string }
  | { kind: "region"; key: string }
  | { kind: "city"; key: string };

async function resolveOne(raw: string, search: GeoSearch): Promise<Resolved | null> {
  const t = norm(raw);
  if (!t) return null;

  const country = COUNTRY_MAP[t];
  if (country) return { kind: "country", code: country };

  const kzKey = KZ_CITY_KEYS[t];
  if (kzKey) return { kind: "city", key: kzKey };

  let data: GeoSearchItem[] = [];
  try {
    data = await search(raw);
  } catch {
    data = [];
  }
  if (data.length === 0 && TRANSLITS[t]) {
    try {
      data = await search(TRANSLITS[t]);
    } catch {
      data = [];
    }
  }

  // Точное совпадение имени: страна → регион → город.
  const exactCountry = data.find((d) =>
    d.type === "country" && (norm(d.name) === t || norm(d.country_name) === t)
  );
  if (exactCountry?.country_code) {
    return { kind: "country", code: exactCountry.country_code };
  }
  const exactRegion = data.find((d) => d.type === "region" && norm(d.name) === t);
  if (exactRegion?.key != null) return { kind: "region", key: String(exactRegion.key) };
  const exactCity = data.find((d) => d.type === "city" && norm(d.name) === t);
  if (exactCity?.key != null) return { kind: "city", key: String(exactCity.key) };

  // Частичное совпадение: город точнее региона, регион точнее страны.
  const squashed = squash(raw);
  const byType = (type: string) =>
    data.find((d) => d.type === type && squash(d.name).includes(squashed));
  const partial = byType("city") ?? byType("region") ?? byType("country");
  if (partial) {
    if (partial.type === "city" && partial.key != null) {
      return { kind: "city", key: String(partial.key) };
    }
    if (partial.type === "region" && partial.key != null) {
      return { kind: "region", key: String(partial.key) };
    }
    if (partial.type === "country" && partial.country_code) {
      return { kind: "country", code: partial.country_code };
    }
  }
  return null;
}

/**
 * Собирает `geo_locations`. Приоритет — точка на карте с радиусом; затем список
 * городов через запятую; если ничего не распозналось — вся страна по умолчанию.
 */
export async function buildGeoLocations(
  config: GeoConfig,
  search: GeoSearch,
): Promise<Record<string, unknown>> {
  const lat = Number(config.latitude);
  const lng = Number(config.longitude);
  const radius = Number(config.radiusKm);
  const hasPoint = Number.isFinite(lat) && Math.abs(lat) <= 90 && lat !== 0 &&
    Number.isFinite(lng) && Math.abs(lng) <= 180 && lng !== 0;
  if (hasPoint && radius >= 1 && radius <= 80) {
    const name = String(config.addressLabel ?? "").slice(0, 80);
    return {
      custom_locations: [{
        latitude: lat,
        longitude: lng,
        radius,
        distance_unit: "kilometer",
        ...(name ? { name } : {}),
      }],
      location_types: ["home"],
    };
  }

  const cityRaw = String(config.city ?? "").trim();
  if (!cityRaw) return { ...DEFAULT_GEO };

  const tokens = cityRaw.split(/[,;|]+/).map((s) => s.trim()).filter(Boolean);
  const resolved: Resolved[] = [];
  for (const token of tokens) {
    const r = await resolveOne(token, search);
    if (r) resolved.push(r);
  }
  if (resolved.length === 0) return { ...DEFAULT_GEO };

  // Страна перекрывает города: Meta не принимает такую смесь в одном объекте.
  const countries = resolved.filter((r) => r.kind === "country");
  if (countries.length > 0) {
    return {
      countries: [...new Set(countries.map((r) => (r as { code: string }).code))],
      location_types: ["home", "recent"],
    };
  }

  const out: Record<string, unknown> = { location_types: ["home", "recent"] };
  const cities = resolved
    .filter((r) => r.kind === "city")
    .map((r) => ({ key: (r as { key: string }).key, radius: 25, distance_unit: "kilometer" }));
  const regions = resolved
    .filter((r) => r.kind === "region")
    .map((r) => ({ key: (r as { key: string }).key }));
  if (cities.length) out.cities = cities;
  if (regions.length) out.regions = regions;
  return out;
}
