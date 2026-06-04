import { describe, expect, it } from "vitest";
import { isLeadDiagnosticEvent, isLeadVisit } from "@/lib/leadStageFlags";

describe("isLeadDiagnosticEvent", () => {
  it("paid lead is visit but not diagnostic event", () => {
    const paid = {
      paid: true,
      paidAt: "2026-03-01T10:00:00Z",
      stageKey: "paid",
      amount: 100_000,
    };
    expect(isLeadVisit(paid)).toBe(true);
    expect(isLeadDiagnosticEvent(paid)).toBe(false);
  });

  it("scheduled stage counts as diagnostic event", () => {
    expect(
      isLeadDiagnosticEvent({
        stageKey: "scheduled",
      }),
    ).toBe(true);
  });
});
