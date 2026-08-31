import { describe, expect, it } from "vitest";
import {
  buildAdBody,
  buildAdSetBody,
  buildCallToAction,
  buildCampaignBody,
  buildCampaignObjective,
  buildCreativeBody,
  buildLinkContext,
  buildNames,
  buildTargeting,
  campaignGroupKey,
  cleanUrl,
  dailyBudgetMinor,
  deriveHeadline,
  normalizeActId,
  resolveDestination,
  resolveStartTime,
  validateLaunch,
  whatsappLink,
  type CabinetConfig,
  type LaunchInput,
} from "../../supabase/functions/_lib/metaAds.ts";

const cabinet: CabinetConfig = {
  clientName: "Тойота Центр Павлодар — ТОЙОТА",
  adAccountId: "act_1234567890",
  pageId: "555000111",
  instagramUserId: "17841400000000000",
  pixelId: "9988776655",
  pixelEvent: "Lead",
  websiteUrl: "https://example.kz/lead",
  whatsappNumber: "+7 707 913-18-16",
  leadFormId: "111222333",
  timezone: "Asia/Almaty",
};

const singleInput = (goal: LaunchInput["goal"]): LaunchInput => ({
  goal,
  budgetUsd: 50,
  text: "Текст объявления",
  headline: "Заголовок",
  service: "Диагностика",
  creative: { format: "single", imageHash: "hash-1" },
});

describe("примитивы", () => {
  it("нормализует id рекламного аккаунта", () => {
    expect(normalizeActId("1234567890")).toBe("act_1234567890");
    expect(normalizeActId("act_1234567890")).toBe("act_1234567890");
    expect(normalizeActId("  act_12 34  ")).toBe("act_1234");
    expect(normalizeActId("")).toBe("");
  });

  it("отсекает мусорные значения URL", () => {
    expect(cleanUrl("https://a.kz")).toBe("https://a.kz");
    expect(cleanUrl("none")).toBe("");
    expect(cleanUrl("NULL")).toBe("");
    expect(cleanUrl(undefined)).toBe("");
  });

  it("не режет дневной бюджет — предохранителя n8n на $5 больше нет", () => {
    expect(dailyBudgetMinor(50)).toBe(5000);
    expect(dailyBudgetMinor(7.5)).toBe(750);
    expect(dailyBudgetMinor(0)).toBe(500);
    expect(dailyBudgetMinor("нет")).toBe(500);
    // Меньше одной единицы валюты Meta не примет.
    expect(dailyBudgetMinor(0.2)).toBe(100);
  });

  it("считает бюджет в минорных единицах валюты кабинета", () => {
    // Счёт в тенге: 5000 ₸ в сутки — это 500000 тиын, а не 5000.
    expect(dailyBudgetMinor(5000, 100)).toBe(500000);
    // Валюта без копеек: иена уходит целыми единицами.
    expect(dailyBudgetMinor(3000, 1)).toBe(3000);
    expect(dailyBudgetMinor(0, 1)).toBe(5);
  });

  it("собирает ссылку WhatsApp с кодовым словом", () => {
    expect(whatsappLink("+7 707 913-18-16")).toBe("https://wa.me/77079131816");
    expect(whatsappLink("77079131816", "СТАРТ")).toBe(
      "https://wa.me/77079131816?text=%D0%A1%D0%A2%D0%90%D0%A0%D0%A2",
    );
    expect(whatsappLink("")).toBe("");
  });
});

describe("назначение и ссылка", () => {
  it("сопоставляет цель мастера с назначением", () => {
    expect(resolveDestination("site-leads", cabinet)).toBe("website");
    expect(resolveDestination("meta-form", cabinet)).toBe("leadform");
    expect(resolveDestination("whatsapp", cabinet)).toBe("whatsapp");
  });

  it("не уводит на WhatsApp без номера, если есть лид-форма (#1487246)", () => {
    const noNumber = { ...cabinet, whatsappNumber: "" };
    expect(resolveDestination("whatsapp", noNumber)).toBe("leadform");
  });

  it("для лид-формы отдаёт плейсхолдер-ссылку, которую требует Meta", () => {
    const ctx = buildLinkContext(singleInput("meta-form"), cabinet);
    expect(ctx.finalLink).toBe("http://fb.me/");
    expect(buildCallToAction(ctx)).toEqual({
      type: "LEARN_MORE",
      value: { lead_gen_form_id: "111222333" },
    });
  });

  it("для WhatsApp отдаёт WHATSAPP_MESSAGE без ссылки в кнопке (#1487891)", () => {
    const input = { ...singleInput("whatsapp"), codeWord: "+" };
    const ctx = buildLinkContext(input, cabinet);
    expect(ctx.finalLink).toBe("https://wa.me/77079131816?text=%2B");
    expect(buildCallToAction(ctx)).toEqual({
      type: "WHATSAPP_MESSAGE",
      value: { app_destination: "WHATSAPP" },
    });
  });

  it("для сайта подставляет адрес кабинета", () => {
    const ctx = buildLinkContext(singleInput("site-leads"), cabinet);
    expect(ctx.finalLink).toBe("https://example.kz/lead");
    expect(buildCallToAction(ctx)).toEqual({
      type: "LEARN_MORE",
      value: { link: "https://example.kz/lead" },
    });
  });
});

describe("objective кампании", () => {
  it("лид-форма — OUTCOME_LEADS", () => {
    expect(buildCampaignObjective("leadform", cabinet)).toBe("OUTCOME_LEADS");
  });
  it("сайт с событием Purchase — OUTCOME_SALES", () => {
    expect(buildCampaignObjective("website", { ...cabinet, pixelEvent: "Purchase" }))
      .toBe("OUTCOME_SALES");
  });
  it("сайт с обычным событием — OUTCOME_LEADS", () => {
    expect(buildCampaignObjective("website", cabinet)).toBe("OUTCOME_LEADS");
  });
  it("WhatsApp без WABA — трафик, с WABA — вовлечение", () => {
    expect(buildCampaignObjective("whatsapp", cabinet)).toBe("OUTCOME_TRAFFIC");
    expect(buildCampaignObjective("whatsapp", { ...cabinet, wabaPhoneNumberId: "123" }))
      .toBe("OUTCOME_ENGAGEMENT");
  });
});

describe("тело группы объявлений", () => {
  const base = {
    name: "adset",
    destination: "website" as const,
    cabinet,
    budgetUsd: 50,
    targeting: buildTargeting(null),
    startTime: "2026-08-31T09:12:00+0500",
  };

  it("сайт: конверсии на пикселе и окна атрибуции", () => {
    const body = buildAdSetBody(base);
    expect(body.optimization_goal).toBe("OFFSITE_CONVERSIONS");
    expect(body.destination_type).toBe("WEBSITE");
    expect(body.promoted_object).toEqual({
      pixel_id: "9988776655",
      custom_event_type: "LEAD",
    });
    expect(body.attribution_spec).toEqual([
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ]);
    expect(body.daily_budget).toBe("5000");
  });

  it("лид-форма: генерация лидов внутри объявления", () => {
    const body = buildAdSetBody({ ...base, destination: "leadform" });
    expect(body.optimization_goal).toBe("LEAD_GENERATION");
    expect(body.destination_type).toBe("ON_AD");
    expect(body.promoted_object).toEqual({ page_id: "555000111" });
    expect(body.attribution_spec).toBeUndefined();
  });

  it("WhatsApp без WABA: клики, с WABA: переписки", () => {
    const noWaba = buildAdSetBody({ ...base, destination: "whatsapp" });
    expect(noWaba.optimization_goal).toBe("LINK_CLICKS");
    expect(noWaba.destination_type).toBe("WEBSITE");

    const waba = buildAdSetBody({
      ...base,
      destination: "whatsapp",
      cabinet: { ...cabinet, wabaPhoneNumberId: "999" },
    });
    expect(waba.optimization_goal).toBe("CONVERSATIONS");
    expect(waba.destination_type).toBe("WHATSAPP");
    expect(waba.promoted_object).toEqual({
      page_id: "555000111",
      whatsapp_phone_number: "+7 707 913-18-16",
    });
  });

  it("привязывается к кампании, когда id уже известен", () => {
    expect(buildAdSetBody({ ...base, campaignId: "camp-1" }).campaign_id).toBe("camp-1");
    expect(buildAdSetBody(base).campaign_id).toBeUndefined();
  });
});

describe("креатив", () => {
  it("одиночное фото: image_hash в link_data", () => {
    const input = singleInput("whatsapp");
    const ctx = buildLinkContext(input, cabinet);
    const body = buildCreativeBody({ name: "cr", input, cabinet, ctx });
    const spec = body.object_story_spec as Record<string, unknown>;
    const linkData = spec.link_data as Record<string, unknown>;
    expect(spec.page_id).toBe("555000111");
    expect(spec.instagram_user_id).toBe("17841400000000000");
    expect(linkData.image_hash).toBe("hash-1");
    expect(linkData.message).toBe("Текст объявления");
    expect(body.url_tags).toBeUndefined();
  });

  it("объявления на сайт получают метки UTM", () => {
    const input = singleInput("site-leads");
    const ctx = buildLinkContext(input, cabinet);
    const body = buildCreativeBody({ name: "cr", input, cabinet, ctx });
    expect(body.url_tags).toContain("utm_campaign={{campaign.name}}");
  });

  it("карусель раскладывается в child_attachments по порядку", () => {
    const input: LaunchInput = {
      ...singleInput("whatsapp"),
      creative: { format: "carousel", imageHashes: ["h1", "h2", "h3"] },
    };
    const ctx = buildLinkContext(input, cabinet);
    const body = buildCreativeBody({ name: "cr", input, cabinet, ctx });
    const spec = body.object_story_spec as Record<string, unknown>;
    const linkData = spec.link_data as Record<string, unknown>;
    const children = linkData.child_attachments as Array<Record<string, unknown>>;
    expect(children).toHaveLength(3);
    expect(children.map((c) => c.image_hash)).toEqual(["h1", "h2", "h3"]);
  });

  it("видео уходит через video_data с обложкой", () => {
    const input: LaunchInput = {
      ...singleInput("whatsapp"),
      creative: { format: "video", videoId: "vid-1", videoThumbUrl: "https://t/1.jpg" },
    };
    const ctx = buildLinkContext(input, cabinet);
    const body = buildCreativeBody({ name: "cr", input, cabinet, ctx });
    const spec = body.object_story_spec as Record<string, unknown>;
    const videoData = spec.video_data as Record<string, unknown>;
    expect(videoData.video_id).toBe("vid-1");
    expect(videoData.image_url).toBe("https://t/1.jpg");
  });

  it("продвижение поста Instagram не пересобирает креатив", () => {
    const input: LaunchInput = {
      ...singleInput("whatsapp"),
      creative: { format: "existing_post", sourceInstagramMediaId: "ig-media-1" },
    };
    const ctx = buildLinkContext(input, cabinet);
    const body = buildCreativeBody({ name: "cr", input, cabinet, ctx });
    expect(body.source_instagram_media_id).toBe("ig-media-1");
    expect(body.object_id).toBe("555000111");
    expect(body.object_story_spec).toBeUndefined();
  });
});

describe("объявление", () => {
  it("связывает группу и креатив, вешает трекинг пикселя", () => {
    const body = buildAdBody({
      name: "ad",
      adSetId: "as-1",
      creativeId: "cr-1",
      cabinet,
    });
    expect(body.adset_id).toBe("as-1");
    expect(body.creative).toEqual({ creative_id: "cr-1" });
    expect(body.tracking_specs).toEqual([
      { "action.type": ["offsite_conversion"], fb_pixel: ["9988776655"] },
    ]);
  });

  it("без пикселя трекинг не добавляется", () => {
    const body = buildAdBody({
      name: "ad",
      adSetId: "as-1",
      creativeId: "cr-1",
      cabinet: { ...cabinet, pixelId: "" },
    });
    expect(body.tracking_specs).toBeUndefined();
  });
});

describe("имена и ключ консолидации", () => {
  const now = new Date("2026-08-31T04:00:00Z"); // 09:00 в Алматы

  it("кампания без услуги, группа с услугой и индексом", () => {
    const names = buildNames({
      clientName: cabinet.clientName,
      service: "Диагностика",
      format: "single",
      destination: "whatsapp",
      now,
      timeZone: "Asia/Almaty",
      groupIndex: 2,
    });
    expect(names.campaign).toBe("ТОЙОТА | Фото | WhatsApp | 3108 | AI");
    expect(names.adSet).toBe("ТОЙОТА | Диагностика | Фото | 3108 | AI | g2");
    expect(names.ad).toBe(names.adSet);
  });

  it("имя кампании не зависит от услуги — запуски дня сходятся в одну", () => {
    const a = buildNames({
      clientName: "Клиника", service: "Чистка", format: "single",
      destination: "website", now, groupIndex: 1,
    });
    const b = buildNames({
      clientName: "Клиника", service: "Импланты", format: "single",
      destination: "website", now, groupIndex: 2,
    });
    expect(a.campaign).toBe(b.campaign);
    expect(a.adSet).not.toBe(b.adSet);
  });

  it("ключ консолидации берёт дату по поясу кабинета", () => {
    // 20:30 UTC — в Алматы уже следующие сутки.
    const late = new Date("2026-08-31T20:30:00Z");
    const key = campaignGroupKey({
      adAccountId: "1234567890",
      now: late,
      timeZone: "Asia/Almaty",
      destination: "whatsapp",
      objective: "OUTCOME_TRAFFIC",
    });
    expect(key).toEqual({
      adAccountId: "act_1234567890",
      dateKey: "2026-09-01",
      goal: "whatsapp",
      objective: "OUTCOME_TRAFFIC",
    });
  });
});

describe("время старта", () => {
  it("до полудня по кабинету — через две минуты", () => {
    const now = new Date("2026-08-31T04:00:00Z"); // 09:00 Алматы
    expect(resolveStartTime(now, "Asia/Almaty")).toBe("2026-08-31T09:02:00+0500");
  });

  it("после полудня — в полночь следующих суток", () => {
    const now = new Date("2026-08-31T10:00:00Z"); // 15:00 Алматы
    expect(resolveStartTime(now, "Asia/Almaty")).toBe("2026-09-01T00:00:00+0500");
  });

  it("работает и для других поясов", () => {
    const now = new Date("2026-08-31T06:00:00Z"); // 09:00 в Москве
    expect(resolveStartTime(now, "Europe/Moscow")).toBe("2026-08-31T09:02:00+0300");
  });
});

describe("валидация до обращения в Meta", () => {
  it("исправный запуск проходит", () => {
    expect(validateLaunch(singleInput("whatsapp"), cabinet)).toEqual([]);
  });

  it("сайт без пикселя и адреса не пускаем", () => {
    const errors = validateLaunch(singleInput("site-leads"), {
      ...cabinet,
      pixelId: "",
      websiteUrl: "",
    });
    expect(errors).toContain("Для цели «Лиды с сайта» нужен пиксель Meta.");
    expect(errors).toContain("Для цели «Лиды с сайта» нужен адрес сайта.");
  });

  it("карусель из одной картинки — ошибка", () => {
    const input: LaunchInput = {
      ...singleInput("whatsapp"),
      creative: { format: "carousel", imageHashes: ["h1"] },
    };
    expect(validateLaunch(input, cabinet)).toContain(
      "Для карусели нужно минимум два изображения.",
    );
  });

  it("кабинет без страницы Facebook — ошибка", () => {
    expect(validateLaunch(singleInput("whatsapp"), { ...cabinet, pageId: "" }))
      .toContain("У кабинета не выбрана страница Facebook.");
  });
});

describe("тело кампании", () => {
  it("создаётся активной и без общего бюджета", () => {
    const body = buildCampaignBody({
      name: "camp",
      destination: "website",
      cabinet,
    });
    expect(body).toMatchObject({
      name: "camp",
      objective: "OUTCOME_LEADS",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      status: "ACTIVE",
    });
  });
});

describe("deriveHeadline", () => {
  it("берёт первое предложение текста", () => {
    expect(deriveHeadline("Чистка зубов за 5000₸. Запишитесь сегодня!"))
      .toBe("Чистка зубов за 5000₸");
  });

  it("режет по границе слова, не обрывая посередине", () => {
    const h = deriveHeadline(
      "Комплексная диагностика организма для всей семьи с расшифровкой врача",
    );
    expect(h.length).toBeLessThanOrEqual(40);
    expect(h.endsWith(" ")).toBe(false);
    expect("Комплексная диагностика организма для всей семьи".startsWith(h)).toBe(true);
  });

  it("выкидывает ссылки, разметку и эмодзи", () => {
    expect(deriveHeadline("🔥 Скидка 30% https://example.kz на импланты"))
      .toBe("Скидка 30% на импланты");
  });

  it("берёт первую строку многострочного текста", () => {
    expect(deriveHeadline("Импланты под ключ\nЗвоните прямо сейчас"))
      .toBe("Импланты под ключ");
  });

  it("пустой текст даёт пустой заголовок — вызывающий подставит своё", () => {
    expect(deriveHeadline("")).toBe("");
    expect(deriveHeadline(null)).toBe("");
    expect(deriveHeadline("   ")).toBe("");
  });
});
