import { describe, expect, it } from "vitest";
import { aggregateCdiRows, type CdiRow } from "@/hooks/useMetaInsights";

function cdiRow(partial: Partial<CdiRow> & Pick<CdiRow, "date">): CdiRow {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    revenue: 0,
    currency: "KZT",
    manual_spend: null,
    manual_leads: null,
    ...partial,
  };
}

describe("aggregateCdiRows", () => {
  it("keeps Meta spend and leads in daily rows (regression: RNP_DAY_ZERO wiped them)", () => {
    const { daily, totals } = aggregateCdiRows([
      cdiRow({ date: "2026-07-01", spend: 10686.4, leads: 10, impressions: 5310, clicks: 134 }),
      cdiRow({ date: "2026-07-02", spend: 8957.37, leads: 2 }),
    ]);

    expect(daily).toHaveLength(2);
    expect(daily[0].date).toBe("2026-07-01");
    expect(daily[0].spend).toBeCloseTo(10686.4);
    expect(daily[0].autoSpend).toBeCloseTo(10686.4);
    expect(daily[0].leads).toBe(10);
    expect(daily[0].autoLeads).toBe(10);
    expect(daily[0].impressions).toBe(5310);
    expect(totals.spend).toBeCloseTo(19643.77);
    expect(totals.leads).toBe(12);
    expect(totals.cpl).toBeCloseTo(19643.77 / 12);
  });

  it("applies manual override instead of Meta value", () => {
    const { daily } = aggregateCdiRows([
      cdiRow({ date: "2026-07-01", spend: 100, leads: 5, manual_spend: 250, manual_leads: 7 }),
    ]);
    expect(daily[0].spend).toBe(250);
    expect(daily[0].autoSpend).toBe(100);
    expect(daily[0].manualSpendRaw).toBe(250);
    expect(daily[0].leads).toBe(7);
    expect(daily[0].autoLeads).toBe(5);
  });

  it("sums two cabinets on the same date", () => {
    const { daily } = aggregateCdiRows([
      cdiRow({ date: "2026-07-01", spend: 100, leads: 1 }),
      cdiRow({ date: "2026-07-01", spend: 200, leads: 2 }),
    ]);
    expect(daily).toHaveLength(1);
    expect(daily[0].spend).toBe(300);
    expect(daily[0].autoSpend).toBe(300);
    expect(daily[0].leads).toBe(3);
  });
});
