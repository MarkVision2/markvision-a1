import { Flame, Snowflake, ThermometerSun, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  bucketByWeek,
  countQuality,
  QUALITY_LABEL,
  QUALITY_COLOR_HEX,
  type QualityCounts,
  type QualityCategory,
} from "@/lib/quality";
import { isLeadPaid, isLeadVisit } from "@/lib/leadStageFlags";

export interface QualityLeadLike {
  aiScore?: number | null;
  stageId?: string | null;
  stageKey?: string | null;
  createdAt?: string | null;
}

interface Props {
  leads: readonly QualityLeadLike[];
  /** Сколько недель показывать в гистограмме. */
  weeks?: number;
  /** Заголовок секции. */
  title?: string;
  /** Скрыть гистограмму (для KPI-режима). */
  compact?: boolean;
}

const CATEGORIES: QualityCategory[] = ["paid", "hot", "warm", "cold"];

const CAT_ICON: Record<QualityCategory, typeof Flame> = {
  paid: CheckCircle2,
  hot: Flame,
  warm: ThermometerSun,
  cold: Snowflake,
  unknown: Snowflake,
};

function Counter({ counts, cat }: { counts: QualityCounts; cat: QualityCategory }) {
  const Icon = CAT_ICON[cat];
  const v = counts[cat];
  const total = counts.total - counts.unknown;
  const pct = total > 0 ? Math.round((v / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span
          className="grid h-8 w-8 place-items-center rounded-lg ring-1"
          style={{
            background: `${QUALITY_COLOR_HEX[cat]}22`,
            color: QUALITY_COLOR_HEX[cat],
            borderColor: `${QUALITY_COLOR_HEX[cat]}55`,
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider">{QUALITY_LABEL[cat]}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2 tabular-nums">
        <div className="text-xl font-bold">{v}</div>
        <div className="text-[11px] text-muted-foreground">{pct}%</div>
      </div>
    </div>
  );
}

function normalize<T extends QualityLeadLike>(leads: readonly T[]): { aiScore: number | null; stageId: string | null; createdAt: string | null }[] {
  return leads.map((l) => ({
    aiScore: l.aiScore ?? null,
    stageId: l.stageId ?? l.stageKey ?? null,
    createdAt: l.createdAt ?? null,
  }));
}

export function QualityBlock({ leads, weeks = 8, title = "Качество лидов", compact }: Props) {
  const norm = normalize(leads);
  const counts = countQuality(norm);
  const weekly = !compact ? bucketByWeek(norm, weeks) : [];
  const maxWeekTotal = Math.max(1, ...weekly.map((w) => w.counts.total - w.counts.unknown));

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Flame className="h-4 w-4 text-primary" />
          {title}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          Всего лидов: <span className="font-semibold text-foreground">{counts.total}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {CATEGORIES.map((cat) => (
          <Counter key={cat} counts={counts} cat={cat} />
        ))}
      </div>

      {!compact && weekly.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>По неделям ({weeks})</span>
            <div className="flex items-center gap-3">
              {CATEGORIES.map((cat) => (
                <span key={cat} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: QUALITY_COLOR_HEX[cat] }}
                  />
                  {QUALITY_LABEL[cat]}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-1.5">
            {weekly.map(({ week, counts: c }) => {
              const total = c.total - c.unknown;
              const heightPct = total > 0 ? Math.max(8, Math.round((total / maxWeekTotal) * 100)) : 2;
              return (
                <div key={week} className="flex flex-1 flex-col items-center gap-1" title={`${week}: ${total} лидов`}>
                  <div className="relative w-full overflow-hidden rounded-md bg-secondary/40" style={{ height: 72 }}>
                    <div
                      className={cn("absolute inset-x-0 bottom-0 flex flex-col-reverse")}
                      style={{ height: `${heightPct}%` }}
                    >
                      {CATEGORIES.map((cat) =>
                        c[cat] > 0 ? (
                          <div
                            key={cat}
                            style={{
                              background: QUALITY_COLOR_HEX[cat],
                              flexGrow: c[cat],
                            }}
                            title={`${QUALITY_LABEL[cat]}: ${c[cat]}`}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                  <div className="text-[9px] text-muted-foreground">{week.split("-W")[1]}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Воронка: Новые → Записан → Оплатил.
 * Считает по `stageId`. Если стадия пустая — лид не входит.
 */
export function QualityFunnel({ leads }: { leads: readonly QualityLeadLike[] }) {
  const stage = (l: QualityLeadLike) => l.stageId ?? l.stageKey ?? "";
  const totalLeads = leads.length;
  // Через общий helper — поддерживает все языковые варианты paid-стадии и leads.paid boolean.
  // Раньше было захардкожено ["paid", "completed"] — в проектах с переименованной стадией
  // воронка показывала 0 оплат, при этом Dashboard.totals.revenue считал правильно → расхождение.
  const scheduled = leads.filter((l) => {
    const s = stage(l);
    return s === "scheduled" || isLeadVisit({ stageKey: s });
  }).length;
  const paid = leads.filter((l) => isLeadPaid({ stageKey: stage(l) })).length;

  const pctScheduled = totalLeads > 0 ? Math.round((scheduled / totalLeads) * 100) : 0;
  const pctPaid = scheduled > 0 ? Math.round((paid / scheduled) * 100) : 0;
  const pctPaidOfAll = totalLeads > 0 ? Math.round((paid / totalLeads) * 100) : 0;

  const stages = [
    { name: "Все лиды", value: totalLeads, color: "#94a3b8", cr: null as number | null },
    { name: "Записан на диагностику", value: scheduled, color: "#ef4444", cr: pctScheduled },
    { name: "Оплатил", value: paid, color: "#22c55e", cr: pctPaid },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Воронка: лид → диагностика → оплата</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          Общий CR в продажу: <span className="font-bold text-success">{pctPaidOfAll}%</span>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {stages.map((s) => {
          const w = (s.value / max) * 100;
          return (
            <div key={s.name}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {s.value}
                  {s.cr !== null && (
                    <span className="ml-2 text-primary">CR {s.cr}%</span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-secondary/60">
                <div className="h-full" style={{ width: `${w}%`, background: s.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
