import { describe, it, expect } from "vitest";
import { fromTomorrowRange, tomorrowAlmatyYmd, ymdLocal } from "@/lib/metricsPeriod";

describe("fromTomorrowRange", () => {
  it("starts tomorrow local and spans 60 days", () => {
    const now = new Date(2026, 6, 19); // Jul 19 local
    const range = fromTomorrowRange(now);
    expect(ymdLocal(range.from)).toBe("2026-07-20");
    expect(ymdLocal(range.to)).toBe("2026-09-18");
  });
});

describe("tomorrowAlmatyYmd", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(tomorrowAlmatyYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
