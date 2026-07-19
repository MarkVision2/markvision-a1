import { describe, expect, it } from "vitest";
import {
  AUTOMATION_EVENT_TO_ROLE,
  canAutoAdvance,
  requiresDiagnosticDialog,
  requiresPaymentDialog,
  requiresRejectDialog,
  stageRoleOf,
} from "@/lib/stageRoles";
import { buildLaunchFunnel, buildLaunchKpis, launchDepthReached } from "@/lib/launchFunnel";
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
    expect(AUTOMATION_EVENT_TO_ROLE.whatsapp_messaged).toBe("whatsapp");
    expect(AUTOMATION_EVENT_TO_ROLE.interest_detected).toBe("interest");
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
    expect(canAutoAdvance("new", "whatsapp")).toBe(true);
    expect(canAutoAdvance("interest", "whatsapp")).toBe(false);
    expect(canAutoAdvance("paid", "interest")).toBe(false);
    expect(canAutoAdvance("interest", "rejected")).toBe(true);
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
    expect(launchDepthReached(leads[0])).toBe(1);
    expect(launchDepthReached(leads[5])).toBeGreaterThanOrEqual(10);
    const funnel = buildLaunchFunnel(leads);
    expect(funnel[0].leads).toBe(8);
    expect(funnel.find((r) => r.role === "paid")?.leads).toBe(2);
    expect(funnel.find((r) => r.role === "student")?.leads).toBe(1);
    const kpis = buildLaunchKpis(leads);
    expect(kpis.hot).toBe(1);
    expect(kpis.deposits).toBeGreaterThanOrEqual(1);
    expect(kpis.revenue).toBe(500000);
  });

  it("walks chain new → whatsapp → confirmed → attended → interest → deposit → paid → student", () => {
    const chain = ["new", "whatsapp", "confirmed", "visit", "interest", "deposit", "paid", "student"];
    let prev = 0;
    for (const key of chain) {
      const depth = launchDepthReached(lead({
        stageKey: key,
        paid: key === "paid" || key === "student",
        depositAmount: key === "deposit" ? 10000 : null,
      }));
      expect(depth).toBeGreaterThanOrEqual(prev);
      prev = depth;
    }
  });
});
