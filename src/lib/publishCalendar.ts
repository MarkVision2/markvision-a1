/**
 * Календарь публикаций по аккаунтам — чистая раскладка без React.
 *
 * Неделя × аккаунт: сервер (publish-accounts action=calendar) отдаёт задания
 * за период и аккаунты; здесь они раскладываются по дням в поясе аккаунта
 * (тем же способом, что `published_day` в SQL — иначе слот в 23:30 по Алматы
 * уезжал бы на следующий день по UTC). Загрузка ячейки сравнивается с
 * дневным лимитом аккаунта.
 */
import { DEFAULT_TIMEZONE, localDay, type CalendarAccount, type CalendarJob, type PublishJobStatus } from "@/lib/publishingClient";

export const DAY_MS = 86_400_000;

/** Понедельник недели, в которую попадает дата (UTC-полночь). */
export function weekStart(anchor: Date | number = Date.now()): Date {
  const d = new Date(anchor);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (new Date(utc).getUTCDay() + 6) % 7; // пн = 0
  return new Date(utc - dow * DAY_MS);
}

/** Ключи дней (YYYY-MM-DD) от start на days вперёд. */
export function dayKeys(start: Date, days = 7): string[] {
  return Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10));
}

/**
 * Границы запроса к серверу: с запасом по суткам в обе стороны, потому что
 * день аккаунта в его поясе не совпадает с UTC-сутками. Лишнее отбросит раскладка.
 */
export function calendarRange(start: Date, days = 7): { from: string; to: string } {
  return {
    from: new Date(start.getTime() - DAY_MS).toISOString(),
    to: new Date(start.getTime() + (days + 1) * DAY_MS).toISOString(),
  };
}

export interface CalendarCell {
  day: string;
  jobs: CalendarJob[];
  /** Сколько заданий считаются занимающими слот (не отменённые, не упавшие). */
  used: number;
  limit: number;
  /** used > limit — планировщик так не делает, но ручные задания могут. */
  over: boolean;
}

export interface CalendarRow {
  account: CalendarAccount;
  timezone: string;
  cells: CalendarCell[];
  total: number;
}

export interface CalendarGrid {
  days: string[];
  rows: CalendarRow[];
  /** Итог по дню: всего заданий и опубликовано. */
  totals: { day: string; jobs: number; published: number; failed: number }[];
  /** Задания, чей аккаунт не попал в список (отключён после постановки). */
  orphans: number;
}

/** Статусы, которые занимают слот в дне (лимит считается по ним). */
const OCCUPYING: PublishJobStatus[] = ["pending", "retry", "processing", "verifying", "published", "manual_review"];

export function jobOccupiesSlot(status: PublishJobStatus): boolean {
  return OCCUPYING.includes(status);
}

/** Время задания в поясе аккаунта — HH:mm. */
export function jobTime(job: CalendarJob, timezone: string): string {
  const iso = job.scheduled_at ?? job.published_at;
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: DEFAULT_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  }
}

export function buildCalendarGrid(accounts: CalendarAccount[], jobs: CalendarJob[], days: string[]): CalendarGrid {
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const byAccount = new Map<string, CalendarJob[][]>();
  for (const a of accounts) byAccount.set(a.id, days.map(() => []));
  const tzOf = new Map(accounts.map((a) => [a.id, a.timezone || DEFAULT_TIMEZONE]));

  let orphans = 0;
  const sorted = [...jobs].sort((x, y) => (x.scheduled_at ?? x.published_at ?? "").localeCompare(y.scheduled_at ?? y.published_at ?? ""));
  for (const j of sorted) {
    const buckets = byAccount.get(j.account_id);
    if (!buckets) { orphans += 1; continue; }
    const iso = j.scheduled_at ?? j.published_at;
    if (!iso) continue;
    const key = localDay(tzOf.get(j.account_id), new Date(iso));
    const idx = dayIndex.get(key);
    if (idx == null) continue; // запас по суткам с краёв запроса
    buckets[idx].push(j);
  }

  const rows: CalendarRow[] = accounts.map((a) => {
    const buckets = byAccount.get(a.id) ?? days.map(() => []);
    const cells = days.map((day, i) => {
      const cellJobs = buckets[i];
      const used = cellJobs.filter((j) => jobOccupiesSlot(j.status)).length;
      const limit = Math.max(0, a.daily_limit ?? 0);
      return { day, jobs: cellJobs, used, limit, over: used > limit };
    });
    return { account: a, timezone: a.timezone || DEFAULT_TIMEZONE, cells, total: cells.reduce((s, c) => s + c.jobs.length, 0) };
  });

  const totals = days.map((day, i) => {
    let n = 0, published = 0, failed = 0;
    for (const r of rows) {
      for (const j of r.cells[i].jobs) {
        n += 1;
        if (j.status === "published") published += 1;
        if (j.status === "failed") failed += 1;
      }
    }
    return { day, jobs: n, published, failed };
  });

  return { days, rows, totals, orphans };
}

/** «пн 8 сен» для шапки колонки. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
}
