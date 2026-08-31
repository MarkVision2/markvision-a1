/**
 * Форма авто-запуска на кабинете.
 *
 * Проверяем ровно то, что попадёт в БД и потом в Meta через планировщик:
 * дни недели, гео и интересы, а главное — валидацию. Включённый авто-запуск
 * с недонастроенным кабинетом означает задание, которое упадёт через сутки,
 * когда никто не смотрит.
 */
import { describe, expect, it } from "vitest";
import type { AdCabinet } from "@/types/ads";
import {
  cabinetPatchFromForm,
  describeGoal,
  describeSchedule,
  formatLines,
  formatList,
  formFromCabinet,
  parseList,
  toggleWeekday,
  validateAutoLaunch,
} from "@/lib/autoLaunchSettings";

const cabinet = (over: Partial<AdCabinet> = {}): AdCabinet => ({
  id: "c1",
  name: "Тест",
  externalId: "123456",
  online: true,
  type: "Личный",
  spend: 0,
  leads: 0,
  leadCost: 0,
  sales: 0,
  revenue: 0,
  adAccountId: "act_123456",
  pageId: "777",
  pixelId: "999",
  websiteUrl: "https://example.com",
  dailyBudget: 5000,
  currency: "KZT",
  timezone: "Asia/Almaty",
  launchHour: 9,
  daysOfWeek: [1, 2, 3, 4, 5],
  ...over,
});

const form = (over = {}) => ({ ...formFromCabinet(cabinet()), ...over });

describe("parseList", () => {
  it("режет и по запятым, и по строкам, выкидывая пустое", () => {
    expect(parseList("Алматы, Астана\n\nKZ ,")).toEqual(["Алматы", "Астана", "KZ"]);
    expect(parseList("   ")).toEqual([]);
  });
});

describe("formatList / formatLines", () => {
  it("интересы-объекты показываются именем, а не [object Object]", () => {
    expect(formatList([{ id: "1", name: "Фитнес" }, "Бег"])).toBe("Фитнес, Бег");
  });

  it("не-массив не роняет форму", () => {
    expect(formatList(null)).toBe("");
    expect(formatLines(undefined)).toBe("");
  });

  it("ссылки идут построчно", () => {
    expect(formatLines(["https://a", "https://b"])).toBe("https://a\nhttps://b");
  });
});

describe("toggleWeekday", () => {
  it("добавляет и убирает день, сохраняя порядок", () => {
    expect(toggleWeekday([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleWeekday([1, 2, 3], 2)).toEqual([1, 3]);
  });
});

describe("formFromCabinet / cabinetPatchFromForm", () => {
  it("круговой обход сохраняет значения", () => {
    const patch = cabinetPatchFromForm(form({ geo: "Алматы, Астана", ageMin: "25", ageMax: "45" }));
    expect(patch.targetGeo).toEqual(["Алматы", "Астана"]);
    expect(patch.targetAgeMin).toBe(25);
    expect(patch.targetAgeMax).toBe(45);
    expect(patch.autoLaunchEnabled).toBe(false);
  });

  it("пустой возраст уходит как undefined, а не как 0", () => {
    const patch = cabinetPatchFromForm(form({ ageMin: "", ageMax: "" }));
    expect(patch.targetAgeMin).toBeUndefined();
    expect(patch.targetAgeMax).toBeUndefined();
  });

  it("кабинет без дней недели считается «каждый день»", () => {
    expect(formFromCabinet(cabinet({ daysOfWeek: [] })).daysOfWeek).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("validateAutoLaunch", () => {
  it("выключенный авто-запуск ничего не требует", () => {
    expect(validateAutoLaunch(form({ enabled: false }), cabinet({ adAccountId: "" }))).toEqual([]);
  });

  it("требует аккаунт, страницу и бюджет", () => {
    const errors = validateAutoLaunch(
      form({ enabled: true, mediaUrls: "https://cdn/a.jpg" }),
      cabinet({ adAccountId: "", pageId: "", dailyBudget: 0 }),
    );
    expect(errors.some((e) => e.includes("рекламный аккаунт"))).toBe(true);
    expect(errors.some((e) => e.includes("Facebook Page"))).toBe(true);
    expect(errors.some((e) => e.includes("бюджет"))).toBe(true);
  });

  it("для цели «Лиды с сайта» требует сайт и пиксель", () => {
    const withoutSite = validateAutoLaunch(
      form({ enabled: true, mediaUrls: "https://cdn/a.jpg" }),
      cabinet({ websiteUrl: "", landingUrl: "" }),
    );
    expect(withoutSite.some((e) => e.includes("ссылка на сайт"))).toBe(true);

    const withoutPixel = validateAutoLaunch(
      form({ enabled: true, mediaUrls: "https://cdn/a.jpg" }),
      cabinet({ pixelId: "" }),
    );
    expect(withoutPixel.some((e) => e.includes("пиксель"))).toBe(true);
  });

  it("для WhatsApp сайт и пиксель не нужны", () => {
    const errors = validateAutoLaunch(
      form({ enabled: true, mediaUrls: "https://cdn/a.jpg" }),
      cabinet({ whatsappNumber: "+77001112233", websiteUrl: "", pixelId: "" }),
    );
    expect(errors).toEqual([]);
  });

  it("ловит пустые дни недели и перевёрнутый возраст", () => {
    const errors = validateAutoLaunch(
      form({ enabled: true, daysOfWeek: [], ageMin: "45", ageMax: "25", mediaUrls: "https://cdn/a.jpg" }),
      cabinet(),
    );
    expect(errors.some((e) => e.includes("день недели"))).toBe(true);
    expect(errors.some((e) => e.includes("больше"))).toBe(true);
  });

  it("предупреждает про пустой креатив — иначе возьмётся картинка из галереи", () => {
    const errors = validateAutoLaunch(form({ enabled: true, mediaUrls: "" }), cabinet());
    expect(errors.some((e) => e.includes("галереи Контент-завода"))).toBe(true);
  });
});

describe("describeSchedule / describeGoal", () => {
  it("описывает расписание человеческим текстом", () => {
    // Выключенный тоже показывает расписание — иначе не видно, что включится.
    expect(describeSchedule(form({ enabled: false, daysOfWeek: [1, 3], launchHour: 8 })))
      .toBe("Выключен · Пн, Ср в 08:00 (Asia/Almaty)");
    expect(describeSchedule(form({ enabled: true, daysOfWeek: [1, 3, 5], launchHour: 9 })))
      .toBe("Пн, Ср, Пт в 09:00 (Asia/Almaty)");
    expect(describeSchedule(form({ enabled: true, daysOfWeek: [1, 2, 3, 4, 5, 6, 7] })))
      .toContain("Ежедневно");
  });

  it("показывает ту же цель, что выведет планировщик", () => {
    expect(describeGoal(cabinet())).toBe("Лиды с сайта");
    expect(describeGoal(cabinet({ leadFormId: "42" }))).toBe("Лид-форма Meta");
    expect(describeGoal(cabinet({ whatsappNumber: "+7700" }))).toBe("WhatsApp");
  });
});
