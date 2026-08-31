import { describe, expect, it, vi } from "vitest";
import {
  buildGeoLocations,
  DEFAULT_GEO,
  type GeoSearchItem,
} from "../../supabase/functions/_lib/metaGeo.ts";

const emptySearch = vi.fn<(q: string) => Promise<GeoSearchItem[]>>()
  .mockResolvedValue([]);

describe("buildGeoLocations", () => {
  it("город из готового справочника не требует запроса в Meta", async () => {
    const search = vi.fn<(q: string) => Promise<GeoSearchItem[]>>()
      .mockResolvedValue([]);
    const geo = await buildGeoLocations({ city: "Алматы" }, search);
    expect(geo).toEqual({
      location_types: ["home", "recent"],
      cities: [{ key: "1289662", radius: 25, distance_unit: "kilometer" }],
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("название страны разворачивается в код без запроса", async () => {
    const geo = await buildGeoLocations({ city: "Казахстан" }, emptySearch);
    expect(geo).toEqual({ countries: ["KZ"], location_types: ["home", "recent"] });
  });

  it("несколько городов через запятую собираются в один список", async () => {
    const geo = await buildGeoLocations({ city: "Алматы, Астана" }, emptySearch);
    expect(geo.cities).toEqual([
      { key: "1289662", radius: 25, distance_unit: "kilometer" },
      { key: "1301648", radius: 25, distance_unit: "kilometer" },
    ]);
  });

  it("страна в списке перекрывает города — Meta не принимает смесь", async () => {
    const geo = await buildGeoLocations({ city: "Алматы, Казахстан" }, emptySearch);
    expect(geo).toEqual({ countries: ["KZ"], location_types: ["home", "recent"] });
    expect(geo.cities).toBeUndefined();
  });

  it("незнакомый город ищется в справочнике Meta по точному имени", async () => {
    const search = vi.fn<(q: string) => Promise<GeoSearchItem[]>>().mockResolvedValue([
      { type: "region", name: "Ferghana Region", key: "3888" },
      { type: "city", name: "Фергана", key: "777" },
    ]);
    const geo = await buildGeoLocations({ city: "Фергана" }, search);
    expect(search).toHaveBeenCalledWith("Фергана");
    expect(geo.cities).toEqual([{ key: "777", radius: 25, distance_unit: "kilometer" }]);
  });

  it("при отсутствии точного совпадения берёт частичное, город важнее региона", async () => {
    const search = vi.fn<(q: string) => Promise<GeoSearchItem[]>>().mockResolvedValue([
      { type: "region", name: "Самаркандская область", key: "regio" },
      { type: "city", name: "Самарканд город", key: "city-1" },
    ]);
    const geo = await buildGeoLocations({ city: "Самарканд" }, search);
    expect(geo.cities).toEqual([{ key: "city-1", radius: 25, distance_unit: "kilometer" }]);
  });

  it("если справочник пуст — падаем на страну по умолчанию", async () => {
    const geo = await buildGeoLocations({ city: "Неизвестноград" }, emptySearch);
    expect(geo).toEqual({ ...DEFAULT_GEO });
  });

  it("ошибка поиска не роняет запуск", async () => {
    const search = vi.fn<(q: string) => Promise<GeoSearchItem[]>>()
      .mockRejectedValue(new Error("429"));
    const geo = await buildGeoLocations({ city: "Неизвестноград" }, search);
    expect(geo).toEqual({ ...DEFAULT_GEO });
  });

  it("пустой город — страна по умолчанию", async () => {
    expect(await buildGeoLocations({ city: "" }, emptySearch)).toEqual({ ...DEFAULT_GEO });
    expect(await buildGeoLocations({}, emptySearch)).toEqual({ ...DEFAULT_GEO });
  });

  it("точка на карте с радиусом перекрывает город", async () => {
    const geo = await buildGeoLocations({
      city: "Алматы",
      latitude: 43.238,
      longitude: 76.889,
      radiusKm: 15,
      addressLabel: "Клиника на Абая",
    }, emptySearch);
    expect(geo).toEqual({
      custom_locations: [{
        latitude: 43.238,
        longitude: 76.889,
        radius: 15,
        distance_unit: "kilometer",
        name: "Клиника на Абая",
      }],
      location_types: ["home"],
    });
  });

  it("радиус вне допустимого диапазона игнорируется, остаётся город", async () => {
    const geo = await buildGeoLocations({
      city: "Алматы",
      latitude: 43.238,
      longitude: 76.889,
      radiusKm: 500,
    }, emptySearch);
    expect(geo.custom_locations).toBeUndefined();
    expect(geo.cities).toEqual([{ key: "1289662", radius: 25, distance_unit: "kilometer" }]);
  });
});
