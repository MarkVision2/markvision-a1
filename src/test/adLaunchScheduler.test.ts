/**
 * Логика «пора ли запускать» для авто-запуска по расписанию кабинета.
 *
 * Таймзоны здесь — не мелочь: кабинеты живут в разных зонах, а решение
 * принимается по локальному часу. Ошибка на границе суток означает запуск
 * не в тот день недели и списанный бюджет в выходной.
 */
import { describe, expect, it } from "vitest";
import {
  inferGoal,
  isDue,
  localParts,
  specFromCabinet,
} from "../../supabase/functions/_lib/adLaunchSchedule.ts";

// Минимальный кабинет; поля, которых нет в тесте, планировщику не нужны.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cab = (over: Record<string, unknown> = {}): any => ({
  id: "cab-1",
  name: "Тест",
  project_id: "p1",
  ad_account_id: "123456",
  page_id: "777",
  instagram_id: "888",
  pixel_id: "999",
  pixel_event: "Lead",
  website_url: "https://example.com",
  landing_url: null,
  whatsapp_number: null,
  lead_form_id: null,
  daily_budget: 5000,
  currency: "KZT",
  city: "Алматы",
  timezone: "Asia/Almaty",
  launch_hour: 9,
  days_of_week: [1, 2, 3, 4, 5],
  utm_template: "utm_source=meta",
  creative_headline: null,
  creative_primary_text: "Текст",
  creative_description: null,
  creative_media_urls: ["https://res.cloudinary.com/demo/a.jpg"],
  target_geo: ["Алматы"],
  target_age_min: 25,
  target_age_max: 45,
  target_gender: "all",
  target_languages: [],
  target_interests: [],
  target_exclusions: [],
  ...over,
});

describe("localParts", () => {
  it("переводит UTC в локальные час и день кабинета", () => {
    // 2026-06-01 03:00 UTC = 08:00 в Алматы (UTC+5), понедельник.
    const parts = localParts(new Date("2026-06-01T03:00:00Z"), "Asia/Almaty");
    expect(parts.hour).toBe(8);
    expect(parts.isoDow).toBe(1);
    expect(parts.date).toBe("2026-06-01");
  });

  it("на границе суток дата берётся локальная, а не UTC", () => {
    // 2026-06-01 20:00 UTC — в Алматы уже 01:00 вторника 2 июня.
    const parts = localParts(new Date("2026-06-01T20:00:00Z"), "Asia/Almaty");
    expect(parts.hour).toBe(1);
    expect(parts.isoDow).toBe(2);
    expect(parts.date).toBe("2026-06-02");
  });

  it("полночь — это 0, а не 24", () => {
    expect(localParts(new Date("2026-06-01T19:00:00Z"), "Asia/Almaty").hour).toBe(0);
  });
});

describe("isDue", () => {
  const monday09Almaty = new Date("2026-06-01T04:00:00Z"); // 09:00 в Алматы, понедельник

  it("совпал час и день — пора", () => {
    expect(isDue(monday09Almaty, "Asia/Almaty", 9, [1, 2, 3, 4, 5])).toBe(true);
  });

  it("другой час — не пора", () => {
    expect(isDue(monday09Almaty, "Asia/Almaty", 10, [1, 2, 3, 4, 5])).toBe(false);
  });

  it("день недели не разрешён — не пора", () => {
    expect(isDue(monday09Almaty, "Asia/Almaty", 9, [6, 7])).toBe(false);
  });

  it("пустой список дней означает «каждый день»", () => {
    expect(isDue(monday09Almaty, "Asia/Almaty", 9, [])).toBe(true);
  });

  it("тот же момент в другой таймзоне даёт другой ответ", () => {
    // 04:00 UTC — в Москве это 07:00, а не 09:00.
    expect(isDue(monday09Almaty, "Europe/Moscow", 9, [1, 2, 3, 4, 5])).toBe(false);
    expect(isDue(monday09Almaty, "Europe/Moscow", 7, [1, 2, 3, 4, 5])).toBe(true);
  });
});

describe("inferGoal", () => {
  it("номер WhatsApp важнее прочего", () => {
    expect(inferGoal(cab({ whatsapp_number: "+7700" }))).toBe("whatsapp");
  });

  it("лид-форма без WhatsApp даёт цель формы", () => {
    expect(inferGoal(cab({ lead_form_id: "42" }))).toBe("meta-form");
  });

  it("по умолчанию — лиды с сайта", () => {
    expect(inferGoal(cab())).toBe("site-leads");
  });
});

describe("specFromCabinet", () => {
  const media = [{
    role: "feed" as const, index: 0, url: "https://res.cloudinary.com/demo/a.jpg", mime: "image/jpeg", name: "a.jpg",
  }];

  it("переносит настройки кабинета в задание", () => {
    const spec = specFromCabinet(cab(), media);
    expect(spec.adAccount).toBe("act_123456");
    expect(spec.budgetCents).toBe(5000);
    expect(spec.targeting).toMatchObject({ geo: ["Алматы"], age_min: 25, age_max: 45 });
    expect(spec.cabinetCity).toBe("Алматы");
  });

  it("авто-запуск никогда не включает кампанию сам", () => {
    expect(specFromCabinet(cab(), media).autoActivate).toBe(false);
  });

  it("две картинки превращаются в карусель", () => {
    const two = [0, 1].map((index) => ({
      role: "carousel" as const, index, url: `u${index}`, mime: "image/jpeg", name: `${index}.jpg`,
    }));
    expect(specFromCabinet(cab(), two).creativeFormat).toBe("carousel");
  });

  it("website_url подхватывается из landing_url, если основного нет", () => {
    const spec = specFromCabinet(cab({ website_url: null, landing_url: "https://lp.example" }), media);
    expect(spec.websiteUrl).toBe("https://lp.example");
  });
});
