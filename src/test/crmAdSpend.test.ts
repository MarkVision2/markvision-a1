import { describe, expect, it } from "vitest";
import { cplFromSpend, sumSpendInRange } from "@/hooks/useCrmAdSpend";

describe("crm ad spend helpers", () => {
  it("sums spend in range and focus day", () => {
    const m = new Map([
      ["2026-07-28", 1000],
      ["2026-07-29", 2000],
      ["2026-07-30", 3000],
    ]);
    expect(sumSpendInRange(m, "2026-07-29", "2026-07-30")).toBe(5000);
    expect(sumSpendInRange(m, "2026-07-28", "2026-07-30", "2026-07-29")).toBe(2000);
  });

  it("computes CPL = spend / leads", () => {
    expect(cplFromSpend(10_000, 4)).toBe(2500);
    expect(cplFromSpend(0, 4)).toBe(0);
    expect(cplFromSpend(10_000, 0)).toBe(0);
  });
});
