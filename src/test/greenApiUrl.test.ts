import { describe, expect, it } from "vitest";
import {
  isAllowedGreenApiHost,
  validateGreenApiBaseUrl,
} from "../../supabase/functions/_lib/green_api_url.ts";

describe("validateGreenApiBaseUrl", () => {
  it("allows official Green API hosts", () => {
    expect(validateGreenApiBaseUrl("https://api.green-api.com")).toBe(
      "https://api.green-api.com",
    );
    expect(validateGreenApiBaseUrl("https://7105.api.greenapi.com/")).toBe(
      "https://7105.api.greenapi.com",
    );
  });

  it("defaults empty input to the standard host", () => {
    expect(validateGreenApiBaseUrl(null)).toBe("https://api.green-api.com");
    expect(validateGreenApiBaseUrl("")).toBe("https://api.green-api.com");
  });

  it("rejects SSRF targets", () => {
    const blocked = [
      "http://api.green-api.com",
      "https://127.0.0.1",
      "https://169.254.169.254/latest/meta-data/",
      "https://evil.com",
      "https://api.green-api.com/internal",
      "https://user:pass@api.green-api.com",
    ];
    for (const url of blocked) {
      expect(() => validateGreenApiBaseUrl(url)).toThrow();
    }
  });

  it("rejects private and metadata hostnames", () => {
    expect(isAllowedGreenApiHost("localhost")).toBe(false);
    expect(isAllowedGreenApiHost("10.0.0.1")).toBe(false);
    expect(isAllowedGreenApiHost("169.254.169.254")).toBe(false);
  });
});
