import { describe, it, expect } from "vitest";
import { isLeadPaid, isLeadVisit } from "@/lib/leadStageFlags";

describe("isLeadPaid — определение оплаченного лида", () => {
  it("paid=true → оплачен", () => {
    expect(isLeadPaid({ paid: true })).toBe(true);
  });

  it("paid_at установлен → оплачен (даже если paid=false)", () => {
    expect(isLeadPaid({ paid: false, paidAt: "2026-05-10T10:00:00Z" })).toBe(true);
  });

  it("stage='paid' → оплачен", () => {
    expect(isLeadPaid({ stageKey: "paid" })).toBe(true);
  });

  it("stage='оплачен' (русский) → оплачен", () => {
    expect(isLeadPaid({ stageKey: "оплачен" })).toBe(true);
  });

  it("stage='new' → не оплачен", () => {
    expect(isLeadPaid({ stageKey: "new" })).toBe(false);
  });
});

describe("isLeadVisit — лид прошёл диагностику", () => {
  it("оплаченный → автоматически диагностика", () => {
    expect(isLeadVisit({ paid: true })).toBe(true);
  });

  it("stage='scheduled' (запись на диагностику) → диагностика", () => {
    // КРИТИЧНО: раньше "scheduled" не входил в VISIT_STAGE_KEYS → orphan-лид
    // в этой стадии не считался как диагностика и фронт показывал на 1 меньше.
    expect(isLeadVisit({ stageKey: "scheduled" })).toBe(true);
  });

  it("stage='записан' (русский) → диагностика", () => {
    expect(isLeadVisit({ stageKey: "записан" })).toBe(true);
  });

  it("stage='invoice' (счёт на оплату) → диагностика", () => {
    // Stage is_diagnostic=true в БД, поэтому on_lead_stage_change_attribution
    // фиксирует +1 диагностики. Фронт должен считать так же.
    expect(isLeadVisit({ stageKey: "invoice" })).toBe(true);
  });

  it("stage='visit' → диагностика", () => {
    expect(isLeadVisit({ stageKey: "visit" })).toBe(true);
  });

  it("diagnostic_amount > 0 → диагностика (независимо от стадии)", () => {
    // Если триггер БД проставил сумму диагностики — это сильнее любой стадии.
    // Например, лид прошёл диагностику и был отказан → stage='rejected',
    // но диагностика всё равно была.
    expect(isLeadVisit({ stageKey: "rejected", diagnosticAmount: 5000 })).toBe(true);
  });

  it("stage='new' без оплаты — не диагностика", () => {
    expect(isLeadVisit({ stageKey: "new" })).toBe(false);
  });

  it("stage='in_progress' — не диагностика (ещё не записан)", () => {
    expect(isLeadVisit({ stageKey: "in_progress" })).toBe(false);
  });

  it("stage='rejected' без diagnostic_amount — не диагностика", () => {
    expect(isLeadVisit({ stageKey: "rejected" })).toBe(false);
  });
});
