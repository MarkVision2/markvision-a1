import { describe, expect, it } from "vitest";
import { callCommStatus, callContent, callStatusLabel } from "@/lib/whatsappCallStatus";

describe("whatsappCallStatus", () => {
  it("maps Green API call statuses to Russian labels", () => {
    expect(callStatusLabel("offer")).toBe("входящий");
    expect(callStatusLabel("pickUp")).toBe("отвечен");
    expect(callStatusLabel("declined")).toBe("пропущен");
  });

  it("maps statuses for communications.status", () => {
    expect(callCommStatus("offer")).toBe("ringing");
    expect(callCommStatus("pickUp")).toBe("answered");
    expect(callCommStatus("missed")).toBe("missed");
  });

  it("builds CRM content line", () => {
    expect(callContent("offer")).toContain("WhatsApp-звонок");
    expect(callContent("offer")).toContain("входящий");
  });
});
