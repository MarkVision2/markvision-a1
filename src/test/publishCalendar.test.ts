/**
 * Календарь публикаций: неделя от понедельника, день задания — в поясе
 * аккаунта, лимит считается по занимающим слот статусам.
 */
import { describe, expect, it } from "vitest";
import { buildCalendarGrid, calendarRange, dayKeys, jobTime, weekStart } from "@/lib/publishCalendar";
import type { CalendarAccount, CalendarJob } from "@/lib/publishingClient";

const acc = (id: string, tz: string | null, daily_limit = 2): CalendarAccount => ({
  id, platform: "instagram", account_name: id, handle: null, status: "active", publish_enabled: true,
  daily_limit, timezone: tz, window_start: null, window_end: null, group_id: null,
});
const job = (id: string, account_id: string, at: string, status: CalendarJob["status"] = "pending"): CalendarJob => ({
  id, video_id: "v", account_id, platform: "instagram", status, scheduled_at: at, published_at: null,
  campaign_id: null, error_class: null, external_post_url: null, publish_videos: { title: "Ролик" },
});

describe("weekStart / dayKeys / calendarRange", () => {
  it("неделя начинается с понедельника, воскресенье — к прошлой", () => {
    expect(weekStart(Date.UTC(2026, 8, 9)).toISOString().slice(0, 10)).toBe("2026-09-07"); // ср → пн
    expect(weekStart(Date.UTC(2026, 8, 13)).toISOString().slice(0, 10)).toBe("2026-09-07"); // вс → тот же пн
    expect(weekStart(Date.UTC(2026, 8, 14)).toISOString().slice(0, 10)).toBe("2026-09-14"); // пн → сам
  });

  it("семь ключей и запас по суткам в запросе", () => {
    const start = weekStart(Date.UTC(2026, 8, 9));
    expect(dayKeys(start)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
    const r = calendarRange(start);
    expect(r.from).toBe("2026-09-06T00:00:00.000Z");
    expect(r.to).toBe("2026-09-15T00:00:00.000Z");
  });
});

describe("buildCalendarGrid", () => {
  const days = dayKeys(weekStart(Date.UTC(2026, 8, 9)));

  it("день задания — в поясе аккаунта, не в UTC", () => {
    // 20:30 UTC 8 сентября = 01:30 9 сентября по Алматы (UTC+5)
    const grid = buildCalendarGrid([acc("a", "Asia/Almaty")], [job("j1", "a", "2026-09-08T20:30:00Z")], days);
    const row = grid.rows[0];
    expect(row.cells[1].jobs).toHaveLength(0);
    expect(row.cells[2].jobs.map((j) => j.id)).toEqual(["j1"]);
    expect(jobTime(row.cells[2].jobs[0], row.timezone)).toBe("01:30");
  });

  it("лимит считается по занимающим слот статусам; отменённые и упавшие не в счёт", () => {
    const grid = buildCalendarGrid(
      [acc("a", "UTC", 2)],
      [
        job("j1", "a", "2026-09-08T09:00:00Z", "published"),
        job("j2", "a", "2026-09-08T10:00:00Z", "pending"),
        job("j3", "a", "2026-09-08T11:00:00Z", "cancelled"),
        job("j4", "a", "2026-09-08T12:00:00Z", "failed"),
        job("j5", "a", "2026-09-08T13:00:00Z", "verifying"),
      ],
      days,
    );
    const cell = grid.rows[0].cells[1];
    expect(cell.jobs).toHaveLength(5);
    expect(cell.used).toBe(3);
    expect(cell.limit).toBe(2);
    expect(cell.over).toBe(true);
    expect(grid.totals[1]).toEqual({ day: "2026-09-08", jobs: 5, published: 1, failed: 1 });
  });

  it("задания вне недели и без аккаунта не ломают раскладку", () => {
    const grid = buildCalendarGrid(
      [acc("a", "UTC")],
      [job("out", "a", "2026-09-20T09:00:00Z"), job("orphan", "ghost", "2026-09-08T09:00:00Z")],
      days,
    );
    expect(grid.rows[0].total).toBe(0);
    expect(grid.orphans).toBe(1);
  });

  it("внутри ячейки задания по времени", () => {
    const grid = buildCalendarGrid(
      [acc("a", "UTC")],
      [job("late", "a", "2026-09-08T18:00:00Z"), job("early", "a", "2026-09-08T08:00:00Z")],
      days,
    );
    expect(grid.rows[0].cells[1].jobs.map((j) => j.id)).toEqual(["early", "late"]);
  });
});
