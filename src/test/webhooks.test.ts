/** Исходящие вебхуки: подпись HMAC, лестница повторов, классификация ответа. */
import { describe, expect, it } from "vitest";
import {
  classifyDeliveryStatus,
  generateWebhookSecret,
  isWebhookEvent,
  signWebhook,
  verifyWebhookSignature,
  WEBHOOK_MAX_ATTEMPTS,
  webhookRetryDelayMinutes,
} from "../../supabase/functions/_lib/webhooks.ts";

describe("подпись", () => {
  it("подписывает и проверяет; чужой секрет и старая метка времени не проходят", async () => {
    const body = JSON.stringify({ event: "publication.published", data: { job_id: "j1" } });
    const sig = await signWebhook("whsec_test", body, 1_757_000_000);
    expect(sig).toMatch(/^t=1757000000,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhookSignature("whsec_test", body, sig, 1_757_000_010)).toBe(true);
    expect(await verifyWebhookSignature("whsec_other", body, sig, 1_757_000_010)).toBe(false);
    expect(await verifyWebhookSignature("whsec_test", body, sig, 1_757_001_000)).toBe(false);
    expect(await verifyWebhookSignature("whsec_test", `${body} `, sig, 1_757_000_010)).toBe(false);
  });

  it("секрет — whsec_ + 64 hex, каждый раз новый", () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(generateWebhookSecret()).not.toBe(a);
  });
});

describe("повторы", () => {
  it("лестница 1 → 5 → 15 → 60 → 180 и потолок попыток", () => {
    expect([1, 2, 3, 4, 5, 9].map(webhookRetryDelayMinutes)).toEqual([1, 5, 15, 60, 180, 180]);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(5);
  });

  it("2xx — доставлено, 5xx/429/сеть — повтор, прочие 4xx — отказ", () => {
    expect(classifyDeliveryStatus(200)).toBe("delivered");
    expect(classifyDeliveryStatus(503)).toBe("retry");
    expect(classifyDeliveryStatus(429)).toBe("retry");
    expect(classifyDeliveryStatus(0)).toBe("retry");
    expect(classifyDeliveryStatus(404)).toBe("failed");
    expect(classifyDeliveryStatus(401)).toBe("failed");
  });
});

describe("события", () => {
  it("знает свои события и звёздочку", () => {
    expect(isWebhookEvent("publication.failed")).toBe(true);
    expect(isWebhookEvent("*")).toBe(true);
    expect(isWebhookEvent("something.else")).toBe(false);
  });
});
