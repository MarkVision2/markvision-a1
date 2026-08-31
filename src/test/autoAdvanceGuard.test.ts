import { describe, expect, it } from "vitest";
import type { LeadStage } from "@/types/crm";

/**
 * Решение менеджера важнее автоматики.
 *
 * Разбор переписки (n8n → leads_crm.auto_advance_stage) двигал лид безусловно,
 * из-за чего клиент, уже переведённый в «Отказ» или «Оплату», возвращался
 * в очередь. Правило: из терминальных этапов автоматика не вытаскивает.
 */
const TERMINAL = ["rejected", "paid"] as const;

function shouldAutoAdvance(stages: LeadStage[], currentStageKey: string, targetKey: string): boolean {
  if (currentStageKey === targetKey) return false;
  const role = stages.find((s) => s.id === currentStageKey)?.stageRole;
  return !TERMINAL.includes(role as (typeof TERMINAL)[number]);
}

const stages: LeadStage[] = [
  { id: "new", title: "Новая", color: "primary", icon: "zap", stageRole: "new" },
  { id: "in_work", title: "В работе", color: "primary", icon: "zap", stageRole: "other" },
  { id: "rejected", title: "Отказ", color: "destructive", icon: "ban", stageRole: "rejected" },
  { id: "paid", title: "Оплата", color: "success", icon: "card", stageRole: "paid" },
];

describe("автоперемещение по разбору переписки", () => {
  it("не вытаскивает клиента из «Отказа»", () => {
    expect(shouldAutoAdvance(stages, "rejected", "in_work")).toBe(false);
  });

  it("не вытаскивает клиента из «Оплаты»", () => {
    expect(shouldAutoAdvance(stages, "paid", "in_work")).toBe(false);
  });

  it("обычные этапы двигает как раньше", () => {
    expect(shouldAutoAdvance(stages, "new", "in_work")).toBe(true);
  });

  it("не двигает, если лид уже на целевом этапе", () => {
    expect(shouldAutoAdvance(stages, "in_work", "in_work")).toBe(false);
  });
});
