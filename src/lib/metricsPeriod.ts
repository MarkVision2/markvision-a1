import type { ReportPeriodRange } from "@/lib/crmDailyMetrics";

export type MetricsPeriodPreset = "today" | "week" | "month" | "custom";

export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayRange(now = new Date()): ReportPeriodRange {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { from: d, to: d };
}

/** Понедельник текущей недели — сегодня. */
export function weekRange(now = new Date()): ReportPeriodRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const from = new Date(today);
  from.setDate(today.getDate() + mondayOffset);
  return { from, to: today };
}

export function monthRange(date = new Date()): ReportPeriodRange {
  const from = new Date(date.getFullYear(), date.getMonth(), 1);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from, to };
}

/** Текущий месяц: с 1-го числа по сегодня. */
export function thisMonthRange(now = new Date()): ReportPeriodRange {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { from, to };
}

/** Прошлый календарный месяц целиком. */
export function lastMonthRange(now = new Date()): ReportPeriodRange {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from, to };
}

/** Предыдущий отрезок той же длины (для сравнения KPI). */
export function previousEqualRange(range: ReportPeriodRange): ReportPeriodRange {
  const fromMs = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()).getTime();
  const toExclusive = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
  toExclusive.setDate(toExclusive.getDate() + 1);
  const periodMs = Math.max(86_400_000, toExclusive.getTime() - fromMs);
  const prevFrom = new Date(fromMs - periodMs);
  const prevTo = new Date(fromMs - 86_400_000);
  return {
    from: new Date(prevFrom.getFullYear(), prevFrom.getMonth(), prevFrom.getDate()),
    to: new Date(prevTo.getFullYear(), prevTo.getMonth(), prevTo.getDate()),
  };
}

export function daysInRange(range: ReportPeriodRange): string[] {
  const out: string[] = [];
  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
  const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
  while (cur <= end) {
    out.push(ymdLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Месяцы YYYY-MM, пересекающиеся с диапазоном (для загрузки CDI / rnp_daily). */
export function monthsInRange(range: ReportPeriodRange): string[] {
  const months = new Set<string>();
  for (const iso of daysInRange(range)) {
    months.add(iso.slice(0, 7));
  }
  return Array.from(months).sort();
}

export function formatPeriodLabel(range: ReportPeriodRange): string {
  const from = ymdLocal(range.from);
  const to = ymdLocal(range.to);
  if (from === to) return from;
  return `${from} — ${to}`;
}
