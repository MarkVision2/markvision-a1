import { describe, expect, it } from "vitest";
import {
  isManualOverrideActive,
  manualValueForSave,
  resolveCdiMetric,
} from "@/lib/cdiManualOverride";

describe("cdiManualOverride", () => {
  it("NULL manual uses CRM", () => {
    expect(resolveCdiMetric(null, 4)).toBe(4);
    expect(resolveCdiMetric(undefined, 2)).toBe(2);
  });

  it("zero manual is explicit override", () => {
    expect(resolveCdiMetric(0, 4)).toBe(0);
    expect(isManualOverrideActive(0)).toBe(true);
  });

  it("manualValueForSave maps empty to null", () => {
    expect(manualValueForSave("")).toBe(null);
    expect(manualValueForSave("0")).toBe(0);
    expect(manualValueForSave(3)).toBe(3);
  });
});
