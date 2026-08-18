import { describe, expect, it } from "vitest";
import {
  defaultStageAutomationRules,
  findStageAutomationRule,
  renderStageAutomationTemplate,
} from "@/lib/stageAutomations";
import type { Lead, LeadStage } from "@/types/crm";

const stages: LeadStage[] = [
  { id: "new", title: "Новая", color: "primary", icon: "zap", stageRole: "new" },
  { id: "no_answer", title: "Без ответа", color: "warning", icon: "bell" },
  { id: "scheduled", title: "Диагностика", color: "primary", icon: "calendar", stageRole: "call_scheduled" },
  { id: "paid", title: "Оплачен", color: "success", icon: "check", stageRole: "paid" },
];

const lead: Lead = {
  id: "lead-1",
  name: "Айдана",
  phone: "+7 777 000 00 00",
  source: "Инстаграм",
  stageId: "scheduled",
  amount: 0,
  aiScore: 80,
  createdAt: "2026-08-18T08:00:00.000Z",
  lastActivityAt: "2026-08-18T08:00:00.000Z",
  nextVisitAt: "2026-08-19T10:30:00.000Z",
};

describe("stageAutomations", () => {
  it("creates default rules only for message automation stages", () => {
    const rules = defaultStageAutomationRules(stages);

    expect(rules.map((rule) => rule.stageId)).toEqual(["new", "no_answer", "scheduled"]);
    expect(findStageAutomationRule(rules, "paid")).toBeUndefined();
  });

  it("renders editable templates with lead, stage and visit variables", () => {
    const text = renderStageAutomationTemplate(
      "{name} / {stage} / {manager} / {visit_datetime} / {source}",
      {
        lead,
        stage: stages[2],
        managerName: "Адал есеп",
      },
    );

    expect(text).toContain("Айдана");
    expect(text).toContain("Диагностика");
    expect(text).toContain("Адал есеп");
    expect(text).toContain("Инстаграм");
    expect(text).toContain("19.08.2026");
  });
});
