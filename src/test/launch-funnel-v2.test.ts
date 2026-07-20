import { describe, expect, it } from "vitest";
import { buildLeadJourney, webinarLeadUrl } from "@/lib/leadJourney";
import { STAGE_ROLE_ORDER, canAutoAdvance, stageRoleOf } from "@/lib/stageRoles";
import { LAUNCH_FUNNEL_STEPS, buildLaunchFunnel } from "@/lib/launchFunnel";
import { REJECT_REASONS } from "@/types/crm";

describe("launch funnel v2", () => {
  it("orders deposit before call", () => {
    expect(STAGE_ROLE_ORDER.deposit).toBeLessThan(STAGE_ROLE_ORDER.call_scheduled);
    expect(STAGE_ROLE_ORDER.attended).toBeLessThan(STAGE_ROLE_ORDER.deposit);
    expect(STAGE_ROLE_ORDER.student).toBeLessThan(STAGE_ROLE_ORDER.graduate);
  });

  it("maps legacy roles", () => {
    expect(stageRoleOf({ stageRole: "whatsapp" })).toBe("bot_activated");
    expect(stageRoleOf({ stageRole: "warming" })).toBe("joined_group");
    expect(stageRoleOf({ id: "visit" })).toBe("attended");
  });

  it("builds journey progress", () => {
    const j = buildLeadJourney({
      stageId: "deposit",
      depositAmount: 10000,
      webinarStatus: "attended",
    });
    expect(j.progressPct).toBeGreaterThan(30);
    expect(j.steps.find((s) => s.key === "deposit")?.done).toBe(true);
    expect(j.steps.find((s) => s.key === "paid")?.done).toBe(false);
  });

  it("lists 12 funnel steps + reject reasons from TZ", () => {
    expect(LAUNCH_FUNNEL_STEPS).toHaveLength(12);
    expect(REJECT_REASONS.map((r) => r.id)).toEqual([
      "expensive",
      "no_time",
      "thinking",
      "no_value",
      "no_authority",
      "competitor",
      "no_contact",
      "other",
    ]);
  });

  it("webinar url embeds lead id", () => {
    expect(webinarLeadUrl("https://missioncontrol.kz/live", "abc-1")).toContain("lead=abc-1");
  });

  it("buildLaunchFunnel counts depth", () => {
    const rows = buildLaunchFunnel([
      { id: "1", stageKey: "new", amount: 0, paid: false },
      { id: "2", stageKey: "deposit", amount: 0, paid: false, depositAmount: 10000 },
    ] as never);
    expect(rows[0].leads).toBe(2);
    expect(rows.find((r) => r.role === "deposit")?.leads).toBe(1);
  });

  it("can advance to graduate from student", () => {
    expect(canAutoAdvance("student", "graduate")).toBe(true);
    expect(canAutoAdvance("graduate", "paid")).toBe(false);
  });
});
