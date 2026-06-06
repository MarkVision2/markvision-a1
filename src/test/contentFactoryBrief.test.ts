import { describe, expect, it } from "vitest";
import {
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
});
