import { describe, it, expect } from "vitest";
import {
  aggregateCreativeCrmFromDaily,
  aggregateCreativeCrmFromLeads,
  mergeCreativeCrmMaps,
} from "@/lib/creativeCrmMetrics";

describe("aggregateCreativeCrmFromDaily", () => {
  it("суммирует продажи и диагностическую выручку", () => {
    const map = aggregateCreativeCrmFromDaily([
      {
        ad_id: "ad-1",
        crm_sales: 1,
        crm_revenue: 500_000,
        crm_diagnostics: 1,
        crm_diagnostic_revenue: 10_000,
      },
    ]);
    expect(map.get("ad-1")?.crmRevenue).toBe(510_000);
    expect(map.get("ad-1")?.crmDiagnostics).toBe(1);
  });
});

describe("aggregateCreativeCrmFromLeads", () => {
  const range = {
    from: new Date("2026-06-01"),
    to: new Date("2026-06-30"),
  };

  it("атрибутирует диагностику по meta_ad_id", () => {
    const map = aggregateCreativeCrmFromLeads(
      [
        {
          metaAdId: "ad-42",
          createdAt: "2026-06-05T10:00:00Z",
          stageKey: "visit",
          diagnosticAmount: 10_000,
          paid: false,
          lastActivityAt: "2026-06-10T12:00:00Z",
        },
      ],
      range,
    );
    expect(map.get("ad-42")?.crmRevenue).toBe(10_000);
    expect(map.get("ad-42")?.crmDiagnostics).toBe(1);
  });
});

describe("mergeCreativeCrmMaps", () => {
  it("берёт максимум по выручке из двух источников", () => {
    const view = aggregateCreativeCrmFromDaily([
      { ad_id: "ad-1", crm_revenue: 0, crm_diagnostic_revenue: 0 },
    ]);
    const leads = aggregateCreativeCrmFromLeads(
      [
        {
          metaAdId: "ad-1",
          createdAt: "2026-06-05T10:00:00Z",
          stageKey: "visit",
          diagnosticAmount: 10_000,
          paid: false,
          lastActivityAt: "2026-06-10T12:00:00Z",
        },
      ],
      { from: new Date("2026-06-01"), to: new Date("2026-06-30") },
    );
    const merged = mergeCreativeCrmMaps(view, leads);
    expect(merged.get("ad-1")?.crmRevenue).toBe(10_000);
  });
});
