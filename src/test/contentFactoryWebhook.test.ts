import { describe, expect, it } from "vitest";
import {
  buildContentFactoryWebhookPayload,
  buildNicheContext,
} from "@/lib/contentFactoryWebhook";

describe("contentFactoryWebhook", () => {
  it("buildNicheContext collects all TZ fields regardless of mode", () => {
    const niche = buildNicheContext({
      productName: "Клиника",
      description: "Имплантация зубов",
      linkUrl: "https://example.com",
      extraInstructions: "Акцент на безболезненность",
    });
    expect(niche).toContain("Клиника");
    expect(niche).toContain("Имплантация");
    expect(niche).toContain("example.com");
    expect(niche).toContain("безболезненность");
  });

  it("buildContentFactoryWebhookPayload duplicates TZ into body for n8n", () => {
    const payload = buildContentFactoryWebhookPayload({
      flat: {
        content_type: "fb-target",
        prompt: "TECH",
        image_urls: ["https://x/logo.png"],
        logo_url: "https://x/logo.png",
      },
      finalTechnicalBrief: "FULL TECHNICAL BRIEF FOR AI",
      userRawPrompt: "user brief from step 1",
      task: "ad_creative",
      route: "fb-target",
      typeId: "facebook-ads",
      category: "ads",
      sourceInput: { mode: "description", description: "Стоматология" },
      formatBlock: { aspect: "1:1", lang: "ru", variants: 3 },
      designBlock: { style: ["ugc"], angles: [{ id: "front", label: "Фронт", description: "" }] },
      marketingBlock: { goal: { id: "conversions", label: "Конверсии", description: "" } },
      contentTypeBlock: { id: "facebook-ads", title: "Facebook Ads" },
      angles: [{ id: "front", label: "Фронт", description: "Анфас" }],
    });

    const body = payload.body as Record<string, unknown>;
    expect(body.prompt).toBe("FULL TECHNICAL BRIEF FOR AI");
    expect(body.finalPrompt).toBe("FULL TECHNICAL BRIEF FOR AI");
    expect(body.user_brief).toBe("user brief from step 1");
    expect(body.task).toBe("ad_creative");
    expect(body.route).toBe("fb-target");
    expect(body.typeId).toBe("facebook-ads");
    expect(body.source_input).toEqual({ mode: "description", description: "Стоматология" });
    expect(body.design).toBeDefined();
    expect(body.marketing).toBeDefined();
    expect(body.format).toEqual({ aspect: "1:1", lang: "ru", variants: 3 });
    expect(body.angles).toHaveLength(1);
    expect(body.angle_ids).toEqual(["front"]);
    expect(payload.prompt).toBe("FULL TECHNICAL BRIEF FOR AI");
  });
});
