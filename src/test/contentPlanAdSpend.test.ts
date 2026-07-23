import { describe, expect, it } from "vitest";
import { resolveContentPlanAdSpend } from "@/lib/contentPlanAdSpend";

describe("resolveContentPlanAdSpend", () => {
  it("prefers Meta spend when > 0", () => {
    expect(resolveContentPlanAdSpend(100, 2500)).toBe(2500);
    expect(resolveContentPlanAdSpend(0, 10)).toBe(10);
  });

  it("falls back to manual when Meta missing or zero", () => {
    expect(resolveContentPlanAdSpend(100, undefined)).toBe(100);
    expect(resolveContentPlanAdSpend(100, 0)).toBe(100);
    expect(resolveContentPlanAdSpend(0, 0)).toBe(0);
    expect(resolveContentPlanAdSpend(0, undefined)).toBe(0);
  });

  it("ignores non-finite manual", () => {
    expect(resolveContentPlanAdSpend(Number.NaN, undefined)).toBe(0);
    expect(resolveContentPlanAdSpend(Number.NaN, 50)).toBe(50);
  });
});
