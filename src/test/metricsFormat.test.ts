import { describe, expect, it } from "vitest";
import { countLabel, pluralRu } from "@/components/metrics/metricsFormat";

describe("metricsFormat pluralRu", () => {
  it("pluralizes leads and payments correctly", () => {
    expect(pluralRu(1, "лид", "лида", "лидов")).toBe("лид");
    expect(pluralRu(2, "лид", "лида", "лидов")).toBe("лида");
    expect(pluralRu(5, "лид", "лида", "лидов")).toBe("лидов");
    expect(pluralRu(21, "оплата", "оплаты", "оплат")).toBe("оплата");
    expect(pluralRu(31, "лид", "лида", "лидов")).toBe("лид");
  });

  it("formats count labels", () => {
    expect(countLabel(1, "оплата", "оплаты", "оплат")).toBe("1 оплата");
    expect(countLabel(31, "лид", "лида", "лидов")).toBe("31 лид");
  });
});
