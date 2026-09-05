/**
 * Композер «Залить видео»: предпросмотр раскладки повторяет фильтры
 * plan_publish_slots (состав и площадка группы, паузы), время старта
 * трактуется как Алматы независимо от пояса браузера, действия по заданию
 * учитывают зависшую аренду воркера.
 */
import { describe, it, expect } from "vitest";
import {
  accountEligibility,
  almatyLocalNow,
  almatyLocalToIso,
  isGroupMember,
  planPreview,
} from "@/lib/publishingSelection";
import { jobActions, type PublishAccount, type PublishGroup } from "@/lib/publishingClient";

const acc = (p: Partial<PublishAccount>): PublishAccount => ({
  id: "a1", platform: "instagram", account_name: "A", handle: "a", external_account_id: "1",
  status: "active", publish_enabled: true, daily_limit: 5, last_post_at: null, consecutive_errors: 0, last_error: null,
  token_expires_at: null, group_id: null, persona_id: null, timezone: null, window_start: null, window_end: null,
  ramp_enabled: false, ramp_started_at: null, health_score: 90, published_today: 0, published_day: null,
  token_refreshed_at: null, followers: null,
  ...p,
});
const group = (p: Partial<PublishGroup>): PublishGroup => ({
  id: "g1", name: "Клиники", platform: null, account_ids: [], publish_strategy: "drip", per_hour: 10,
  persona_id: null, review_mode: "review_required", timezone: null, window_start: null, window_end: null,
  min_gap_minutes: null, jitter_minutes: null, auto_publish_after: null, approved_streak: 0,
  ...p,
});

describe("предпросмотр раскладки под группу", () => {
  const g = group({ platform: "instagram", account_ids: ["a2"] });
  const inByColumn = acc({ id: "a1", group_id: "g1" });
  const inByList = acc({ id: "a2" });
  const outsider = acc({ id: "a3", account_name: "Чужой" });
  const wrongPlatform = acc({ id: "a4", account_name: "TikTok", platform: "tiktok", group_id: "g1" });

  it("членство группы — объединение group_id и account_ids, как в SQL", () => {
    expect(isGroupMember(inByColumn, g)).toBe(true);
    expect(isGroupMember(inByList, g)).toBe(true);
    expect(isGroupMember(outsider, g)).toBe(false);
  });

  it("не члены и чужая площадка попадают в пропущенные с причиной", () => {
    const p = planPreview([inByColumn, inByList, outsider, wrongPlatform], "drip", g);
    expect(p.eligible.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(p.skipped.map((s) => s.account.id)).toEqual(["a3", "a4"]);
    expect(p.skipped[0].hint).toMatch(/не входит в выбранную группу/);
    expect(p.skipped[1].hint).toMatch(/площадка не совпадает/);
  });

  it("пауза группы и пауза проекта обнуляют раскладку с понятной причиной", () => {
    const paused = group({ review_mode: "paused" });
    expect(planPreview([acc({ group_id: "g1" })], "drip", paused).skipped[0].hint).toMatch(/группа на паузе/);
    const byProject = planPreview([acc({})], "drip", null, new Date(), { projectPaused: true });
    expect(byProject.eligible).toHaveLength(0);
    expect(byProject.skipped[0].hint).toMatch(/проекта на паузе/);
    // Группа самого аккаунта на паузе — тоже пропуск, даже если в композере группа не выбрана.
    const own = accountEligibility(acc({ group_id: "g1" }), { groups: [paused] });
    expect(own.reason).toBe("group_paused");
  });
});

describe("время старта — Алматы", () => {
  it("datetime-local трактуется как UTC+5", () => {
    expect(almatyLocalToIso("2026-09-10T14:30")).toBe("2026-09-10T09:30:00.000Z");
    expect(almatyLocalToIso("2026-09-10T00:15:00")).toBe("2026-09-09T19:15:00.000Z");
    expect(almatyLocalToIso("вчера")).toBeNull();
  });
  it("min для поля — текущее время Алматы в том же формате", () => {
    expect(almatyLocalNow(Date.parse("2026-09-10T09:30:00Z"))).toBe("2026-09-10T14:30");
  });
});

describe("действия по заданию", () => {
  const now = Date.parse("2026-09-10T10:00:00Z");
  it("processing с живой арендой трогать нельзя", () => {
    expect(jobActions({ status: "processing", locked_at: "2026-09-10T09:58:00Z" }, now)).toEqual({ retry: false, cancel: false, stale: false });
  });
  it("processing без аренды старше 10 минут — зависло: можно повторить и отменить", () => {
    expect(jobActions({ status: "processing", locked_at: "2026-09-10T09:40:00Z" }, now)).toEqual({ retry: true, cancel: true, stale: true });
    expect(jobActions({ status: "processing", locked_at: null }, now).stale).toBe(true);
  });
  it("остальные статусы — по таблице", () => {
    expect(jobActions({ status: "failed", locked_at: null }, now)).toEqual({ retry: true, cancel: false, stale: false });
    expect(jobActions({ status: "pending", locked_at: null }, now)).toEqual({ retry: false, cancel: true, stale: false });
  });
});

describe("варианты подписи", () => {
  it("по одному на строку, без пустых и дублей", async () => {
    const { splitLines } = await import("@/components/publishing/UploadPublishDialog");
    expect(splitLines("Первый\n\n  Второй  \r\nПервый\n")).toEqual(["Первый", "Второй"]);
    expect(splitLines("")).toEqual([]);
  });
});
