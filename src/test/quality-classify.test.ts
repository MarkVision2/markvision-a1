import { describe, it, expect } from "vitest";
import { classifyQuality, countQuality } from "@/lib/quality";

describe("classifyQuality — канонические флаги (фикс UUID-стадии)", () => {
  it("оплачен по булеву paid, даже если stageKey пустой/UUID", () => {
    expect(classifyQuality(10, { paid: true })).toBe("paid");
    expect(classifyQuality(10, { paidAt: "2026-06-10T10:00:00Z" })).toBe("paid");
  });

  it("оплачен по ключу стадии (любой язык)", () => {
    expect(classifyQuality(0, { stageKey: "оплачено" })).toBe("paid");
    expect(classifyQuality(0, { stageKey: "completed" })).toBe("paid");
  });

  it("диагностика (diagnosticAmount>0) → горячий", () => {
    expect(classifyQuality(5, { diagnosticAmount: 10000 })).toBe("hot");
  });

  it("без флагов падает на скор", () => {
    expect(classifyQuality(80)).toBe("hot");
    expect(classifyQuality(60)).toBe("warm");
    expect(classifyQuality(10)).toBe("cold");
    expect(classifyQuality(0)).toBe("unknown");
  });

  it("UUID в stageKey НЕ ломает классификацию (раньше тут был баг дашборда)", () => {
    // LeadLite: stageId — UUID, но paid выставлен булевом → всё равно paid
    const cat = classifyQuality(20, {
      stageKey: "550e8400-e29b-41d4-a716-446655440000",
      paid: true,
    });
    expect(cat).toBe("paid");
  });

  it("countQuality считает по флагам каждого лида", () => {
    const counts = countQuality([
      { aiScore: 0, paid: true },
      { aiScore: 0, stageKey: "оплачено" },
      { aiScore: 90 },
      { aiScore: 0, diagnosticAmount: 5000 },
      { aiScore: 0 },
    ]);
    expect(counts.paid).toBe(2);
    expect(counts.hot).toBe(2); // score90 + diagnostic
    expect(counts.unknown).toBe(1);
    expect(counts.total).toBe(5);
  });
});
