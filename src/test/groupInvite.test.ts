import { describe, expect, it } from "vitest";
import { isInvitePreviewBot, trackedInviteUrl } from "@/lib/groupInvite";

describe("groupInvite", () => {
  it("trackedInviteUrl", () => {
    expect(trackedInviteUrl("lab")).toBe("https://www.markvision.kz/g/lab");
    expect(trackedInviteUrl("lab", "vit")).toBe(
      "https://www.markvision.kz/g/lab?utm_source=vit",
    );
  });

  it("фильтрует превью-ботов и curl", () => {
    expect(isInvitePreviewBot("curl/8.5.0")).toBe(true);
    expect(isInvitePreviewBot("WhatsApp/2.23.20.0")).toBe(true);
    expect(isInvitePreviewBot("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isInvitePreviewBot(null)).toBe(true);
    expect(
      isInvitePreviewBot(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(
      isInvitePreviewBot(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });
});
