/**
 * Отбор аккаунтов для массовой заливки: годность (зеркало WHERE в
 * plan_publish_slots), фильтры списка и предпросмотр раскладки.
 */
import { describe, it, expect } from "vitest";
import type { PublishAccount, PublishGroup } from "@/lib/publishingClient";
import {
  ANY,
  EMPTY_FILTERS,
  accountEligibility,
  filterAccounts,
  formatStep,
  isPublishable,
  planPreview,
  todayLoad,
} from "@/lib/publishingSelection";

const base: PublishAccount = {
  id: "a1",
  platform: "instagram",
  account_name: "Клиника Айва",
  handle: "aiva",
  external_account_id: "1",
  status: "active",
  publish_enabled: true,
  daily_limit: 10,
  last_post_at: null,
  consecutive_errors: 0,
  last_error: null,
  token_expires_at: null,
  group_id: null,
  persona_id: null,
  timezone: null,
  window_start: null,
  window_end: null,
  ramp_enabled: false,
  ramp_started_at: null,
  health_score: 100,
  published_today: 0,
  published_day: null,
  token_refreshed_at: null,
  followers: null,
};

const acc = (patch: Partial<PublishAccount>): PublishAccount => ({ ...base, ...patch });

describe("accountEligibility", () => {
  it("активный включённый аккаунт со здоровьем ≥20 годен", () => {
    expect(accountEligibility(acc({ health_score: 20 }))).toEqual({ ok: true, reason: null, hint: null });
  });

  it("выключенная публикация — самая частая причина, проверяется первой", () => {
    const e = accountEligibility(acc({ publish_enabled: false, status: "error", health_score: 0 }));
    expect(e.ok).toBe(false);
    expect(e.reason).toBe("disabled");
  });

  it("не активный статус отсеивается", () => {
    expect(accountEligibility(acc({ status: "token_expired" })).reason).toBe("not_active");
  });

  it("здоровье ниже 20 отсеивается — как и в SQL", () => {
    expect(accountEligibility(acc({ health_score: 19 })).reason).toBe("low_health");
    expect(isPublishable(acc({ health_score: 19 }))).toBe(false);
    expect(isPublishable(acc({ health_score: 20 }))).toBe(true);
  });
});

describe("filterAccounts", () => {
  const list = [
    acc({ id: "ig", account_name: "Клиника Айва", handle: "aiva", platform: "instagram", group_id: "g1" }),
    acc({ id: "tt", account_name: "Автосалон", handle: "lexus_pvl", platform: "tiktok" }),
    acc({ id: "off", account_name: "Старый", handle: "old", platform: "instagram", publish_enabled: false }),
  ];

  it("пустые фильтры возвращают всё", () => {
    expect(filterAccounts(list, EMPTY_FILTERS)).toHaveLength(3);
  });

  it("поиск идёт по имени и хэндлу, ведущая @ игнорируется", () => {
    expect(filterAccounts(list, { ...EMPTY_FILTERS, search: "айва" }).map((a) => a.id)).toEqual(["ig"]);
    expect(filterAccounts(list, { ...EMPTY_FILTERS, search: "@lexus" }).map((a) => a.id)).toEqual(["tt"]);
  });

  it("фильтрует по площадке и по группе", () => {
    expect(filterAccounts(list, { ...EMPTY_FILTERS, platform: "tiktok" }).map((a) => a.id)).toEqual(["tt"]);
    expect(filterAccounts(list, { ...EMPTY_FILTERS, groupId: "g1" }).map((a) => a.id)).toEqual(["ig"]);
    expect(filterAccounts(list, { ...EMPTY_FILTERS, groupId: "__none" }).map((a) => a.id)).toEqual(["tt", "off"]);
    expect(filterAccounts(list, { ...EMPTY_FILTERS, groupId: ANY })).toHaveLength(3);
  });

  it("«только готовые» прячет то, что планировщик не возьмёт", () => {
    expect(filterAccounts(list, { ...EMPTY_FILTERS, onlyPublishable: true }).map((a) => a.id)).toEqual(["ig", "tt"]);
  });
});

describe("planPreview", () => {
  const start = new Date("2026-09-06T10:00:00Z");
  const group: PublishGroup = {
    id: "g1", name: "Сеть A", platform: null, account_ids: [], publish_strategy: "drip",
    per_hour: 4, persona_id: null, review_mode: "auto_publish", timezone: null,
    window_start: null, window_end: null, min_gap_minutes: null, jitter_minutes: null,
    auto_publish_after: null, approved_streak: 0,
  };

  const selected = [
    acc({ id: "a", platform: "instagram" }),
    acc({ id: "b", platform: "instagram" }),
    acc({ id: "c", platform: "tiktok" }),
    acc({ id: "bad", platform: "tiktok", status: "error" }),
  ];

  it("делит выбор на годные и пропущенные с причиной", () => {
    const p = planPreview(selected, "drip", null, start);
    expect(p.eligible.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0].account.id).toBe("bad");
    expect(p.skipped[0].hint).toMatch(/Активен/);
  });

  it("считает разбивку по площадкам", () => {
    expect(planPreview(selected, "drip", null, start).byPlatform).toEqual([
      { platform: "instagram", count: 2 },
      { platform: "tiktok", count: 1 },
    ]);
  });

  it("«сейчас» — нулевой шаг, все слоты в момент старта", () => {
    const p = planPreview(selected, "now", null, start);
    expect(p.stepMinutes).toBe(0);
    expect(p.lastSlotAt?.toISOString()).toBe(start.toISOString());
  });

  it("drip без группы берёт 10/час → шаг 6 минут (coalesce(g.per_hour, 10) в SQL)", () => {
    const p = planPreview(selected, "drip", null, start);
    expect(p.stepMinutes).toBe(6);
    // 3 годных аккаунта → последний через 2 шага = 12 минут.
    expect(p.lastSlotAt?.toISOString()).toBe("2026-09-06T10:12:00.000Z");
  });

  it("drip с группой берёт её темп: 4/час → шаг 15 минут", () => {
    expect(planPreview(selected, "drip", group, start).stepMinutes).toBe(15);
  });

  it("«по одному в день» разносит аккаунты на сутки", () => {
    const p = planPreview(selected, "daily", null, start);
    expect(p.stepMinutes).toBe(1440);
    expect(p.lastSlotAt?.toISOString()).toBe("2026-09-08T10:00:00.000Z");
  });

  it("пустой выбор не даёт последнего слота", () => {
    expect(planPreview([], "drip", null, start).lastSlotAt).toBeNull();
  });
});

describe("formatStep", () => {
  it("подписывает шаг человеческим языком", () => {
    expect(formatStep(0)).toBe("одновременно");
    expect(formatStep(6)).toBe("6 мин");
    expect(formatStep(90)).toBe("1 ч 30 мин");
    expect(formatStep(120)).toBe("2 ч");
    expect(formatStep(1440)).toBe("1 дн.");
  });
});

describe("todayLoad", () => {
  /** Сегодняшняя дата в поясе аккаунта — так её пишет триггер в published_day. */
  const today = (tz = "Asia/Almaty") =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  it("учитывает ступень разгона, а не сырой daily_limit", () => {
    const ramping = acc({ daily_limit: 10, ramp_enabled: true, ramp_started_at: new Date().toISOString(), published_today: 1, published_day: today() });
    expect(todayLoad(ramping)).toEqual({ used: 1, limit: 1, full: true });
  });

  it("без разгона показывает полный лимит", () => {
    expect(todayLoad(acc({ daily_limit: 5, published_today: 2, published_day: today() }))).toEqual({ used: 2, limit: 5, full: false });
  });

  it("вчерашний счётчик — это ноль сегодня, как в claim_publish_jobs", () => {
    // Триггер в базе не обнуляет published_today в полночь: он переписывает его
    // при первой публикации нового дня. Интерфейс показывал вчерашнее «3 / 3»
    // и врал, что лимит выбран, пока планировщик спокойно брал задания.
    const stale = acc({ daily_limit: 3, published_today: 3, published_day: "2020-01-01" });
    expect(todayLoad(stale)).toEqual({ used: 0, limit: 3, full: false });
  });

  it("день считается по часовому поясу аккаунта", () => {
    const tokyo = acc({ daily_limit: 3, published_today: 2, published_day: today("Asia/Tokyo"), timezone: "Asia/Tokyo" });
    expect(todayLoad(tokyo).used).toBe(2);
  });
});
