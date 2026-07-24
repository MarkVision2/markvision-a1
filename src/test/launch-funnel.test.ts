import { describe, expect, it } from "vitest";
import {
  AUTOMATION_EVENT_TO_ROLE,
  canAutoAdvance,
  requiresDiagnosticDialog,
  requiresPaymentDialog,
  requiresRejectDialog,
  stageRoleOf,
  STAGE_ROLE_ORDER,
} from "@/lib/stageRoles";
import {
  buildLaunchConversionFunnel,
  buildLaunchFunnel,
  buildLaunchKpis,
  launchDepthReached,
  LAUNCH_CONVERSION_STEPS,
} from "@/lib/launchFunnel";
import type { LeadLite } from "@/hooks/useLeadsLite";

function lead(partial: Partial<LeadLite> & { stageKey: string }): LeadLite {
  return {
    id: partial.id ?? "1",
    projectId: null,
    source: "site",
    channel: "web",
    referrer: null,
    landingUrl: null,
    utm: null,
    metaAdId: null,
    cabinetId: null,
    stageKey: partial.stageKey,
    stageRole: partial.stageRole ?? null,
    amount: partial.amount ?? 0,
    diagnosticAmount: 0,
    createdAt: "2026-07-19T00:00:00Z",
    paidAt: partial.paidAt ?? null,
    lastActivityAt: "2026-07-19T00:00:00Z",
    firstResponseAt: null,
    assigneeId: null,
    paid: partial.paid ?? false,
    aiScore: 0,
    scoreLabel: null,
    rejectReason: null,
    rejectedAt: null,
    stageId: null,
    nextVisitAt: null,
    paymentMethod: null,
    tags: partial.tags ?? [],
    temperature: partial.temperature ?? null,
    webinarStatus: partial.webinarStatus ?? null,
    depositAmount: partial.depositAmount ?? null,
  };
}

describe("stageRoles", () => {
  it("maps automation events to roles", () => {
    expect(AUTOMATION_EVENT_TO_ROLE.whatsapp_messaged).toBe("bot_activated");
    expect(AUTOMATION_EVENT_TO_ROLE.interest_detected).toBe("call_scheduled");
    expect(AUTOMATION_EVENT_TO_ROLE.deposit_received).toBe("deposit");
    expect(AUTOMATION_EVENT_TO_ROLE.student_created).toBe("student");
  });

  it("resolves role from stage key fallback", () => {
    expect(stageRoleOf({ id: "paid" })).toBe("paid");
    expect(stageRoleOf({ id: "visit" })).toBe("attended");
    expect(stageRoleOf({ id: "invoice" })).toBe("offer");
    expect(stageRoleOf({ stageRole: "deposit", id: "x" })).toBe("deposit");
  });

  it("gates dialogs by role and template", () => {
    expect(requiresPaymentDialog("paid")).toBe(true);
    expect(requiresRejectDialog("rejected")).toBe(true);
    expect(requiresDiagnosticDialog("call_scheduled", { isDiagnostic: true, templateKey: "clinic" })).toBe(true);
    expect(requiresDiagnosticDialog("call_scheduled", { isDiagnostic: true, templateKey: "launch" })).toBe(false);
  });

  it("allows only forward auto-advances", () => {
    expect(canAutoAdvance("new", "bot_activated")).toBe(true);
    expect(canAutoAdvance("call_scheduled", "bot_activated")).toBe(false);
    expect(canAutoAdvance("paid", "call_scheduled")).toBe(false);
    expect(canAutoAdvance("call_scheduled", "rejected")).toBe(true);
  });
});

describe("launchFunnel", () => {
  it("builds depth and conversions", () => {
    const leads = [
      lead({ stageKey: "new" }),
      lead({ stageKey: "whatsapp" }),
      lead({ stageKey: "confirmed" }),
      lead({ stageKey: "visit", webinarStatus: "attended" }),
      lead({ stageKey: "interest", temperature: "hot" }),
      lead({ stageKey: "deposit", depositAmount: 10000 }),
      lead({ stageKey: "paid", paid: true, amount: 250000 }),
      lead({ stageKey: "student", paid: true, amount: 250000 }),
    ];
    expect(launchDepthReached(leads[0])).toBe(STAGE_ROLE_ORDER.new);
    expect(launchDepthReached(leads[5])).toBe(STAGE_ROLE_ORDER.deposit);
    const funnel = buildLaunchFunnel(leads);
    expect(funnel[0].leads).toBe(8);
    expect(funnel.find((r) => r.role === "paid")?.leads).toBe(2);
    expect(funnel.find((r) => r.role === "student")?.leads).toBe(1);
    const kpis = buildLaunchKpis(leads);
    expect(kpis.hot).toBe(1);
    expect(kpis.deposits).toBeGreaterThanOrEqual(1);
    expect(kpis.revenue).toBe(500000);
    expect(kpis.e2eConversion).toBeCloseTo(25, 5);
  });

  it("counts webinarStatus even when stage not moved", () => {
    const depth = launchDepthReached(lead({
      stageKey: "confirmed",
      webinarStatus: "attended",
    }));
    expect(depth).toBeGreaterThanOrEqual(STAGE_ROLE_ORDER.attended);
  });

  it("builds 7-step conversion funnel with step rates", () => {
    expect(LAUNCH_CONVERSION_STEPS).toHaveLength(7);
    const leads = [
      lead({ stageKey: "new" }),
      lead({ stageKey: "bot_activated" }),
      lead({ stageKey: "joined_group" }),
      lead({ stageKey: "confirmed" }),
      lead({ stageKey: "attended", webinarStatus: "attended" }),
      lead({ stageKey: "deposit", depositAmount: 10000 }),
      lead({ stageKey: "paid", paid: true, amount: 199000 }),
    ];
    const rows = buildLaunchConversionFunnel(leads);
    expect(rows.map((r) => r.role)).toEqual([
      "new",
      "bot_activated",
      "joined_group",
      "confirmed",
      "attended",
      "deposit",
      "paid",
    ]);
    expect(rows[0].leads).toBe(7);
    expect(rows[rows.length - 1].leads).toBe(1);
    expect(rows[1].conversionFromPrev).toBeCloseTo((6 / 7) * 100, 5);
    expect(rows[rows.length - 1].conversionFromTop).toBeCloseTo((1 / 7) * 100, 5);
  });

  it("walks chain new → bot → confirmed → attended → deposit → paid → student", () => {
    const chain = ["new", "bot_activated", "confirmed", "visit", "deposit", "paid", "student"];
    let prev = 0;
    for (const key of chain) {
      const depth = launchDepthReached(lead({
        stageKey: key,
        paid: key === "paid" || key === "student",
        depositAmount: key === "deposit" || key === "paid" || key === "student" ? 10000 : null,
        webinarStatus: key === "visit" || key === "deposit" || key === "paid" || key === "student"
          ? "attended"
          : null,
      }));
      expect(depth).toBeGreaterThanOrEqual(prev);
      prev = depth;
    }
  });
});
