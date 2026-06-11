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
