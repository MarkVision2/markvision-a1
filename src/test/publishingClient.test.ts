/**
 * Чистые хелперы клиента публикаций: тон здоровья и ступени разгона
 * (зеркало publish_account_effective_limit в БД — расхождение даст не тот лимит в UI).
 */
import { describe, it, expect } from "vitest";
import { effectiveDailyLimit, healthTone, rampStage } from "@/lib/publishingClient";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

describe("healthTone", () => {
  it("делит шкалу на good / warn / bad", () => {
    expect(healthTone(100)).toBe("good");
    expect(healthTone(70)).toBe("good");
    expect(healthTone(69)).toBe("warn");
    expect(healthTone(40)).toBe("warn");
    expect(healthTone(39)).toBe("bad");
    expect(healthTone(0)).toBe("bad");
  });

  it("null/undefined считает нулём", () => {
    expect(healthTone(null)).toBe("bad");
    expect(healthTone(undefined)).toBe("bad");
  });
});

describe("rampStage", () => {
  it("<7 дней → ступень 1, лимит 1", () => {
    expect(rampStage(true, daysAgo(0), NOW)).toEqual({ stage: 1, limit: 1, daysLeft: 7 });
    expect(rampStage(true, daysAgo(6.5), NOW)).toMatchObject({ stage: 1, limit: 1, daysLeft: 1 });
  });

  it("<14 дней → ступень 2, лимит 2", () => {
    expect(rampStage(true, daysAgo(7), NOW)).toMatchObject({ stage: 2, limit: 2, daysLeft: 7 });
    expect(rampStage(true, daysAgo(13.9), NOW)).toMatchObject({ stage: 2, limit: 2, daysLeft: 1 });
  });

  it("<28 дней → ступень 3, лимит 3", () => {
    expect(rampStage(true, daysAgo(14), NOW)).toMatchObject({ stage: 3, limit: 3, daysLeft: 14 });
    expect(rampStage(true, daysAgo(27.5), NOW)).toMatchObject({ stage: 3, limit: 3, daysLeft: 1 });
  });

  it("≥28 дней → полный лимит", () => {
    expect(rampStage(true, daysAgo(28), NOW)).toEqual({ stage: 4, limit: null, daysLeft: 0 });
    expect(rampStage(true, daysAgo(400), NOW)).toEqual({ stage: 4, limit: null, daysLeft: 0 });
  });

  it("разгон выключен или дата пустая/битая → ступень 4 без лимита", () => {
    expect(rampStage(false, daysAgo(1), NOW)).toEqual({ stage: 4, limit: null, daysLeft: 0 });
    expect(rampStage(true, null, NOW)).toEqual({ stage: 4, limit: null, daysLeft: 0 });
    expect(rampStage(true, "не дата", NOW)).toEqual({ stage: 4, limit: null, daysLeft: 0 });
  });

  it("принимает Date как «сейчас»", () => {
    expect(rampStage(true, daysAgo(10), new Date(NOW)).stage).toBe(2);
  });
});

describe("effectiveDailyLimit", () => {
  it("режет daily_limit ступенью разгона", () => {
    expect(effectiveDailyLimit({ daily_limit: 10, ramp_enabled: true, ramp_started_at: daysAgo(3) }, NOW)).toBe(1);
    expect(effectiveDailyLimit({ daily_limit: 10, ramp_enabled: true, ramp_started_at: daysAgo(20) }, NOW)).toBe(3);
  });

  it("не поднимает лимит выше daily_limit", () => {
    expect(effectiveDailyLimit({ daily_limit: 1, ramp_enabled: true, ramp_started_at: daysAgo(20) }, NOW)).toBe(1);
  });

  it("без разгона — daily_limit как есть", () => {
    expect(effectiveDailyLimit({ daily_limit: 10, ramp_enabled: false, ramp_started_at: daysAgo(1) }, NOW)).toBe(10);
    expect(effectiveDailyLimit({ daily_limit: 10, ramp_enabled: true, ramp_started_at: daysAgo(40) }, NOW)).toBe(10);
  });
});
