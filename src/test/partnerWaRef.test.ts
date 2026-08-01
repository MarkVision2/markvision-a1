import { describe, expect, it } from "vitest";
import {
  isGenericLeadSource,
  partnerSourceFromWhatsAppText,
} from "@/lib/partnerWaRef";
import { normalizeSource } from "@/lib/leadSource";
import { sourceLabel } from "@/lib/analyticsBreakdowns";

describe("partnerSourceFromWhatsAppText", () => {
  it("читает партнёра из ref:zapoinovai.<partner> (как после /p/:slug + cid)", () => {
    expect(partnerSourceFromWhatsAppText("Хочу получить доступ\nref:zapoinovai.yuriy")).toBe("yuriy");
    expect(partnerSourceFromWhatsAppText("Хочу получить доступ\nref:zapoinovai.dastan")).toBe("dastan");
    expect(partnerSourceFromWhatsAppText("ref:zapoinovai.nadi")).toBe("nadi");
    expect(partnerSourceFromWhatsAppText("ref:zapoinovai.astana_hub")).toBe("astana_hub");
    expect(partnerSourceFromWhatsAppText("ref:zapoinovai.hub")).toBe("astana_hub");
    expect(partnerSourceFromWhatsAppText("ref:zapoinovai.vit")).toBe("виталя");
  });

  it("игнорирует числовые Meta cid/asid/adid", () => {
    expect(
      partnerSourceFromWhatsAppText("Хочу получить доступ\nref:zapoinovai.120212120.330011.440022"),
    ).toBeNull();
  });

  it("без cid партнёра — только site → null", () => {
    expect(partnerSourceFromWhatsAppText("Хочу получить доступ\nref:zapoinovai")).toBeNull();
  });

  it("utm_source= в тексте тоже ловит", () => {
    expect(partnerSourceFromWhatsAppText("hi utm_source=yuriy")).toBe("yuriy");
  });
});

describe("partner sources in CRM UI", () => {
  it("normalizeSource даёт читаемые лейблы", () => {
    expect(normalizeSource("yuriy").label).toBe("Yuriy");
    expect(normalizeSource("dastan").label).toBe("Дастан");
    expect(normalizeSource("nadi").label).toBe("Нади");
    expect(normalizeSource("astana_hub").label).toBe("Astana Hub");
    expect(normalizeSource("hub").label).toBe("Astana Hub");
  });

  it("analytics sourceLabel совпадает", () => {
    expect(sourceLabel("yuriy")).toBe("Yuriy");
    expect(sourceLabel("dastan")).toBe("Дастан");
    expect(sourceLabel("astana_hub")).toBe("Astana Hub");
  });

  it("zapoinovai считается generic (можно перезаписать партнёром)", () => {
    expect(isGenericLeadSource("zapoinovai")).toBe(true);
    expect(isGenericLeadSource("whatsapp")).toBe(true);
    expect(isGenericLeadSource("yuriy")).toBe(false);
    expect(isGenericLeadSource("meta")).toBe(false);
  });
});
