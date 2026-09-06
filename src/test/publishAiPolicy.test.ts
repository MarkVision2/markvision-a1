/**
 * Политика AI проекта (_lib/publishAiPolicy.ts): manual держит всё, assisted —
 * сверх суточного лимита, automatic — ничего.
 */
import { describe, expect, it } from "vitest";
import { AI_POLICIES, isAiPolicy, policyDecision, utcDayStart } from "../../supabase/functions/_lib/publishAiPolicy.ts";

describe("policyDecision", () => {
  it("manual — всё на согласование, с причиной", () => {
    const d = policyDecision("manual", { incoming: 5, autoToday: 0, dailyLimit: 10 });
    expect(d).toEqual({ auto: 0, hold: 5, reason: expect.stringMatching(/ручная/) });
  });

  it("automatic — всё само, без причины", () => {
    expect(policyDecision("automatic", { incoming: 5, autoToday: 100, dailyLimit: 1 })).toEqual({ auto: 5, hold: 0, reason: null });
  });

  it("assisted — в пределах суточного лимита само, остаток ждёт", () => {
    expect(policyDecision("assisted", { incoming: 4, autoToday: 8, dailyLimit: 10 })).toEqual({
      auto: 2, hold: 2, reason: expect.stringMatching(/лимит.*\(10\)/),
    });
    expect(policyDecision("assisted", { incoming: 3, autoToday: 0, dailyLimit: 10 })).toEqual({ auto: 3, hold: 0, reason: null });
    expect(policyDecision("assisted", { incoming: 3, autoToday: 12, dailyLimit: 10 }).auto).toBe(0);
    expect(policyDecision("assisted", { incoming: 3, autoToday: 0, dailyLimit: 0 }).hold).toBe(3);
  });

  it("пустая пачка — ничего не решаем", () => {
    expect(policyDecision("manual", { incoming: 0, autoToday: 0, dailyLimit: 10 })).toEqual({ auto: 0, hold: 0, reason: null });
  });
});

describe("вспомогательное", () => {
  it("isAiPolicy знает три политики", () => {
    for (const p of AI_POLICIES) expect(isAiPolicy(p)).toBe(true);
    expect(isAiPolicy("semi")).toBe(false);
    expect(isAiPolicy(null)).toBe(false);
  });

  it("utcDayStart — полночь UTC текущих суток", () => {
    expect(utcDayStart(Date.UTC(2026, 8, 9, 23, 59))).toBe("2026-09-09T00:00:00.000Z");
  });
});
