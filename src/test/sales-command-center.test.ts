import { describe, expect, it } from "vitest";
import {
  buildSalesCommandCenter,
  type SalesCommandCenterInput,
} from "@/lib/salesCommandCenter";
import type { Lead } from "@/types/crm";

const NOW = new Date("2026-07-18T12:00:00.000Z").getTime();

function lead(patch: Partial<Lead> = {}): Lead {
  return {
    id: crypto.randomUUID(),
    name: "Клиент",
    phone: "+77000000000",
    source: "WhatsApp",
    stageId: "in_progress",
    amount: 100_000,
    aiScore: 50,
    createdAt: "2026-07-18T09:00:00.000Z",
    lastActivityAt: "2026-07-18T10:00:00.000Z",
    ...patch,
  };
}

function input(leads: Lead[]): SalesCommandCenterInput {
  return {
    leads,
    managerStats: [],
    paidPct: 0,
    rejectedPct: 0,
    avgResponseMin: 0,
    now: NOW,
  };
}

describe("buildSalesCommandCenter", () => {
  it("returns a healthy empty state without fake urgency", () => {
    const result = buildSalesCommandCenter(input([]));
    expect(result.activeLeads).toBe(0);
    expect(result.healthScore).toBe(100);
    expect(result.priorities[0]?.key).toBe("no_leads");
  });

  it("ranks overdue tasks and unanswered leads first", () => {
    const overdue = lead({
      id: "overdue",
      tasks: [{ id: "t1", title: "Перезвонить", dueAt: "2026-07-18T10:00:00.000Z" }],
      aiScore: 90,
    });
    const waiting = lead({
      id: "waiting",
      stageId: "no_answer",
      createdAt: "2026-07-18T11:20:00.000Z",
      aiScore: 70,
    });

    const result = buildSalesCommandCenter(input([waiting, overdue]));
    expect(result.overdueTasks).toBe(1);
    expect(result.urgentLeads).toBe(1);
    expect(result.priorityLeads.map((item) => item.lead.id)).toEqual(["overdue", "waiting"]);
  });

  it("calculates pipeline value and weighted forecast only for active leads", () => {
    const active = lead({ amount: 200_000, aiScore: 75 });
    const paid = lead({ stageId: "paid", paid: true, amount: 500_000, aiScore: 100 });
    const rejected = lead({ stageId: "rejected", amount: 300_000, aiScore: 80 });

    const result = buildSalesCommandCenter(input([active, paid, rejected]));
    expect(result.activeLeads).toBe(1);
    expect(result.pipelineValue).toBe(200_000);
    expect(result.weightedForecast).toBe(150_000);
  });

  it("finds today's visits and stale active deals", () => {
    const visit = lead({ nextVisitAt: "2026-07-18T15:00:00.000Z" });
    const stale = lead({
      id: "stale",
      lastActivityAt: "2026-07-14T08:00:00.000Z",
      aiScore: 60,
    });

    const result = buildSalesCommandCenter(input([visit, stale]));
    expect(result.todayVisits).toBe(1);
    expect(result.staleLeads).toBe(1);
    expect(result.priorities.some((item) => item.key === "stale_leads")).toBe(true);
  });

  it("selects the strongest manager by revenue, then conversion", () => {
    const result = buildSalesCommandCenter({
      ...input([]),
      managerStats: [
        {
          member: { id: "a", name: "Алия", role: "manager", email: "a@example.com", modules: [], projects: [], createdAt: "2026-01-01T00:00:00Z" },
          assigned: 10,
          responsesUnder5: 8,
          respondedTotal: 10,
          paid: 3,
          conversion: 30,
          revenue: 300_000,
        },
        {
          member: { id: "b", name: "Марат", role: "manager", email: "b@example.com", modules: [], projects: [], createdAt: "2026-01-01T00:00:00Z" },
          assigned: 8,
          responsesUnder5: 6,
          respondedTotal: 8,
          paid: 4,
          conversion: 50,
          revenue: 500_000,
        },
      ],
    });
    expect(result.topManager?.member.name).toBe("Марат");
  });
});
