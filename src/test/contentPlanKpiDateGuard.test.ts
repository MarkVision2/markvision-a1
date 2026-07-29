import { describe, expect, it } from "vitest";
import { buildContentPlanFunnel, type ContentPlanOrganicEvent } from "@/lib/contentPlanIgLink";

const ev = (partial: Partial<ContentPlanOrganicEvent> & { event_type: string }): ContentPlanOrganicEvent => ({
  id: Math.random().toString(36),
  codeword_id: "cw1",
  codeword: "хаб",
  lead_id: null,
  reel_id: null,
  occurred_at: null,
  ...partial,
});

describe("contentPlanIgLink date-guard", () => {
  it("orphan events BEFORE post publication are NOT counted", () => {
    const events: ContentPlanOrganicEvent[] = [
      ev({ event_type: "codeword_dm", occurred_at: "2026-07-21T12:00:00Z" }),
      ev({ event_type: "codeword_dm", occurred_at: "2026-07-22T10:00:00Z" }),
      ev({ event_type: "lead", lead_id: "L1", occurred_at: "2026-07-22T15:00:00Z" }),
    ];
    const funnel = buildContentPlanFunnel({
      igMediaId: "media1",
      codewordId: "cw1",
      codeword: "хаб",
      claimOrphanCodewordEvents: true,
      primaryPublishedAt: "2026-07-28T06:30:00Z", // post published AFTER events
      events,
      leads: [],
    });
    expect(funnel.codewordHits).toBe(0);
    expect(funnel.registrations).toBe(0);
  });

  it("orphan events AFTER post publication ARE counted", () => {
    const events: ContentPlanOrganicEvent[] = [
      ev({ event_type: "codeword_dm", occurred_at: "2026-07-29T10:00:00Z" }),
      ev({ event_type: "lead", lead_id: "L2", occurred_at: "2026-07-29T11:00:00Z" }),
    ];
    const funnel = buildContentPlanFunnel({
      igMediaId: "media1",
      codewordId: "cw1",
      codeword: "хаб",
      claimOrphanCodewordEvents: true,
      primaryPublishedAt: "2026-07-28T06:30:00Z",
      events,
      leads: [{ id: "L2", stage_role: null, paid: false, amount: 0, deposit_amount: 0, webinar_status: null }],
    });
    expect(funnel.codewordHits).toBe(1);
    expect(funnel.registrations).toBe(1);
  });

  it("stats aggregate is NOT shown when last_event_at predates post publish", () => {
    const funnel = buildContentPlanFunnel({
      igMediaId: "media1",
      codewordId: "cw1",
      codeword: "хаб",
      claimOrphanCodewordEvents: true,
      primaryPublishedAt: "2026-07-28T06:30:00Z",
      events: [],
      leads: [],
      codewordStats: {
        codeword_dms: 6,
        codeword_comments: 2,
        leads: 3,
        sales: 0,
        revenue: 0,
        last_event_at: "2026-07-24T05:28:07Z", // last event BEFORE post
      },
    });
    expect(funnel.codewordHits).toBe(0);
    expect(funnel.registrations).toBe(0);
  });

  it("stats aggregate IS shown when last_event_at is after post publish", () => {
    const funnel = buildContentPlanFunnel({
      igMediaId: "media1",
      codewordId: "cw1",
      codeword: "хаб",
      claimOrphanCodewordEvents: true,
      primaryPublishedAt: "2026-07-28T06:30:00Z",
      events: [],
      leads: [],
      codewordStats: {
        codeword_dms: 2,
        codeword_comments: 0,
        leads: 1,
        sales: 0,
        revenue: 0,
        last_event_at: "2026-07-29T09:00:00Z", // last event AFTER post
      },
    });
    expect(funnel.codewordHits).toBe(2);
    expect(funnel.registrations).toBe(1);
  });
});
