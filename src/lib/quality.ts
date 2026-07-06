// Единая утилита расчёта качества лида.
// Скор 0–100. Категория зависит от скора и стадии воронки.
import { isLeadPaid, isLeadVisit, type LeadFlagsInput } from "@/lib/leadStageFlags";

export type QualityCategory = "hot" | "warm" | "cold" | "paid" | "unknown";

/**
 * Классификация по тем же признакам, что и источник правды: булевы paid/paidAt,
 * diagnosticAmount и stageKey через общие helpers.
 *
 * ВАЖНО: вторым аргументом нужно передавать объект-флаги (stageKey/paid/paidAt/
 * diagnosticAmount), а НЕ «id стадии». Раньше передавали `stageId`, который у
 * LeadLite — это UUID, а не ключ → isLeadPaid({stageKey: UUID}) никогда не
 * срабатывал, и на дашборде «Оплатил/Горячий» считались неверно.
 */
export function classifyQuality(score: number | null | undefined, flags?: LeadFlagsInput | null): QualityCategory {
  const s = Number(score ?? 0);
  if (flags && isLeadPaid(flags)) return "paid";
  if (flags && isLeadVisit(flags)) return "hot";
  if (s >= 75) return "hot";
  if (s >= 50) return "warm";
  if (s > 0) return "cold";
  return "unknown";
}

export const QUALITY_LABEL: Record<QualityCategory, string> = {
  paid: "Оплатил",
  hot: "Горячий",
  warm: "Тёплый",
  cold: "Холодный",
  unknown: "Нет данных",
};

export const QUALITY_BADGE_CLS: Record<QualityCategory, string> = {
  paid: "bg-success/15 text-success",
  hot: "bg-destructive/15 text-destructive",
  warm: "bg-warning/15 text-warning",
  cold: "bg-muted text-muted-foreground",
  unknown: "bg-muted/50 text-muted-foreground",
};

export const QUALITY_COLOR_HEX: Record<QualityCategory, string> = {
  paid: "#22c55e",
  hot: "#ef4444",
  warm: "#f59e0b",
  cold: "#94a3b8",
  unknown: "#64748b",
};

export interface QualityCounts {
  paid: number;
  hot: number;
  warm: number;
  cold: number;
  unknown: number;
  total: number;
}

export type QualityLeadFlags = LeadFlagsInput & { aiScore?: number | null };

export function countQuality<T extends QualityLeadFlags>(
  leads: readonly T[],
): QualityCounts {
  const acc: QualityCounts = { paid: 0, hot: 0, warm: 0, cold: 0, unknown: 0, total: 0 };
  for (const l of leads) {
    const c = classifyQuality(l.aiScore ?? null, l);
    acc[c] += 1;
    acc.total += 1;
  }
  return acc;
}

/** Группировка по неделям ISO (yyyy-Www). */
export function bucketByWeek<T extends QualityLeadFlags & { createdAt?: string | null }>(
  leads: readonly T[],
  weeks = 8,
): Array<{ week: string; counts: QualityCounts }> {
  const now = new Date();
  const buckets = new Map<string, T[]>();
  // Initialize last N weeks
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 24 * 3600 * 1000);
    const k = isoWeekKey(d);
    if (!buckets.has(k)) buckets.set(k, []);
  }
  for (const l of leads) {
    if (!l.createdAt) continue;
    const d = new Date(l.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const k = isoWeekKey(d);
    if (!buckets.has(k)) continue;
    buckets.get(k)!.push(l);
  }
  return Array.from(buckets.entries()).map(([week, ls]) => ({ week, counts: countQuality(ls) }));
}

function isoWeekKey(d: Date): string {
  // ISO week: thursday-anchored
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
