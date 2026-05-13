import { describe, it, expect } from "vitest";
import { classifyGoal } from "@/hooks/useMetaStructure";
import { formatHours, formatDuration } from "@/hooks/useCrmFlow";
import { normalizeSource } from "@/lib/leadSource";

describe("classifyGoal (Meta campaign objective → human-readable goal)", () => {
  it("destination=WHATSAPP побеждает любой objective", () => {
    const g = classifyGoal("OUTCOME_AWARENESS", "WHATSAPP");
    expect(g.key).toBe("whatsapp");
    expect(g.label).toBe("WhatsApp");
    expect(g.successMetric).toBe("messages");
  });

  it("destination=MESSENGER → группа messages", () => {
    expect(classifyGoal("LINK_CLICKS", "MESSENGER").key).toBe("messages");
  });

  it("destination=INSTAGRAM_DIRECT → группа messages", () => {
    expect(classifyGoal(null, "INSTAGRAM_DIRECT").key).toBe("messages");
  });

  it("LEAD_GENERATION без destination → leads (общее)", () => {
    const g = classifyGoal("LEAD_GENERATION", null);
    expect(g.key).toBe("leads");
    expect(g.successMetric).toBe("leads");
  });

  it("OUTCOME_LEADS + WEBSITE → лиды с сайта (пиксель)", () => {
    const g = classifyGoal("OUTCOME_LEADS", "WEBSITE");
    expect(g.key).toBe("leads_pixel");
    expect(g.label).toBe("Лиды с сайта (пиксель)");
  });

  it("OUTCOME_LEADS + ON_AD → лиды через форму Meta", () => {
    const g = classifyGoal("OUTCOME_LEADS", "ON_AD");
    expect(g.key).toBe("leads_form");
    expect(g.label).toBe("Лиды через форму Meta");
  });

  it("OUTCOME_LEADS + INSTANT_FORM → leads_form", () => {
    expect(classifyGoal("OUTCOME_LEADS", "INSTANT_FORM").key).toBe("leads_form");
  });

  it("OUTCOME_LEADS + LEAD_FORM → leads_form", () => {
    expect(classifyGoal("OUTCOME_LEADS", "LEAD_FORM").key).toBe("leads_form");
  });

  it("LEAD_GENERATION + ON_AD → leads_form", () => {
    expect(classifyGoal("LEAD_GENERATION", "ON_AD").key).toBe("leads_form");
  });

  it("OUTCOME_LEADS без destination → fallback leads", () => {
    expect(classifyGoal("OUTCOME_LEADS", null).key).toBe("leads");
  });

  it("MESSAGING_INSTAGRAM_DIRECT_WHATSAPP — тоже WhatsApp (объединено)", () => {
    const g = classifyGoal("OUTCOME_ENGAGEMENT", "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP");
    expect(g.key).toBe("whatsapp");
    expect(g.label).toBe("WhatsApp");
  });

  it("WHATSAPP_BUSINESS_API → whatsapp", () => {
    expect(classifyGoal("OUTCOME_TRAFFIC", "WHATSAPP_BUSINESS_API").key).toBe("whatsapp");
  });

  it("OUTCOME_ENGAGEMENT без destination → engagement", () => {
    expect(classifyGoal("OUTCOME_ENGAGEMENT", null).key).toBe("engagement");
  });

  it("MESSAGES objective без destination → messages", () => {
    expect(classifyGoal("MESSAGES", null).key).toBe("messages");
  });

  it("OUTCOME_TRAFFIC → traffic, успех = clicks", () => {
    const g = classifyGoal("OUTCOME_TRAFFIC", null);
    expect(g.key).toBe("traffic");
    expect(g.successMetric).toBe("clicks");
  });

  it("OUTCOME_SALES → purchase, успех = purchases", () => {
    expect(classifyGoal("OUTCOME_SALES", null).key).toBe("purchase");
  });

  it("VIDEO_VIEWS → video", () => {
    expect(classifyGoal("VIDEO_VIEWS", null).key).toBe("video");
  });

  it("BRAND_AWARENESS → awareness", () => {
    expect(classifyGoal("BRAND_AWARENESS", null).key).toBe("awareness");
  });

  it("Неизвестная цель → other с сохранённой меткой", () => {
    const g = classifyGoal("UNKNOWN_CUSTOM", null);
    expect(g.key).toBe("other");
    expect(g.label).toBe("UNKNOWN_CUSTOM");
  });

  it("null objective и null destination → other 'Без цели'", () => {
    const g = classifyGoal(null, null);
    expect(g.key).toBe("other");
    expect(g.label).toBe("Без цели");
  });
});

describe("formatHours", () => {
  it("меньше часа → в минутах", () => {
    expect(formatHours(0.5)).toBe("30 мин");
    expect(formatHours(0.25)).toBe("15 мин");
  });

  it("от 1 до 24 часов — в часах с одной десятой", () => {
    expect(formatHours(1)).toBe("1.0 ч");
    expect(formatHours(5.4)).toBe("5.4 ч");
    expect(formatHours(23.9)).toBe("23.9 ч");
  });

  it("больше 24 часов — в днях", () => {
    expect(formatHours(48)).toBe("2.0 дн");
    expect(formatHours(72.5)).toBe("3.0 дн");
  });
});

describe("formatDuration", () => {
  it("очень коротко → <1 мин", () => {
    expect(formatDuration(0.5)).toBe("<1 мин");
  });

  it("в минутах для интервала 1..59", () => {
    expect(formatDuration(5)).toBe("5 мин");
    expect(formatDuration(59.4)).toBe("59 мин");
  });

  it("в часах для интервала 60..24h", () => {
    expect(formatDuration(60)).toBe("1.0 ч");
    expect(formatDuration(150)).toBe("2.5 ч");
  });

  it("в днях > 24 часов", () => {
    expect(formatDuration(60 * 48)).toBe("2.0 дн");
  });
});

describe("normalizeSource — multi-provider lead source keys", () => {
  it("instagram_organic → Instagram (organic)", () => {
    const m = normalizeSource("instagram_organic");
    expect(m.key).toBe("instagram_organic");
    expect(m.label).toBe("Instagram (organic)");
  });

  it("reels → Instagram (organic)", () => {
    expect(normalizeSource("reels").key).toBe("instagram_organic");
  });

  it("google / google_ads → Google Ads (key=google)", () => {
    expect(normalizeSource("google").key).toBe("google");
    expect(normalizeSource("google_ads").key).toBe("google");
    expect(normalizeSource("googleads").label).toBe("Google Ads");
  });

  it("meta → Facebook (исторически синоним)", () => {
    expect(normalizeSource("meta").label).toBe("Facebook");
  });

  it("пустая строка → unknown «Без источника»", () => {
    const m = normalizeSource(null);
    expect(m.key).toBe("unknown");
    expect(m.label).toBe("Без источника");
  });

  it("неизвестный source отображает оригинал", () => {
    const m = normalizeSource("partner_x");
    expect(m.key).toBe("unknown");
    expect(m.label).toBe("partner_x");
  });
});
