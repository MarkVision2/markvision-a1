import { describe, expect, it } from "vitest";
import {
  assertPromptWebhookContract,
  buildBriefWithMarketing,
  buildUserBriefText,
  isBriefTooEmpty,
  resolveProductDescription,
  resolveProductName,
} from "@/lib/contentFactoryBrief";

const marketing = {
  goalLabel: "Конверсии",
  goalDescription: "Покупка",
  toneLabel: "Продающий",
  toneDescription: "Оффер",
  ctaPhrase: "Записаться",
};

describe("contentFactoryBrief", () => {
  it("собирает текст из ссылки и инструкций", () => {
    const text = buildUserBriefText({
      mode: "link",
      linkUrl: "https://kaspi.kz/shop/product/123",
      extraInstructions: "Акцент на скидку",
    });
    expect(text).toContain("kaspi.kz");
    expect(text).toContain("Акцент на скидку");
  });

  it("не считает бриф пустым при ссылке", () => {
    expect(isBriefTooEmpty({ mode: "link", linkUrl: "https://example.com" })).toBe(false);
  });

  it("подставляет marketing в финальный brief", () => {
    const full = buildBriefWithMarketing(
      { mode: "description", description: "Стоматология премиум" },
      marketing,
    );
    expect(full).toContain("Конверсии");
    expect(full).toContain("Стоматология премиум");
    expect(full).toContain("Записаться");
  });

  it("не оставляет description пустым для n8n", () => {
    const desc = resolveProductDescription(
      { mode: "link", linkUrl: "https://shop.example/item" },
      "FULL PROMPT TEXT",
    );
    expect(desc.length).toBeGreaterThan(10);
  });

  it("берёт hostname для name при ссылке", () => {
    expect(resolveProductName({ mode: "link", linkUrl: "https://www.wildberries.ru/x" })).toBe(
      "wildberries.ru",
    );
  });

  it("включает логотип и фото людей в brief", () => {
    const text = buildUserBriefText({
      mode: "photo",
      photosCount: 2,
      peoplePhotosCount: 3,
      logoFile: new File(["x"], "logo.png", { type: "image/png" }),
    });
    expect(text).toContain("логотип");
    expect(text).toContain("3 фото людей");
    expect(text).toContain("2 загруженных фото товара");
  });

  it("включает custom overlay в brief", () => {
    const text = buildUserBriefText({
      mode: "photo",
      photosCount: 1,
      copyMode: "custom",
      overlayText: "Запишись сегодня",
    });
    expect(text).toContain("Запишись сегодня");
    expect(text).toContain("без перефразирования");
  });

  it("считает photo mode непустым при только peoplePhotos", () => {
    expect(
      isBriefTooEmpty({
        mode: "photo",
        peoplePhotos: [new File(["x"], "face.jpg", { type: "image/jpeg" })],
      }),
    ).toBe(false);
  });

  it("считает бриф непустым при только логотипе", () => {
    expect(
      isBriefTooEmpty({
        mode: "photo",
        logoFile: new File(["x"], "logo.png", { type: "image/png" }),
      }),
    ).toBe(false);
  });

  it("считает description mode непустым при только названии товара", () => {
    expect(
      isBriefTooEmpty({
        mode: "description",
        productName: "Увлажнитель воздуха",
      }),
    ).toBe(false);
  });

  it("включает URL логотипа в brief после upload", () => {
    const url = "https://szfgdruhlebfvcmlvxdk.supabase.co/storage/v1/object/public/content-factory-uploads/logo.png";
    const text = buildUserBriefText({
      mode: "photo",
      hasLogo: true,
      logoUrl: url,
    });
    expect(text).toContain(url);
    expect(text).toContain("обязательно использовать");
  });

  it("считает бриф непустым по флагу hasLogo без File", () => {
    expect(isBriefTooEmpty({ mode: "photo", hasLogo: true })).toBe(false);
  });

  it("включает описание в brief независимо от mode", () => {
    const text = buildUserBriefText({
      mode: "photo",
      description: "Клиника эстетической стоматологии",
    });
    expect(text).toContain("Клиника эстетической стоматологии");
  });

  it("assertPromptWebhookContract отклоняет только шаблон без ТЗ", () => {
    const generic =
      "Создай UGC креатив. Контекст продукта: клиент не оставил описание — используй best-practice по нише. " +
      "Технические параметры: соотношение 1:1. Чего избегать: шум.";
    expect(assertPromptWebhookContract(generic, { mode: "photo", hasLogo: true }).ok).toBe(true);
    expect(assertPromptWebhookContract("коротко", { mode: "photo" }).ok).toBe(false);
  });
});

