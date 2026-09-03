import { describe, expect, it } from "vitest";
import {
  buildInsightsUrl,
  fetchAllInsightPages,
  isUnknownColumnError,
  leadsByDateFromCampaignRows,
  leadsOfObject,
  messagesOfObject,
  withoutColumns,
} from "../../supabase/functions/_lib/metaInsights.ts";

describe("leadsOfObject", () => {
  it("не двоит диалог, который Meta кладёт и в lead, и в messaging", () => {
    // Кампания с целью «Лиды» и назначением в мессенджер: один и тот же диалог
    // приходит тремя событиями. Раньше считали 45 + 45 = 90.
    const actions = [
      { action_type: "lead", value: "45" },
      { action_type: "onsite_conversion.lead_grouped", value: "45" },
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "45" },
      { action_type: "post_engagement", value: "300" },
    ];
    expect(leadsOfObject(actions)).toBe(45);
    expect(messagesOfObject(actions)).toBe(45);
  });

  it("считает лид-форму, когда переписок нет", () => {
    expect(leadsOfObject([
      { action_type: "lead", value: "12" },
      { action_type: "onsite_conversion.lead_grouped", value: "12" },
      { action_type: "link_click", value: "410" },
    ])).toBe(12);
  });

  it("считает заявки с сайта по пикселю", () => {
    expect(leadsOfObject([
      { action_type: "offsite_conversion.fb_pixel_lead", value: "7" },
    ])).toBe(7);
  });

  it("считает переписки, даже если lead-события Meta не прислала", () => {
    expect(leadsOfObject([
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "31" },
    ])).toBe(31);
  });

  it("не падает на пустых данных", () => {
    expect(leadsOfObject(undefined)).toBe(0);
    expect(leadsOfObject([])).toBe(0);
    expect(leadsOfObject([{ action_type: "lead", value: "abc" }])).toBe(0);
  });
});

describe("leadsByDateFromCampaignRows", () => {
  it("складывает кампании за день, каждую по своей логике", () => {
    // Кабинет ведёт две кампании: одна в переписку, вторая на лид-форму.
    // На уровне аккаунта их события смешивались и давали двойной счёт.
    const byDate = leadsByDateFromCampaignRows([
      {
        date_start: "2026-09-01",
        campaign_id: "c-messaging",
        actions: [
          { action_type: "lead", value: "20" },
          { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "20" },
        ],
      },
      {
        date_start: "2026-09-01",
        campaign_id: "c-leadform",
        actions: [{ action_type: "onsite_conversion.lead_grouped", value: "5" }],
      },
      {
        date_start: "2026-09-02",
        campaign_id: "c-messaging",
        actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "8" }],
      },
    ]);

    expect(byDate.get("2026-09-01")).toEqual({ leads: 25, messages: 20 });
    expect(byDate.get("2026-09-02")).toEqual({ leads: 8, messages: 8 });
  });

  it("пропускает строки без корректной даты", () => {
    const byDate = leadsByDateFromCampaignRows([
      { date_start: "", actions: [{ action_type: "lead", value: "3" }] },
    ]);
    expect(byDate.size).toBe(0);
  });
});

describe("buildInsightsUrl", () => {
  const url = buildInsightsUrl({
    apiVersion: "v21.0",
    actId: "act_1",
    since: "2026-09-01",
    until: "2026-09-03",
    token: "t0ken",
    level: "campaign",
    extraFields: ["campaign_id"],
  });
  const params = new URL(url).searchParams;

  it("просит окно атрибуции Ads Manager", () => {
    expect(params.get("use_unified_attribution_setting")).toBe("true");
  });

  it("просит клики по ссылке — по ним считаются CTR и CPC", () => {
    expect(params.get("fields")).toContain("inline_link_clicks");
    expect(params.get("fields")).toContain("campaign_id");
  });

  it("разбивает период по дням на нужном уровне", () => {
    expect(params.get("time_increment")).toBe("1");
    expect(params.get("level")).toBe("campaign");
    expect(params.get("time_range")).toBe('{"since":"2026-09-01","until":"2026-09-03"}');
  });
});

describe("fetchAllInsightPages", () => {
  it("идёт по paging.next — иначе месяц по кампаниям молча обрезался", async () => {
    const pages: Record<string, unknown> = {
      "https://first": { data: [{ date_start: "2026-09-01" }], paging: { next: "https://second" } },
      "https://second": { data: [{ date_start: "2026-09-02" }] },
    };
    const rows = await fetchAllInsightPages("https://first", (u) =>
      Promise.resolve({ ok: true, json: async () => pages[u] } as Response));
    expect(rows).toHaveLength(2);
  });

  it("отдаёт ошибку Meta наверх", async () => {
    await expect(
      fetchAllInsightPages("https://err", () =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: "Invalid OAuth token" } }),
        } as Response)),
    ).rejects.toThrow("Invalid OAuth token");
  });
});

describe("совместимость схемы", () => {
  it("узнаёт ошибку про ещё не добавленную колонку", () => {
    expect(isUnknownColumnError(
      "Could not find the 'link_clicks' column of 'cabinet_daily_insights' in the schema cache",
    )).toBe(true);
    expect(isUnknownColumnError("duplicate key value violates unique constraint")).toBe(false);
    expect(withoutColumns([{ date: "2026-09-01", link_clicks: 5, messages: 2, leads: 7 }]))
      .toEqual([{ date: "2026-09-01", leads: 7 }]);
  });
});
