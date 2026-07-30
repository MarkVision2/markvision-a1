import { ymdAlmaty, ymdAlmatyFromIso } from "@/lib/metaSync";

export type LeadPeriodPreset = "today" | "yesterday" | "week" | "last7" | "month";

export type LeadDayBucket = {
  ymd: string;
  count: number;
  label: string;
  shortLabel: string;
};

export type LeadDynamics = {
  preset: LeadPeriodPreset;
  fromYmd: string;
  toYmd: string;
  total: number;
  days: LeadDayBucket[];
  prevTotal: number;
  delta: number;
  rangeLabel: string;
};

const PRESET_LABEL: Record<LeadPeriodPreset, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  week: "Эта неделя",
  last7: "7 дней",
  month: "Месяц",
};

export function leadPeriodPresetLabel(preset: LeadPeriodPreset): string {
  return PRESET_LABEL[preset];
}

/** Сдвиг календарного YMD без привязки к локальной TZ браузера. */
export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function enumerateYmd(fromYmd: string, toYmd: string): string[] {
  if (!fromYmd || !toYmd || fromYmd > toYmd) return [];
  const out: string[] = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    if (out.length > 62) break; // safety
  }
  return out;
}

/** Понедельник текущей недели Almaty → сегодня. */
function weekFromYmd(todayYmd: string): string {
  const [y, m, d] = todayYmd.split("-").map(Number);
  // noon UTC avoids DST edge; weekday in Almaty ≈ weekday of this civil date
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = utc.getUTCDay(); // 0=Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDaysYmd(todayYmd, mondayOffset);
}

function monthFromYmd(todayYmd: string): string {
  return `${todayYmd.slice(0, 7)}-01`;
}

export function rangeForLeadPreset(
  preset: LeadPeriodPreset,
  now = new Date(),
): { fromYmd: string; toYmd: string } {
  const today = ymdAlmaty(now);
  switch (preset) {
    case "today":
      return { fromYmd: today, toYmd: today };
    case "yesterday": {
      const y = addDaysYmd(today, -1);
      return { fromYmd: y, toYmd: y };
    }
    case "week":
      return { fromYmd: weekFromYmd(today), toYmd: today };
    case "last7":
      return { fromYmd: addDaysYmd(today, -6), toYmd: today };
    case "month":
      return { fromYmd: monthFromYmd(today), toYmd: today };
  }
}

function previousRange(fromYmd: string, toYmd: string): { fromYmd: string; toYmd: string } {
  const days = enumerateYmd(fromYmd, toYmd).length || 1;
  const prevTo = addDaysYmd(fromYmd, -1);
  const prevFrom = addDaysYmd(prevTo, -(days - 1));
  return { fromYmd: prevFrom, toYmd: prevTo };
}

const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS_RU = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function formatDayLabel(ymd: string): { label: string; shortLabel: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = WEEKDAYS_RU[utc.getUTCDay()];
  const month = MONTHS_RU[m - 1];
  return {
    label: `${d} ${month}`,
    shortLabel: wd,
  };
}

export function formatLeadRangeLabel(fromYmd: string, toYmd: string): string {
  if (fromYmd === toYmd) {
    const { label } = formatDayLabel(fromYmd);
    return label;
  }
  const a = formatDayLabel(fromYmd).label;
  const b = formatDayLabel(toYmd).label;
  return `${a} – ${b}`;
}

function countInRange(
  leads: Array<{ createdAt: string }>,
  fromYmd: string,
  toYmd: string,
): number {
  let n = 0;
  for (const l of leads) {
    const day = ymdAlmatyFromIso(l.createdAt);
    if (day && day >= fromYmd && day <= toYmd) n += 1;
  }
  return n;
}

/**
 * Динамика новых лидов по дням (created_at → Asia/Almaty).
 * @param focusYmd — если задан, total = только этот день (бары остаются по периоду).
 */
export function buildLeadDynamics(
  leads: Array<{ createdAt: string }>,
  preset: LeadPeriodPreset,
  opts?: { now?: Date; focusYmd?: string | null },
): LeadDynamics {
  const now = opts?.now ?? new Date();
  const { fromYmd, toYmd } = rangeForLeadPreset(preset, now);
  const ymds = enumerateYmd(fromYmd, toYmd);

  const byDay = new Map<string, number>();
  for (const y of ymds) byDay.set(y, 0);
  for (const l of leads) {
    const day = ymdAlmatyFromIso(l.createdAt);
    if (!day || !byDay.has(day)) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const days: LeadDayBucket[] = ymds.map((ymd) => {
    const { label, shortLabel } = formatDayLabel(ymd);
    return { ymd, count: byDay.get(ymd) ?? 0, label, shortLabel };
  });

  const focus = opts?.focusYmd && byDay.has(opts.focusYmd) ? opts.focusYmd : null;
  const periodTotal = days.reduce((s, d) => s + d.count, 0);
  const total = focus ? (byDay.get(focus) ?? 0) : periodTotal;

  let prevTotal: number;
  let delta: number;
  let rangeLabel: string;

  if (focus) {
    const prevDay = addDaysYmd(focus, -1);
    prevTotal = countInRange(leads, prevDay, prevDay);
    delta = total - prevTotal;
    rangeLabel = formatDayLabel(focus).label;
  } else {
    const prev = previousRange(fromYmd, toYmd);
    prevTotal = countInRange(leads, prev.fromYmd, prev.toYmd);
    delta = periodTotal - prevTotal;
    rangeLabel = formatLeadRangeLabel(fromYmd, toYmd);
  }

  return {
    preset,
    fromYmd,
    toYmd,
    total,
    days,
    prevTotal,
    delta,
    rangeLabel,
  };
}
