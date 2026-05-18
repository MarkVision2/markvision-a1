import { useMemo } from "react";
import type { Lead, LeadStage, RejectReason } from "@/types/crm";
import { REJECT_REASONS } from "@/types/crm";
import type { TeamMember } from "@/hooks/useTeamStore";
import { isLeadPaid } from "@/lib/leadStageFlags";

/** Stage IDs that mean the lead has been touched (manager reacted). */
const REACHED_STAGES = new Set(["in_progress", "invoice", "scheduled", "visit", "paid"]);
const SCHEDULED_STAGES = new Set(["scheduled", "visit", "paid"]);
const VISITED_STAGES = new Set(["visit", "paid"]);

// Lead из useCrmStore не имеет stageKey — у него stageId это уже ключ стадии (см. typings).
// Адаптер чтобы единообразно использовать isLeadPaid по проекту с custom-стадиями.
const isPaidLead = (l: Lead): boolean =>
  isLeadPaid({
    paid: (l as { paid?: boolean }).paid,
    paidAt: (l as { paidAt?: string | null }).paidAt ?? null,
    stageKey: l.stageId,
    amount: l.amount,
  });
const isRejectedLead = (l: Lead): boolean => {
  const k = (l.stageId ?? "").toLowerCase().trim();
  return k === "rejected" || k === "refused" || k === "lost" || k === "отказ" || k === "потерян";
};

function minutesSince(iso: string, ref: number = Date.now()): number {
  return Math.max(0, Math.floor((ref - new Date(iso).getTime()) / 60000));
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

function isYesterday(iso: string): boolean {
  const d = new Date(iso);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return (
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate()
  );
}

/** SLA waiting time for a single lead (minutes). */
export function leadSlaMinutes(lead: Lead, ref: number = Date.now()): number {
  if (lead.firstResponseAt) {
    return Math.max(0, Math.floor((new Date(lead.firstResponseAt).getTime() - new Date(lead.createdAt).getTime()) / 60000));
  }
  if (lead.stageId === "new" || lead.stageId === "no_answer") {
    return minutesSince(lead.createdAt, ref);
  }
  return 0;
}

export function slaTone(min: number): "good" | "warn" | "bad" {
  if (min < 5) return "good";
  if (min < 15) return "warn";
  return "bad";
}

export interface CrmKpi {
  newToday: number;
  newYesterday: number;
  avgResponseMin: number; // SLA average across closed responses
  reachedPct: number;
  scheduledPct: number;
  paidPct: number;
  rejectedPct: number;
  topRejectReason?: { id: RejectReason; label: string; count: number };
}

export interface SlaAlertBucket {
  red: Lead[];   // 15+ min
  yellow: Lead[]; // 5-15 min
}

export interface StageMetrics {
  stage: LeadStage;
  count: number;
  potential: number;
  conversionFromPrev: number | null;
  avgTimeMin: number | null;
}

export interface ManagerStats {
  member: TeamMember;
  assigned: number;
  responsesUnder5: number; // count
  respondedTotal: number;
  paid: number;
  conversion: number; // %
  revenue: number;
}

export interface RejectStat {
  id: RejectReason;
  label: string;
  emoji: string;
  count: number;
  lostRevenue: number;
  share: number; // %
}

export interface AiRecommendation {
  level: "hot" | "warm" | "cold";
  label: string;
  emoji: string;
}

export function recommendationFor(score: number): AiRecommendation {
  if (score >= 75) return { level: "hot", label: "Позвонить сейчас", emoji: "🔥" };
  if (score >= 50) return { level: "warm", label: "Дожать через акцию", emoji: "💪" };
  return { level: "cold", label: "Низкий приоритет", emoji: "🧊" };
}

export function expectedRevenue(lead: Lead): number {
  return Math.round((lead.amount || 0) * (lead.aiScore || 0) / 100);
}

export function useCrmAnalytics(
  leads: Lead[],
  stages: LeadStage[],
  members: TeamMember[],
) {
  return useMemo(() => {
    const now = Date.now();
    const total = leads.length || 1;

    const reached = leads.filter((l) => REACHED_STAGES.has(l.stageId)).length;
    const scheduled = leads.filter((l) => SCHEDULED_STAGES.has(l.stageId)).length;
    const paid = leads.filter(isPaidLead).length;
    const rejected = leads.filter(isRejectedLead).length;

    const responded = leads.filter((l) => l.firstResponseAt);
    const avgResponseMin =
      responded.length === 0
        ? 0
        : Math.round(
            responded.reduce((s, l) => s + leadSlaMinutes(l), 0) / responded.length,
          );

    // Reject reasons
    const reasonCounts = new Map<RejectReason, { count: number; lost: number }>();
    for (const l of leads) {
      if (!isRejectedLead(l)) continue;
      const r = l.rejectReason ?? "other";
      const cur = reasonCounts.get(r) ?? { count: 0, lost: 0 };
      cur.count += 1;
      cur.lost += l.amount || 0;
      reasonCounts.set(r, cur);
    }
    const rejectStats: RejectStat[] = REJECT_REASONS.map((r) => {
      const c = reasonCounts.get(r.id) ?? { count: 0, lost: 0 };
      return {
        id: r.id,
        label: r.label,
        emoji: r.emoji,
        count: c.count,
        lostRevenue: c.lost,
        share: rejected ? (c.count / rejected) * 100 : 0,
      };
    })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);

    const topRejectReason = rejectStats[0]
      ? { id: rejectStats[0].id, label: rejectStats[0].label, count: rejectStats[0].count }
      : undefined;

    const kpi: CrmKpi = {
      newToday: leads.filter((l) => isToday(l.createdAt)).length,
      newYesterday: leads.filter((l) => isYesterday(l.createdAt)).length,
      avgResponseMin,
      reachedPct: (reached / total) * 100,
      scheduledPct: (scheduled / total) * 100,
      paidPct: (paid / total) * 100,
      rejectedPct: (rejected / total) * 100,
      topRejectReason,
    };

    // SLA alerts: leads still waiting
    const waiting = leads.filter(
      (l) => !l.firstResponseAt && (l.stageId === "new" || l.stageId === "no_answer"),
    );
    const slaAlerts: SlaAlertBucket = {
      red: waiting.filter((l) => minutesSince(l.createdAt, now) >= 15),
      yellow: waiting.filter((l) => {
        const m = minutesSince(l.createdAt, now);
        return m >= 5 && m < 15;
      }),
    };

    // Stage metrics with conversion + avg time
    const stageMetrics: StageMetrics[] = stages.map((stage, idx) => {
      const inStage = leads.filter((l) => l.stageId === stage.id);
      const count = inStage.length;
      const potential = inStage.reduce((s, l) => s + (l.amount || 0), 0);

      // Avg time IN this stage = (now or next-stage entry) - entry to this stage
      let timeSum = 0, timeCount = 0;
      for (const l of leads) {
        const hist = l.stageHistory ?? [];
        for (let i = 0; i < hist.length; i++) {
          if (hist[i].stageId !== stage.id) continue;
          const enter = new Date(hist[i].at).getTime();
          const leave = i + 1 < hist.length ? new Date(hist[i + 1].at).getTime() : (l.stageId === stage.id ? now : enter);
          if (leave > enter) {
            timeSum += (leave - enter) / 60000;
            timeCount += 1;
          }
        }
      }
      const avgTimeMin = timeCount > 0 ? Math.round(timeSum / timeCount) : null;

      // Conversion from previous stage = (leads who EVER passed through this stage) / (leads who EVER passed through prev)
      let conversionFromPrev: number | null = null;
      if (idx > 0) {
        const prevStage = stages[idx - 1];
        const everPrev = leads.filter((l) =>
          (l.stageHistory ?? []).some((h) => h.stageId === prevStage.id) || l.stageId === prevStage.id,
        ).length;
        const everCur = leads.filter((l) =>
          (l.stageHistory ?? []).some((h) => h.stageId === stage.id) || l.stageId === stage.id,
        ).length;
        conversionFromPrev = everPrev > 0 ? (everCur / everPrev) * 100 : null;
      }

      return { stage, count, potential, conversionFromPrev, avgTimeMin };
    });

    // Manager stats
    const managerStats: ManagerStats[] = members
      .filter((m) => m.role === "manager" || m.role === "admin")
      .map((member) => {
        const own = leads.filter((l) => l.assigneeId === member.id);
        const responded = own.filter((l) => l.firstResponseAt);
        const under5 = responded.filter((l) => leadSlaMinutes(l) < 5).length;
        const paidOwn = own.filter(isPaidLead);
        return {
          member,
          assigned: own.length,
          responsesUnder5: under5,
          respondedTotal: responded.length,
          paid: paidOwn.length,
          conversion: own.length > 0 ? (paidOwn.length / own.length) * 100 : 0,
          revenue: paidOwn.reduce((s, l) => s + (l.amount || 0), 0),
        };
      });

    // Forecast = sum(amount * score/100) for active leads
    const forecast = leads
      .filter((l) => !isPaidLead(l) && !isRejectedLead(l))
      .reduce((s, l) => s + expectedRevenue(l), 0);

    const actual = leads
      .filter((l) => isPaidLead(l) && isThisMonth(l.lastActivityAt))
      .reduce((s, l) => s + (l.amount || 0), 0);

    return { kpi, slaAlerts, stageMetrics, managerStats, rejectStats, forecast, actual };
  }, [leads, stages, members]);
}

function isThisMonth(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}