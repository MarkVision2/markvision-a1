import { describe, expect, it } from "vitest";
import {
  isManualOverrideActive,
  manualValueForSave,
  resolveCdiMetric,
} from "@/lib/cdiManualOverride";

describe("cdiManualOverride", () => {
  it("treats null/undefined as no override", () => {
    expect(isManualOverrideActive(null)).toBe(false);
    expect(isManualOverrideActive(undefined)).toBe(false);
    expect(resolveCdiMetric(null, 3)).toBe(3);
  });

  it("allows explicit zero override", () => {
    expect(isManualOverrideActive(0)).toBe(true);
    expect(resolveCdiMetric(0, 3)).toBe(0);
  });

  it("maps empty save to null", () => {
    expect(manualValueForSave("")).toBe(null);
    expect(manualValueForSave("  ")).toBe(null);
    expect(manualValueForSave(5)).toBe(5);
    expect(manualValueForSave(0)).toBe(0);
  });
});
