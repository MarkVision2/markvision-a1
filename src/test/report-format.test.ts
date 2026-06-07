import { describe, it, expect } from "vitest";
import { fmtMetricTenge, fmtTenge } from "@/components/reports/reportFormat";

describe("reportFormat", () => {
  it("fmtTenge использует символ тенге", () => {
    expect(fmtTenge(10_000)).toContain("₸");
    expect(fmtTenge(10_000)).not.toContain("$");
    expect(fmtTenge(10_000)).toMatch(/10/);
  });

  it("fmtMetricTenge показывает тире без базы", () => {
    expect(fmtMetricTenge(0, false)).toBe("—");
    expect(fmtMetricTenge(5_000, true)).toContain("₸");
  });
});
