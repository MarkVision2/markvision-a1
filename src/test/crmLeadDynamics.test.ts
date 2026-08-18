import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  buildLeadChannelBreakdown,
  buildLeadDynamics,
  rangeForLeadPreset,
} from "@/lib/crmLeadDynamics";

describe("crmLeadDynamics", () => {
  it("addDaysYmd shifts calendar days", () => {
    expect(addDaysYmd("2026-07-30", -1)).toBe("2026-07-29");
    expect(addDaysYmd("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("today range is a single Almaty day", () => {
    // 2026-07-30 08:00 UTC = 13:00 Almaty
    const now = new Date("2026-07-30T08:00:00Z");
    expect(rangeForLeadPreset("today", now)).toEqual({
      fromYmd: "2026-07-30",
      toYmd: "2026-07-30",
    });
    expect(rangeForLeadPreset("yesterday", now)).toEqual({
      fromYmd: "2026-07-29",
      toYmd: "2026-07-29",
    });
  });

  it("counts leads by created day in Almaty", () => {
    const now = new Date("2026-07-30T08:00:00Z");
    const leads = [
      { createdAt: "2026-07-30T05:00:00Z" }, // today Almaty
      { createdAt: "2026-07-30T10:00:00Z" }, // today
      { createdAt: "2026-07-29T12:00:00Z" }, // yesterday
      { createdAt: "2026-07-28T12:00:00Z" },
    ];
    const today = buildLeadDynamics(leads, "today", { now });
    expect(today.total).toBe(2);
    expect(today.days).toHaveLength(1);
    expect(today.days[0].count).toBe(2);

    const week = buildLeadDynamics(leads, "week", { now });
    // week Mon 27 – Thu 30 Jul 2026
    expect(week.fromYmd).toBe("2026-07-27");
    expect(week.toYmd).toBe("2026-07-30");
    expect(week.total).toBe(4);

    const focused = buildLeadDynamics(leads, "week", { now, focusYmd: "2026-07-29" });
    expect(focused.total).toBe(1);
    expect(focused.rangeLabel).toContain("29");
  });

  it("breaks down leads by channel for the period", () => {
    const now = new Date("2026-07-30T08:00:00Z");
    const leads = [
      { createdAt: "2026-07-30T05:00:00Z", source: "instagram" },
      { createdAt: "2026-07-30T06:00:00Z", source: "instagram" },
      { createdAt: "2026-07-30T07:00:00Z", source: "tiktok" },
      { createdAt: "2026-07-29T12:00:00Z", source: "google" },
    ];
    const today = buildLeadDynamics(leads, "today", { now });
    const channels = buildLeadChannelBreakdown(leads, today.fromYmd, today.toYmd);
    expect(channels[0]).toMatchObject({ label: "Инстаграм", count: 2 });
    expect(channels.some((c) => c.label === "TikTok" && c.count === 1)).toBe(true);
  });

  it("не считает broadcast / broadcast_zoom в KPI новых лидов", () => {
    const now = new Date("2026-08-01T08:00:00Z");
    const leads = [
      { createdAt: "2026-08-01T05:00:00Z", source: "zapoinovai" },
      { createdAt: "2026-08-01T05:01:00Z", source: "broadcast_zoom" },
      { createdAt: "2026-08-01T05:02:00Z", source: "broadcast_zoom" },
      { createdAt: "2026-08-01T05:03:00Z", source: "broadcast" },
      { createdAt: "2026-08-01T05:04:00Z", source: "whatsapp" },
    ];
    const today = buildLeadDynamics(leads, "today", { now });
    expect(today.total).toBe(2);
    const channels = buildLeadChannelBreakdown(leads, today.fromYmd, today.toYmd);
    expect(channels.every((c) => !/broadcast|рассыл/i.test(c.label + c.raw))).toBe(true);
    expect(channels.reduce((s, c) => s + c.count, 0)).toBe(2);
  });
});
