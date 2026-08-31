/**
 * Сборка тел Graph API для прямого запуска рекламы.
 *
 * Ошибка в маппинге цели стоит дороже всего: объявление уходит в Meta с
 * неправильной оптимизацией и молча сливает бюджет. Поэтому проверяем
 * objective / optimization_goal / promoted_object по каждой цели явно.
 */
import { describe, expect, it } from "vitest";
import {
  buildAdBody,
  buildAdSetBody,
  buildCampaignBody,
  buildCreativeBody,
  callToActionFor,
  type LaunchSpec,
  normalizeLaunchPayload,
  objectiveFor,
  validateLaunchSpec,
} from "../../supabase/functions/_lib/adLaunchSpec.ts";

function spec(over: Partial<LaunchSpec> = {}): LaunchSpec {
  return {
    goal: "site-leads",
    adAccount: "act_123",
    cabinetName: "Тест",
    pageId: "777",
    instagramUserId: "888",
    pixelId: "999",
    pixelEvent: "Lead",
    websiteUrl: "https://example.com",
    whatsappNumber: "",
    leadFormId: "",
    budgetCents: 5000,
    currency: "USD",
    text: "Текст объявления",
    headline: "",
    description: "",
    creativeFormat: "single",
    adSetupMode: "create",
    sourceInstagramMediaId: "",
    media: [{ role: "feed", index: 0, url: "https://cdn/x.jpg", mime: "image/jpeg", name: "x.jpg" }],
    targeting: {},
    timezone: "Asia/Almaty",
    cabinetCity: "Алматы",
    utmTemplate: "utm_source=meta",
    autoActivate: false,
    campaignName: "",
    ...over,
  };
}

const noAssets = { imageHashes: [], videoId: null, videoThumbUrl: null, storiesImageHash: null };

describe("objective по цели", () => {
  it("сайт → продажи, форма → лиды, whatsapp → вовлечение", () => {
    expect(objectiveFor("site-leads")).toBe("OUTCOME_SALES");
    expect(objectiveFor("meta-form")).toBe("OUTCOME_LEADS");
    expect(objectiveFor("whatsapp")).toBe("OUTCOME_ENGAGEMENT");
  });
});

describe("buildAdSetBody", () => {
  it("сайт: конверсии на пиксель с событием в верхнем регистре", () => {
    const body = buildAdSetBody(spec({ pixelEvent: "lead" }), "c1", { age_min: 18 });
    expect(body.optimization_goal).toBe("OFFSITE_CONVERSIONS");
    expect(body.destination_type).toBe("WEBSITE");
    expect(body.promoted_object).toEqual({ pixel_id: "999", custom_event_type: "LEAD" });
    expect(body.campaign_id).toBe("c1");
  });

  it("whatsapp: переписки с номером в promoted_object", () => {
    const body = buildAdSetBody(spec({ goal: "whatsapp", whatsappNumber: "+77001112233" }), "c1", {});
    expect(body.optimization_goal).toBe("CONVERSATIONS");
    expect(body.destination_type).toBe("WHATSAPP");
    expect(body.promoted_object).toEqual({ page_id: "777", whatsapp_phone_number: "+77001112233" });
  });

  it("лид-форма: генерация лидов внутри объявления", () => {
    const body = buildAdSetBody(spec({ goal: "meta-form", leadFormId: "42" }), "c1", {});
    expect(body.optimization_goal).toBe("LEAD_GENERATION");
    expect(body.destination_type).toBe("ON_AD");
  });

  it("таргетинг попадает в тело, кампания всегда на паузе", () => {
    const targeting = { geo_locations: { countries: ["KZ"] } };
    const body = buildAdSetBody(spec(), "c1", targeting);
    expect(body.targeting).toBe(targeting);
    expect(body.status).toBe("PAUSED");
  });

  it("бюджет не опускается ниже минимума Meta", () => {
    const body = buildAdSetBody(spec({ budgetCents: 3 }), "c1", {});
    expect(body.daily_budget).toBe("100");
  });
});

describe("buildCampaignBody", () => {
  it("создаёт кампанию на паузе с именем по умолчанию", () => {
    const body = buildCampaignBody(spec());
    expect(body.status).toBe("PAUSED");
    expect(String(body.name)).toContain("Лиды с сайта");
  });

  it("уважает заданное имя кампании", () => {
    expect(buildCampaignBody(spec({ campaignName: "Осень" })).name).toBe("Осень");
  });
});

describe("buildCreativeBody", () => {
  it("одиночная картинка → link_data с image_hash", () => {
    const body = buildCreativeBody(spec(), { ...noAssets, imageHashes: ["h1"] });
    const story = body.object_story_spec as Record<string, Record<string, unknown>>;
    expect(story.link_data.image_hash).toBe("h1");
    expect(story.page_id).toBe("777");
    expect(story.instagram_user_id).toBe("888");
    expect(body.url_tags).toBe("utm_source=meta");
  });

  it("карусель → child_attachments по числу картинок", () => {
    const body = buildCreativeBody(
      spec({ creativeFormat: "carousel" }),
      { ...noAssets, imageHashes: ["h1", "h2", "h3"] },
    );
    const story = body.object_story_spec as Record<string, Record<string, unknown>>;
    expect((story.link_data.child_attachments as unknown[]).length).toBe(3);
    expect(story.link_data.image_hash).toBeUndefined();
  });

  it("видео → video_data с превью, а не link_data", () => {
    const body = buildCreativeBody(spec(), {
      ...noAssets,
      videoId: "v1",
      videoThumbUrl: "https://cdn/thumb.jpg",
    });
    const story = body.object_story_spec as Record<string, Record<string, unknown>>;
    expect(story.video_data.video_id).toBe("v1");
    expect(story.video_data.image_url).toBe("https://cdn/thumb.jpg");
    expect(story.link_data).toBeUndefined();
  });

  it("существующая публикация IG → source_instagram_media_id без object_story_spec", () => {
    const body = buildCreativeBody(
      spec({ adSetupMode: "existing", sourceInstagramMediaId: "m1" }),
      noAssets,
    );
    expect(body.source_instagram_media_id).toBe("m1");
    expect(body.object_id).toBe("777");
    expect(body.object_story_spec).toBeUndefined();
  });
});

describe("callToActionFor", () => {
  it("сайт получает ссылку, whatsapp — назначение приложения", () => {
    expect(callToActionFor(spec())).toEqual({
      type: "LEARN_MORE",
      value: { link: "https://example.com" },
    });
    expect(callToActionFor(spec({ goal: "whatsapp" }))).toEqual({
      type: "WHATSAPP_MESSAGE",
      value: { app_destination: "WHATSAPP" },
    });
  });
});

describe("buildAdBody", () => {
  it("связывает адсет и креатив", () => {
    const body = buildAdBody(spec(), "as1", "cr1");
    expect(body.adset_id).toBe("as1");
    expect(body.creative).toEqual({ creative_id: "cr1" });
    expect(body.status).toBe("PAUSED");
  });
});

describe("validateLaunchSpec", () => {
  it("валидная заявка не даёт замечаний", () => {
    expect(validateLaunchSpec(spec())).toEqual([]);
  });

  it("ловит отсутствие пикселя и сайта для цели «лиды с сайта»", () => {
    const errors = validateLaunchSpec(spec({ pixelId: "", websiteUrl: "" }));
    expect(errors.some((e) => e.includes("pixel_id"))).toBe(true);
    expect(errors.some((e) => e.includes("ссылка на сайт"))).toBe(true);
  });

  it("ловит карусель из одной картинки", () => {
    const errors = validateLaunchSpec(spec({
      creativeFormat: "carousel",
      media: [{ role: "carousel", index: 0, url: "u", mime: "image/jpeg", name: "a.jpg" }],
    }));
    expect(errors.some((e) => e.includes("минимум 2"))).toBe(true);
  });

  it("ловит пустой креатив и нулевой бюджет", () => {
    const errors = validateLaunchSpec(spec({ media: [], budgetCents: 0 }));
    expect(errors.some((e) => e.includes("креатив"))).toBe(true);
    expect(errors.some((e) => e.includes("бюджет"))).toBe(true);
  });

  it("для продвижения публикации требует Instagram User ID", () => {
    const errors = validateLaunchSpec(spec({
      adSetupMode: "existing",
      sourceInstagramMediaId: "m1",
      instagramUserId: "",
      media: [],
    }));
    expect(errors.some((e) => e.includes("Instagram User ID"))).toBe(true);
  });
});

describe("normalizeLaunchPayload", () => {
  it("собирает поля из алиасов clientConfig", () => {
    const out = normalizeLaunchPayload({
      goal: "whatsapp",
      budget: 25,
      text: "Привет",
      clientConfig: {
        page_id: "p1",
        instagram_user_id: "ig1",
        whatsapp_number: "+7700",
        currency: "KZT",
        city: "Астана",
        utm_template: "utm_source=meta",
        targeting: { geo: ["Астана"] },
        schedule: { timezone: "Asia/Almaty" },
      },
    }, []);

    expect(out.goal).toBe("whatsapp");
    expect(out.pageId).toBe("p1");
    expect(out.instagramUserId).toBe("ig1");
    expect(out.budgetCents).toBe(2500);
    expect(out.cabinetCity).toBe("Астана");
    expect(out.targeting).toEqual({ geo: ["Астана"] });
  });

  it("daily_budget кабинета важнее бюджета мастера и уже в минорных единицах", () => {
    const out = normalizeLaunchPayload(
      { goal: "site-leads", budget: 25, clientConfig: { daily_budget: 7000 } },
      [],
    );
    expect(out.budgetCents).toBe(7000);
  });

  it("две и более карусельных картинки включают формат карусели", () => {
    const media = [0, 1].map((index) => ({
      role: "carousel" as const, index, url: `u${index}`, mime: "image/jpeg", name: `${index}.jpg`,
    }));
    expect(normalizeLaunchPayload({ goal: "site-leads" }, media).creativeFormat).toBe("carousel");
  });

  it("неизвестная цель не пролезает в Meta — падаем на site-leads", () => {
    expect(normalizeLaunchPayload({ goal: "что-то своё" }, []).goal).toBe("site-leads");
  });
});
