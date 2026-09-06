/** Вкладка «Кампании»: разбор формы и правило слотов (зеркало SQL). */
import { describe, expect, it } from "vitest";
import { draftToInput } from "@/components/publishing/CampaignsTab";
import { campaignSlotTimes, CAMPAIGN_TRANSITIONS } from "@/lib/publishingClient";

const base = {
  name: "Дубай", objective: "", start_date: "2026-09-05", end_date: "", group_id: "__none__",
  posts_per_day: "3", slot_times: "10:00, 14:00, 19:00", weekdays: [1, 2, 3, 4, 5], mode: "drip" as const, distribution: "fanout" as const,
};

describe("draftToInput", () => {
  it("собирает тело запроса: группа «все» → null, времена → список, пустой end_date → null", () => {
    const r = draftToInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toMatchObject({ name: "Дубай", group_id: null, end_date: null, posts_per_day: 3, slot_times: ["10:00", "14:00", "19:00"], weekdays: [1, 2, 3, 4, 5], objective: null });
      expect(r.input.campaign_id).toBeUndefined();
    }
  });

  it("ловит пустое имя, плохие времена, дни и период", () => {
    expect(draftToInput({ ...base, name: " " })).toMatchObject({ ok: false });
    expect(draftToInput({ ...base, slot_times: "25:00" })).toMatchObject({ ok: false });
    expect(draftToInput({ ...base, weekdays: [] })).toMatchObject({ ok: false });
    expect(draftToInput({ ...base, end_date: "2026-09-01" })).toMatchObject({ ok: false });
    expect(draftToInput({ ...base, posts_per_day: "0" })).toMatchObject({ ok: false });
  });
});

describe("правило слотов", () => {
  it("совпадает с SQL publish_campaign_slot_times", () => {
    expect(campaignSlotTimes([], 1)).toEqual(["12:00"]);
    expect(campaignSlotTimes([], 3)).toEqual(["10:00", "14:30", "19:00"]);
    expect(campaignSlotTimes(["14:00", "09:30"], 5)).toEqual(["09:30", "14:00"]);
  });

  it("переходы статусов зеркалят сервер", () => {
    expect(CAMPAIGN_TRANSITIONS.draft).toContain("active");
    expect(CAMPAIGN_TRANSITIONS.active).not.toContain("draft");
    expect(CAMPAIGN_TRANSITIONS.completed).toContain("active");
  });
});
