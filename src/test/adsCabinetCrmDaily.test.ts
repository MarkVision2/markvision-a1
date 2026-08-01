import { describe, expect, it } from "vitest";
import {
  buildAdsCabinetCrmDaily,
  isGroupJoinStageKey,
  sumAdsCabinetCrmDaily,
} from "@/lib/adsCabinetCrmDaily";
import type { LeadLite } from "@/hooks/useLeadsLite";
import type { StageChangeEvent } from "@/hooks/useStageChangeEvents";

function lead(partial: Partial<LeadLite> & Pick<LeadLite, "id" | "cabinetId" | "createdAt">): LeadLite {
  return {
    projectId: "p1",
    source: "meta",
    channel: "instagram",
    referrer: null,
    utm: null,
    metaAdId: null,
    stageKey: "new",
    stageRole: "new",
    amount: 0,
    diagnosticAmount: 0,
    paidAt: null,
    lastActivityAt: partial.createdAt,
    firstResponseAt: null,
    assigneeId: null,
    paid: false,
    aiScore: 0,
    scoreLabel: null,
    rejectReason: null,
    rejectedAt: null,
    stageId: null,
    nextVisitAt: null,
    paymentMethod: null,
    ...partial,
  };
}

describe("adsCabinetCrmDaily", () => {
  it("detects joined_group / warming as group join", () => {
    expect(isGroupJoinStageKey("joined_group")).toBe(true);
    expect(isGroupJoinStageKey("warming")).toBe(true);
    expect(isGroupJoinStageKey("new")).toBe(false);
    expect(isGroupJoinStageKey("paid")).toBe(false);
  });

  it("counts CRM leads by created_at and joins by stage event day", () => {
    const leads = [
      lead({ id: "a", cabinetId: "cab1", createdAt: "2026-07-10T05:00:00+05:00" }),
      lead({ id: "b", cabinetId: "cab1", createdAt: "2026-07-10T20:00:00+05:00" }),
      lead({ id: "c", cabinetId: "cab2", createdAt: "2026-07-10T12:00:00+05:00" }),
      lead({ id: "d", cabinetId: "cab1", createdAt: "2026-07-11T12:00:00+05:00" }),
    ];
    const events: StageChangeEvent[] = [
      { leadId: "a", cabinetId: "cab1", at: "2026-07-10T18:00:00+05:00", toStageKey: "joined_group", isDiagnostic: false },
      { leadId: "a", cabinetId: "cab1", at: "2026-07-10T19:00:00+05:00", toStageKey: "joined_group", isDiagnostic: false },
      { leadId: "b", cabinetId: "cab1", at: "2026-07-11T09:00:00+05:00", toStageKey: "warming", isDiagnostic: false },
      { leadId: "c", cabinetId: "cab2", at: "2026-07-10T15:00:00+05:00", toStageKey: "joined_group", isDiagnostic: false },
    ];

    const byDay = buildAdsCabinetCrmDaily(leads, events, "cab1", "2026-07-01", "2026-07-31");
    expect(byDay.get("2026-07-10")).toEqual({ crmLeads: 2, joins: 1 });
    expect(byDay.get("2026-07-11")).toEqual({ crmLeads: 1, joins: 1 });
    expect(sumAdsCabinetCrmDaily(byDay)).toEqual({ crmLeads: 3, joins: 2 });
  });

  it("sole Meta cabinet counts unattributed zapoinovai/meta utm leads", () => {
    const leads = [
      lead({
        id: "z1",
        cabinetId: null,
        createdAt: "2026-08-01T05:00:00+05:00",
        source: "zapoinovai",
        utm: { source: "meta" },
      }),
      lead({
        id: "z2",
        cabinetId: null,
        createdAt: "2026-08-01T06:00:00+05:00",
        source: "broadcast_zoom",
        utm: { source: "meta" },
      }),
      lead({
        id: "z3",
        cabinetId: "cab1",
        createdAt: "2026-08-01T07:00:00+05:00",
      }),
    ];
    const byDay = buildAdsCabinetCrmDaily(leads, [], "cab1", "2026-08-01", "2026-08-31", {
      soleMetaCabinet: true,
    });
    expect(sumAdsCabinetCrmDaily(byDay)).toEqual({ crmLeads: 2, joins: 0 });
  });
});
