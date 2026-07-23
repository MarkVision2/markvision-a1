import { describe, expect, it } from "vitest";

/**
 * Pure mirror of the funnel rule in useInstagramOrganic (keep in sync).
 * «Написали код-слово» = codeword_dm + codeword_comment — оба триггерят DM с кнопкой,
 * поэтому клики/заявки должны считаться от суммы, а не только от директов.
 */
type Ev = {
  eventType: "codeword_dm" | "codeword_comment" | "link_click" | "lead";
  username: string | null;
  id: string;
};

function funnel(events: Ev[]) {
  const messaged = events.filter(
    (e) => e.eventType === "codeword_dm" || e.eventType === "codeword_comment",
  );
  const clicks = events.filter((e) => e.eventType === "link_click");
  const leads = events.filter((e) => e.eventType === "lead");
  const uniqueUsers = new Set(messaged.map((e) => e.username || e.id)).size;
  return {
    codewordDms: messaged.length,
    uniqueUsers,
    linkClicks: clicks.length,
    leads: leads.length,
  };
}

describe("ig organic funnel", () => {
  it("counts both DM and comment triggers as «написали код-слово»", () => {
    const events: Ev[] = [
      { eventType: "codeword_dm", username: "a", id: "1" },
      { eventType: "codeword_dm", username: "b", id: "2" },
      { eventType: "codeword_comment", username: "c", id: "3" },
      { eventType: "codeword_comment", username: "d", id: "4" },
      { eventType: "link_click", username: "a", id: "5" },
      { eventType: "lead", username: "a", id: "6" },
    ];
    const f = funnel(events);
    // 2 DM + 2 comment = 4 (не 2)
    expect(f.codewordDms).toBe(4);
    expect(f.uniqueUsers).toBe(4);
    expect(f.linkClicks).toBe(1);
    expect(f.leads).toBe(1);
  });

  it("keeps click conversion at or below 100% when comments are present", () => {
    // «хаб»-подобный кейс: 5 DM + 2 comment = 7 базы, 7 кликов → 100%, не 140%.
    const events: Ev[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ eventType: "codeword_dm" as const, username: `dm${i}`, id: `dm${i}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ eventType: "codeword_comment" as const, username: `cm${i}`, id: `cm${i}` })),
      ...Array.from({ length: 7 }, (_, i) => ({ eventType: "link_click" as const, username: null, id: `c${i}` })),
    ];
    const f = funnel(events);
    expect(f.codewordDms).toBe(7);
    expect(f.linkClicks / f.codewordDms).toBeLessThanOrEqual(1);
  });
});
