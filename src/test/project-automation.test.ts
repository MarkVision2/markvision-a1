import { describe, expect, it } from "vitest";
import { defaultStageAutomationRules, findStageAutomationRule } from "@/lib/stageAutomations";
import type { LeadStage } from "@/types/crm";

const stagesA: LeadStage[] = [
  { id: "stage-a-new", title: "Новая", color: "primary", icon: "zap", stageRole: "new" },
  { id: "stage-a-paid", title: "Оплачен", color: "success", icon: "check", stageRole: "paid" },
];

const stagesB: LeadStage[] = [
  { id: "stage-b-new", title: "Новая", color: "primary", icon: "zap", stageRole: "new" },
];

describe("project-scoped stage automations", () => {
  it("default rules are per pipeline stages, not shared between projects", () => {
    const rulesA = defaultStageAutomationRules(stagesA);
    const rulesB = defaultStageAutomationRules(stagesB);

    expect(rulesA.some((r) => r.stageId === "stage-a-new")).toBe(true);
    expect(rulesA.some((r) => r.stageId === "stage-b-new")).toBe(false);
    expect(rulesB.some((r) => r.stageId === "stage-b-new")).toBe(true);
    expect(findStageAutomationRule(rulesA, "stage-b-new")).toBeUndefined();
  });
});
