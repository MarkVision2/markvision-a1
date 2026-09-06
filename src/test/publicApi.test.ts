/**
 * Публичный API: маршруты, права на них и разбор тела публикации.
 */
import { describe, expect, it } from "vitest";
import { matchRoute, parseDistributeInput, parsePublicationInput, requiredScope } from "../../supabase/functions/_lib/publicApi.ts";

const ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("matchRoute", () => {
  it("понимает путь и из edge-runtime, и через шлюз", () => {
    expect(matchRoute("GET", "/api/v1/me")).toEqual({ name: "me" });
    expect(matchRoute("GET", "/functions/v1/api/v1/me")).toEqual({ name: "me" });
  });

  it("все маршруты", () => {
    expect(matchRoute("GET", "/api/v1/accounts")).toEqual({ name: "accounts" });
    expect(matchRoute("POST", `/api/v1/accounts/${ID}`)).toEqual({ name: "account_update", id: ID });
    expect(matchRoute("POST", "/api/v1/accounts/health-check")).toEqual({ name: "accounts_health_check" });
    expect(matchRoute("GET", "/api/v1/groups")).toEqual({ name: "groups" });
    expect(matchRoute("POST", "/api/v1/groups")).toEqual({ name: "group_create" });
    expect(matchRoute("POST", `/api/v1/groups/${ID}`)).toEqual({ name: "group_update", id: ID });
    expect(matchRoute("POST", `/api/v1/groups/${ID}/delete`)).toEqual({ name: "group_delete", id: ID });
    expect(matchRoute("GET", "/api/v1/settings")).toEqual({ name: "settings_get" });
    expect(matchRoute("POST", "/api/v1/settings")).toEqual({ name: "settings_update" });
    expect(matchRoute("GET", "/api/v1/jobs")).toEqual({ name: "jobs_list" });
    expect(matchRoute("GET", "/api/v1/metrics")).toEqual({ name: "metrics" });
    expect(matchRoute("POST", "/api/v1/media/upload-url")).toEqual({ name: "upload_url" });
    expect(matchRoute("GET", "/api/v1/publications")).toEqual({ name: "publications_list" });
    expect(matchRoute("POST", "/api/v1/publications")).toEqual({ name: "publication_create" });
    expect(matchRoute("GET", `/api/v1/publications/${ID}`)).toEqual({ name: "publication_get", id: ID });
    expect(matchRoute("POST", `/api/v1/publications/${ID}/jobs`)).toEqual({ name: "publication_jobs_create", id: ID });
    expect(matchRoute("POST", "/api/v1/publications/distribute")).toEqual({ name: "publications_distribute" });
    expect(matchRoute("GET", "/api/v1/publications/distribute")).toBeNull();
    expect(requiredScope({ name: "publications_distribute" })).toBe("publish");
    expect(matchRoute("POST", `/api/v1/jobs/${ID}/cancel`)).toEqual({ name: "job_cancel", id: ID });
    expect(matchRoute("POST", `/api/v1/jobs/${ID}/retry`)).toEqual({ name: "job_retry", id: ID });
    expect(matchRoute("GET", `/api/v1/jobs/${ID}`)).toEqual({ name: "job_get", id: ID });
    expect(matchRoute("GET", "/api/v1/analytics/content")).toEqual({ name: "analytics_content" });
    expect(matchRoute("GET", `/api/v1/analytics/content/${ID}`)).toEqual({ name: "analytics_content_item", id: ID });
    expect(matchRoute("GET", `/api/v1/analytics/accounts/${ID}`)).toEqual({ name: "analytics_account", id: ID });
    expect(matchRoute("GET", "/api/v1/notifications")).toEqual({ name: "notifications_list" });
    expect(matchRoute("POST", `/api/v1/notifications/${ID}/read`)).toEqual({ name: "notification_read", id: ID });
  });

  it("кампании, вебхуки, отчёт", () => {
    expect(matchRoute("GET", "/api/v1/campaigns")).toEqual({ name: "campaigns_list" });
    expect(matchRoute("POST", "/api/v1/campaigns")).toEqual({ name: "campaign_create" });
    expect(matchRoute("GET", `/api/v1/campaigns/${ID}`)).toEqual({ name: "campaign_get", id: ID });
    expect(matchRoute("POST", `/api/v1/campaigns/${ID}`)).toEqual({ name: "campaign_update", id: ID });
    expect(matchRoute("POST", `/api/v1/campaigns/${ID}/items`)).toEqual({ name: "campaign_items_add", id: ID });
    expect(matchRoute("POST", `/api/v1/campaigns/${ID}/items-remove`)).toEqual({ name: "campaign_items_remove", id: ID });
    expect(matchRoute("POST", `/api/v1/campaigns/${ID}/start`)).toEqual({ name: "campaign_status", id: ID, status: "active" });
    expect(matchRoute("POST", `/api/v1/campaigns/${ID}/pause`)).toEqual({ name: "campaign_status", id: ID, status: "paused" });
    expect(matchRoute("POST", `/api/v1/campaigns/${ID}/complete`)).toEqual({ name: "campaign_status", id: ID, status: "completed" });
    expect(matchRoute("POST", `/api/v1/campaigns/${ID}/plan`)).toEqual({ name: "campaign_plan", id: ID });
    expect(matchRoute("GET", `/api/v1/campaigns/${ID}/plan`)).toBeNull();
    expect(matchRoute("GET", "/api/v1/webhooks")).toEqual({ name: "webhooks_list" });
    expect(matchRoute("POST", "/api/v1/webhooks")).toEqual({ name: "webhook_create" });
    expect(matchRoute("POST", `/api/v1/webhooks/${ID}`)).toEqual({ name: "webhook_update", id: ID });
    expect(matchRoute("POST", `/api/v1/webhooks/${ID}/delete`)).toEqual({ name: "webhook_delete", id: ID });
    expect(matchRoute("GET", `/api/v1/webhooks/${ID}/deliveries`)).toEqual({ name: "webhook_deliveries", id: ID });
    expect(matchRoute("GET", "/api/v1/reports/daily")).toEqual({ name: "report_daily" });
    expect(requiredScope({ name: "campaign_create" })).toBe("publish");
    expect(requiredScope({ name: "campaign_status", id: ID, status: "active" })).toBe("publish");
    expect(requiredScope({ name: "webhook_create" })).toBe("manage");
    expect(requiredScope({ name: "webhooks_list" })).toBe("read");
    expect(requiredScope({ name: "report_daily" })).toBe("read");
  });

  it("участники, рутины, задачи", () => {
    expect(matchRoute("GET", "/api/v1/members")).toEqual({ name: "members_list" });
    expect(matchRoute("POST", `/api/v1/members/${ID}/role`)).toEqual({ name: "member_role_set", id: ID });
    expect(matchRoute("GET", "/api/v1/routines")).toEqual({ name: "routines_list" });
    expect(matchRoute("POST", "/api/v1/routines")).toEqual({ name: "routine_create" });
    expect(matchRoute("POST", `/api/v1/routines/${ID}`)).toEqual({ name: "routine_update", id: ID });
    expect(matchRoute("POST", `/api/v1/routines/${ID}/assign`)).toEqual({ name: "routine_assign", id: ID });
    expect(matchRoute("POST", `/api/v1/routines/${ID}/delete`)).toEqual({ name: "routine_delete", id: ID });
    expect(matchRoute("GET", "/api/v1/tasks")).toEqual({ name: "tasks_list" });
    expect(matchRoute("GET", "/api/v1/calendar")).toEqual({ name: "calendar" });
    expect(matchRoute("POST", "/api/v1/calendar")).toBeNull();
    expect(matchRoute("POST", "/api/v1/accounts/bulk")).toEqual({ name: "accounts_bulk_update" });
    expect(matchRoute("GET", "/api/v1/accounts/bulk")).toBeNull();
    expect(requiredScope({ name: "calendar" })).toBe("read");
    // Phase 4: согласование, аналитик, темы и варианты
    expect(matchRoute("POST", "/api/v1/jobs/approve")).toEqual({ name: "jobs_approve" });
    expect(matchRoute("POST", "/api/v1/jobs/reject")).toEqual({ name: "jobs_reject" });
    expect(matchRoute("GET", "/api/v1/jobs/approve")).toBeNull();
    expect(matchRoute("GET", "/api/v1/analytics/insights")).toEqual({ name: "analytics_insights" });
    expect(matchRoute("GET", "/api/v1/content")).toEqual({ name: "content_list" });
    expect(matchRoute("POST", `/api/v1/content/${ID}/variants`)).toEqual({ name: "content_variants", id: ID });
    expect(matchRoute("POST", "/api/v1/content/not-uuid/variants")).toBeNull();
    expect(requiredScope({ name: "jobs_approve" })).toBe("publish");
    expect(requiredScope({ name: "analytics_insights" })).toBe("read");
    expect(requiredScope({ name: "content_list" })).toBe("read");
    expect(requiredScope({ name: "content_variants", id: ID })).toBe("publish");
    // Phase 5: автопилот победителей
    expect(matchRoute("POST", `/api/v1/analytics/content/${ID}/replicate`)).toEqual({ name: "content_replicate", id: ID });
    expect(matchRoute("GET", `/api/v1/analytics/content/${ID}/replicate`)).toBeNull();
    expect(matchRoute("GET", "/api/v1/replications")).toEqual({ name: "replications_list" });
    expect(requiredScope({ name: "content_replicate", id: ID })).toBe("publish");
    expect(requiredScope({ name: "replications_list" })).toBe("read");
    expect(requiredScope({ name: "accounts_bulk_update" })).toBe("manage");
    expect(requiredScope({ name: "routine_create" })).toBe("manage");
    expect(requiredScope({ name: "member_role_set", id: ID })).toBe("manage");
    expect(requiredScope({ name: "tasks_list" })).toBe("read");
  });

  it("аналитика и трасса — только чтение; POST на них — null", () => {
    expect(matchRoute("POST", "/api/v1/analytics/content")).toBeNull();
    expect(matchRoute("GET", `/api/v1/notifications/${ID}/read`)).toBeNull();
    for (const name of ["job_get", "analytics_content", "notifications_list", "notification_read"] as const) {
      expect(requiredScope({ name, id: ID } as never)).toBe("read");
    }
  });

  it("метаданные контента: короткие ключи, source_video_id только uuid", () => {
    const r = parsePublicationInput({ file_url: "https://x/v.mp4", topic_key: "  имплантация  ", hook_type: "вопрос", cta_type: "", source_video_id: "nope" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.topic_key).toBe("имплантация");
      expect(r.input.hook_type).toBe("вопрос");
      expect(r.input.cta_type).toBeNull();
      expect(r.input.source_video_id).toBeNull();
    }
    const ok = parsePublicationInput({ file_url: "https://x/v.mp4", source_video_id: ID });
    expect(ok.ok && ok.input.source_video_id).toBe(ID);
  });

  it("client_ref попадает во вход публикации обрезанным, пустой — null", () => {
    const ok = parsePublicationInput({ file_url: "https://cdn/x.mp4", client_ref: "  order-42  " });
    expect(ok.ok && ok.input.client_ref).toBe("order-42");
    const none = parsePublicationInput({ file_url: "https://cdn/x.mp4", client_ref: "   " });
    expect(none.ok && none.input.client_ref).toBeNull();
  });

  it("чужие пути, не-uuid и не тот метод — null", () => {
    expect(matchRoute("GET", "/api/v2/me")).toBeNull();
    expect(matchRoute("DELETE", "/api/v1/me")).toBeNull();
    expect(matchRoute("GET", "/api/v1/publications/not-a-uuid")).toBeNull();
    expect(matchRoute("GET", `/api/v1/jobs/${ID}/cancel`)).toBeNull();
    expect(matchRoute("POST", "/api/v1/accounts/not-uuid")).toBeNull();
    expect(matchRoute("GET", `/api/v1/groups/${ID}`)).toBeNull();
    expect(matchRoute("GET", "/other/v1/me")).toBeNull();
  });

  it("чтение — read, очередь — publish, аккаунты/группы/настройки — manage", () => {
    expect(requiredScope({ name: "accounts" })).toBe("read");
    expect(requiredScope({ name: "settings_get" })).toBe("read");
    expect(requiredScope({ name: "jobs_list" })).toBe("read");
    expect(requiredScope({ name: "account_update", id: ID })).toBe("manage");
    expect(requiredScope({ name: "accounts_health_check" })).toBe("manage");
    expect(requiredScope({ name: "group_delete", id: ID })).toBe("manage");
    expect(requiredScope({ name: "settings_update" })).toBe("manage");
    expect(requiredScope({ name: "publication_get", id: ID })).toBe("read");
    expect(requiredScope({ name: "upload_url" })).toBe("publish");
    expect(requiredScope({ name: "publication_create" })).toBe("publish");
    expect(requiredScope({ name: "job_cancel", id: ID })).toBe("publish");
  });
});

describe("parseDistributeInput", () => {
  it("видео строками или объектами с topic_key, цель без mode, per_day/max_days", () => {
    const r = parseDistributeInput({
      videos: [ID, { id: ID, topic_key: "  Тема  " }, { id: ID, topic_key: null }],
      batch_id: " b1 ",
      target: { group_id: ID, per_day: 3, max_days: 14, start_at: "2026-09-08T09:00:00Z" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.videos).toEqual([{ id: ID }, { id: ID, topic_key: "Тема" }, { id: ID, topic_key: null }]);
    expect(r.input.batch_id).toBe("b1");
    expect(r.input.target).toEqual({ mode: "drip", group_id: ID, start_at: "2026-09-08T09:00:00.000Z", per_day: 3, max_days: 14 });
  });

  it("плохой вход — понятная ошибка", () => {
    expect(parseDistributeInput({})).toMatchObject({ ok: false, error: expect.stringContaining("videos") });
    expect(parseDistributeInput({ video_ids: ["x"] })).toMatchObject({ ok: false, error: expect.stringContaining("uuid") });
    expect(parseDistributeInput({ video_ids: [ID], target: { per_day: 0 } })).toMatchObject({ ok: false, error: expect.stringContaining("per_day") });
    expect(parseDistributeInput({ video_ids: [ID], target: { max_days: 365 } })).toMatchObject({ ok: false, error: expect.stringContaining("max_days") });
    expect(parseDistributeInput({ video_ids: [ID], target: { group_id: "g" } })).toMatchObject({ ok: false, error: expect.stringContaining("group_id") });
  });
});

describe("parsePublicationInput", () => {
  it("минимум — только ссылка, без цели", () => {
    const r = parsePublicationInput({ file_url: "https://cdn.example.com/v.mp4" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.target).toBeNull();
    expect(r.input.hashtags).toEqual([]);
    expect(r.input.title).toBeNull();
  });

  it("цель плоско или вложенно, хэштеги без решётки, дата в ISO", () => {
    const flat = parsePublicationInput({
      file_url: "https://x/v.mp4", group_id: ID, mode: "now", hashtags: ["#a", "b", " "], start_at: "2026-09-10T09:00:00+05:00",
    });
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.input.hashtags).toEqual(["a", "b"]);
    expect(flat.input.target).toEqual({ mode: "now", group_id: ID, start_at: "2026-09-10T04:00:00.000Z" });

    const nested = parsePublicationInput({ file_url: "https://x/v.mp4", target: { account_ids: [ID], per_hour: 2 } });
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect(nested.input.target).toEqual({ mode: "drip", account_ids: [ID], per_hour: 2 });
  });

  it("плохой вход — понятная ошибка", () => {
    expect(parsePublicationInput({})).toMatchObject({ ok: false, error: expect.stringContaining("file_url") });
    expect(parsePublicationInput({ file_url: "http://x/v.mp4" })).toMatchObject({ ok: false });
    expect(parsePublicationInput({ file_url: "https://x/v.mp4", mode: "later" })).toMatchObject({ ok: false, error: expect.stringContaining("mode") });
    expect(parsePublicationInput({ file_url: "https://x/v.mp4", group_id: "g1" })).toMatchObject({ ok: false, error: expect.stringContaining("group_id") });
    expect(parsePublicationInput({ file_url: "https://x/v.mp4", account_ids: ["a"] })).toMatchObject({ ok: false, error: expect.stringContaining("account_ids") });
    expect(parsePublicationInput({ file_url: "https://x/v.mp4", start_at: "вчера" })).toMatchObject({ ok: false, error: expect.stringContaining("start_at") });
    expect(parsePublicationInput({ file_url: "https://x/v.mp4", duration_sec: -1 })).toMatchObject({ ok: false, error: expect.stringContaining("duration_sec") });
  });
});
