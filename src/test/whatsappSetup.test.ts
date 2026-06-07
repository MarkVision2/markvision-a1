import { describe, expect, it } from "vitest";
import { isValidBotWebhookUrl } from "@/lib/whatsappSetup";

describe("isValidBotWebhookUrl", () => {
  it("allows https n8n webhook with path", () => {
    expect(isValidBotWebhookUrl("https://n8n.zapoinov.com/webhook/whatsapp-bot")).toBe(true);
  });

  it("rejects non-https and localhost", () => {
    expect(isValidBotWebhookUrl("http://n8n.example.com/hook")).toBe(false);
    expect(isValidBotWebhookUrl("https://127.0.0.1/hook")).toBe(false);
  });

  it("allows empty (optional field)", () => {
    expect(isValidBotWebhookUrl("")).toBe(true);
  });
});
