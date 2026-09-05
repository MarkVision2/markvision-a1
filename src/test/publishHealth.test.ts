/**
 * Формула здоровья аккаунта: детерминированная, объясняет себя причинами и
 * гарантирует, что мёртвый токен опускает аккаунт ниже порога планировщика.
 */
import { describe, it, expect } from "vitest";
import { MIN_PUBLISHABLE, computeHealth, type HealthInput } from "../../supabase/functions/_lib/publishHealth.ts";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

const healthy: HealthInput = {
  status: "active", tokenAlive: true, tokenExpiresAt: at(50), lastCheckedAt: at(-0.1),
  consecutiveErrors: 0, failed30d: 0, published30d: 12, now: NOW,
};

describe("computeHealth", () => {
  it("здоровый аккаунт — 100 и одна поясняющая причина", () => {
    const r = computeHealth(healthy);
    expect(r.score).toBe(100);
    expect(r.reasons).toEqual(["токен живой, отказов нет, проверка свежая"]);
  });

  it("мёртвый токен — ниже порога планировщика, что бы ни было остальное", () => {
    const r = computeHealth({ ...healthy, tokenAlive: false });
    expect(r.score).toBeLessThan(MIN_PUBLISHABLE);
    expect(r.reasons[0]).toMatch(/переподключите/);
    expect(computeHealth({ ...healthy, status: "token_expired" }).score).toBeLessThan(MIN_PUBLISHABLE);
  });

  it("выключенный вручную — 0", () => {
    expect(computeHealth({ ...healthy, status: "disabled" })).toEqual({ score: 0, reasons: ["аккаунт выключен вручную"] });
  });

  it("статусы error / limited дают потолок", () => {
    expect(computeHealth({ ...healthy, status: "error" }).score).toBe(35);
    expect(computeHealth({ ...healthy, status: "limited" }).score).toBe(55);
  });

  it("истекающий токен снимает баллы и называет срок", () => {
    const week = computeHealth({ ...healthy, tokenExpiresAt: at(5) });
    expect(week.score).toBe(85);
    expect(week.reasons[0]).toMatch(/истекает через 5 дн/);
    const soon = computeHealth({ ...healthy, tokenExpiresAt: at(1) });
    expect(soon.score).toBe(65);
    expect(soon.reasons[0]).toMatch(/истекает через 24 ч/);
    expect(computeHealth({ ...healthy, tokenExpiresAt: at(-1) }).score).toBeLessThan(MIN_PUBLISHABLE);
  });

  it("отказы подряд: −10 за каждый, не больше −40, с русским склонением", () => {
    expect(computeHealth({ ...healthy, consecutiveErrors: 1 })).toMatchObject({ score: 90, reasons: ["1 отказ подряд"] });
    expect(computeHealth({ ...healthy, consecutiveErrors: 3 })).toMatchObject({ score: 70, reasons: ["3 отказа подряд"] });
    expect(computeHealth({ ...healthy, consecutiveErrors: 9 }).score).toBe(60);
  });

  it("доля ошибок за 30 дней считается только от 3 исходов", () => {
    expect(computeHealth({ ...healthy, failed30d: 1, published30d: 1 }).score).toBe(100); // мало данных
    expect(computeHealth({ ...healthy, failed30d: 1, published30d: 3 }).score).toBe(85);  // 25 %
    expect(computeHealth({ ...healthy, failed30d: 3, published30d: 2 }).score).toBe(70);  // 60 %
  });

  it("непроверенный или давно проверенный аккаунт теряет 10", () => {
    const never = computeHealth({ ...healthy, lastCheckedAt: null });
    expect(never.score).toBe(90);
    expect(never.reasons[0]).toMatch(/ни разу не проверялся/);
    const stale = computeHealth({ ...healthy, lastCheckedAt: at(-5) });
    expect(stale.score).toBe(90);
    expect(stale.reasons[0]).toMatch(/5 дн\. назад/);
  });

  it("штрафы складываются, но не уходят ниже нуля", () => {
    const r = computeHealth({ ...healthy, consecutiveErrors: 4, failed30d: 5, published30d: 1, lastCheckedAt: null, tokenExpiresAt: at(1) });
    expect(r.score).toBe(0);
    expect(r.reasons.length).toBe(4);
  });
});

describe("короткие токены площадок", () => {
  const base: HealthInput = {
    status: "active", tokenAlive: true, lastCheckedAt: new Date().toISOString(),
    consecutiveErrors: 0, failed30d: 0, published30d: 0,
    tokenExpiresAt: new Date(Date.now() + 20 * 3_600_000).toISOString(), // через 20 ч
  };

  it("TikTok с 24-часовым токеном не штрафуется за срок — монитор продлит сам", () => {
    const h = computeHealth({ ...base, platform: "tiktok" });
    expect(h.score).toBe(100);
    expect(h.reasons.join(" ")).not.toMatch(/истекает/);
  });

  it("YouTube с часовым токеном — тоже", () => {
    expect(computeHealth({ ...base, platform: "youtube", tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }).score).toBe(100);
  });

  it("Instagram/Threads со скорым сроком — штраф остаётся: там истечение значит, что продление не удалось", () => {
    const h = computeHealth({ ...base, platform: "instagram" });
    expect(h.score).toBe(65);
    expect(h.reasons.join(" ")).toMatch(/истекает через \d+ ч/);
  });

  it("но провал обновления короткого токена по-прежнему валит здоровье", () => {
    expect(computeHealth({ ...base, platform: "tiktok", status: "token_expired" }).score).toBeLessThan(MIN_PUBLISHABLE);
  });
});
