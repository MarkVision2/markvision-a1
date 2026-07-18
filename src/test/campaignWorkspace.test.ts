import { describe, expect, it } from "vitest";
import { classifyGoal } from "@/hooks/useMetaStructure";
import {
  buildCampaignWorkspaceSummary,
  filterCampaignRows,
  launchStatusLabel,
  type CampaignLaunchRow,
} from "@/lib/campaignWorkspace";
import type { MetaCampaignRow } from "@/hooks/useMetaStructure";

function campaign(partial: Partial<MetaCampaignRow> & Pick<MetaCampaignRow, "id" | "campaignId" | "name">): MetaCampaignRow {
  return {
    cabinetId: null,
    objective: null,
    destinationType: null,
    effectiveStatus: "ACTIVE",
    dailyBudget: null,
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    messages: 0,
    purchases: 0,
    revenue: 0,
    ctr: 0,
    cpl: 0,
    romi: 0,
    crmLeads: 0,
    crmQualified: 0,
    crmSales: 0,
    crmRevenue: 0,
    crmRomi: 0,
    crmProfit: 0,
    crmAvgCheck: 0,
    crmCps: 0,
    ...partial,
  };
}

describe("classifyGoal", () => {
  it("maps WhatsApp destination to WhatsApp goal", () => {
    expect(classifyGoal("OUTCOME_ENGAGEMENT", "WHATSAPP").key).toBe("whatsapp");
  });

  it("maps website leads to pixel goal", () => {
    expect(classifyGoal("OUTCOME_LEADS", "WEBSITE").key).toBe("leads_pixel");
  });

  it("maps Meta forms separately from website leads", () => {
    expect(classifyGoal("OUTCOME_LEADS", "ON_AD").key).toBe("leads_form");
  });
});

describe("campaign workspace helpers", () => {
  const rows = [
    campaign({
      id: "1",
      campaignId: "c1",
      name: "WA active",
      objective: "OUTCOME_ENGAGEMENT",
      destinationType: "WHATSAPP",
      spend: 100_000,
      messages: 20,
      crmRevenue: 250_000,
      crmSales: 2,
      crmRomi: 150,
      crmProfit: 150_000,
    }),
    campaign({
      id: "2",
      campaignId: "c2",
      name: "Site paused",
      objective: "OUTCOME_LEADS",
      destinationType: "WEBSITE",
      effectiveStatus: "PAUSED",
      spend: 50_000,
      leads: 10,
    }),
  ];

  it("builds an owner-friendly summary with CRM profit", () => {
    const summary = buildCampaignWorkspaceSummary(rows);
    expect(summary.totalCampaigns).toBe(2);
    expect(summary.activeCampaigns).toBe(1);
    expect(summary.spend).toBe(150_000);
    expect(summary.crmRevenue).toBe(250_000);
    expect(summary.crmProfit).toBe(100_000);
    expect(summary.goalCount).toBe(2);
  });

  it("filters by status and search", () => {
    expect(filterCampaignRows(rows, { status: "active", query: "" })).toHaveLength(1);
    expect(filterCampaignRows(rows, { status: "all", query: "site" })).toHaveLength(1);
    expect(filterCampaignRows(rows, { status: "all", query: "missing" })).toHaveLength(0);
  });

  it("explains launch statuses in plain Russian", () => {
    const launch: CampaignLaunchRow = {
      id: "l1",
      goal: "whatsapp",
      status: "running",
      statusStep: "creating_adset",
      statusMessage: null,
      lastError: null,
      metaCampaignId: null,
      budget: "30",
      text: "Тест",
      createdAt: "2026-07-18T00:00:00Z",
      cabinetId: "cab",
    };
    expect(launchStatusLabel(launch)).toMatch(/запускается|создаётся|идёт/i);
  });
});
