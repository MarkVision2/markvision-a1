import { describe, it, expect } from "vitest";
import { mapMetaCreativesToReport } from "@/hooks/useReportData";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";
import {
  buildReportCreativeSections,
  parseCreativeDisplayName,
} from "@/lib/reportCreatives";

const mk = (over: Partial<MetaCreativeRow> = {}): MetaCreativeRow => ({
  id: over.id ?? "1",
  adId: over.adId ?? "ad-1",
  campaignId: over.campaignId ?? null,
  cabinetId: over.cabinetId ?? "cab-1",
  name: over.name ?? "Creative A",
  creativeType: "video",
  thumbnailUrl: over.thumbnailUrl ?? null,
  imageUrl: over.imageUrl ?? null,
  posterUrl: over.posterUrl ?? null,
  videoUrl: over.videoUrl ?? null,
  videoId: null,
  primaryText: null,
  headline: null,
  cta: null,
  destinationUrl: null,
  effectiveStatus: null,
  spend: over.spend ?? 0,
  impressions: over.impressions ?? 0,
  clicks: over.clicks ?? 0,
  leads: over.leads ?? 0,
  messages: 0,
  purchases: 0,
  revenue: 0,
  ctr: over.ctr ?? 0,
  cpl: 0,
  cpc: 0,
  cpm: 0,
  romi: 0,
  crmLeads: over.crmLeads ?? 0,
  crmQualified: 0,
  crmSales: over.crmSales ?? 0,
  crmRevenue: over.crmRevenue ?? 0,
  crmCpl: 0,
  crmCps: 0,
  crmAvgCheck: 0,
  crmRomi: 0,
  crmProfit: 0,
});

describe("mapMetaCreativesToReport", () => {
  it("сортирует по выручке CRM и берёт топ", () => {
    const rows = [
      mk({ adId: "a", name: "Low", spend: 10_000, crmRevenue: 0 }),
      mk({ adId: "b", name: "Top", spend: 5_000, crmRevenue: 10_000, leads: 2 }),
      mk({ adId: "c", name: "Mid", spend: 8_000, crmRevenue: 3_000 }),
    ];
    const out = mapMetaCreativesToReport(rows, "all", 2);
    expect(out).toHaveLength(2);
    expect(out[0].adId).toBe("b");
    expect(out[0].crmRevenue).toBe(10_000);
    expect(out[1].adId).toBe("c");
  });

  it("фильтрует по кабинету", () => {
    const rows = [
      mk({ adId: "a", cabinetId: "cab-1", spend: 1000 }),
      mk({ adId: "b", cabinetId: "cab-2", spend: 2000 }),
    ];
    const out = mapMetaCreativesToReport(rows, "cab-2");
    expect(out).toHaveLength(1);
    expect(out[0].adId).toBe("b");
  });

  it("прокидывает CRM-поля и превью", () => {
    const out = mapMetaCreativesToReport([
      mk({
        adId: "x",
        crmLeads: 3,
        crmSales: 1,
        crmRevenue: 5000,
        spend: 1000,
        thumbnailUrl: "https://example.com/t.jpg",
      }),
    ], "all");
    expect(out[0].crmLeads).toBe(3);
    expect(out[0].crmSales).toBe(1);
    expect(out[0].leads).toBe(3);
    expect(out[0].thumbnailUrl).toBe("https://example.com/t.jpg");
    expect(out[0].crmRomi).toBe(400);
  });
});

describe("reportCreatives helpers", () => {
  it("парсит техническое имя креатива", () => {
    const parsed = parseCreativeDisplayName(
      "diagnostika_kliniki_gde_teryaete_dengi | video | wa | 2405 | AI | g1",
    );
    expect(parsed.title).toBe("diagnostika kliniki gde teryaete dengi");
    expect(parsed.tags).toEqual(["Видео", "WhatsApp", "2405", "AI", "g1"]);
  });

  it("делит креативы на выручку и активные без выручки", () => {
    const creatives = mapMetaCreativesToReport([
      mk({ adId: "rev", spend: 0, crmRevenue: 5000 }),
      mk({ adId: "a", spend: 6000, leads: 3, crmRevenue: 0 }),
      mk({ adId: "b", spend: 5000, leads: 4, crmRevenue: 0 }),
      mk({ adId: "c", spend: 1000, leads: 1, crmRevenue: 0 }),
    ], "all");

    const sections = buildReportCreativeSections(creatives, 5);
    expect(sections.withRevenue.map((c) => c.adId)).toEqual(["rev"]);
    expect(sections.topActive.map((c) => c.adId)).toEqual(["a", "b", "c"]);
    expect(sections.totalWithRevenue).toBe(1);
    expect(sections.totalActive).toBe(3);
  });
});
