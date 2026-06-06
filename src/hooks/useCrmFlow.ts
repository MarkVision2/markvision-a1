import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  fetchLeadsLite,
  LEADS_LITE_QUERY_KEY,
  type LeadLite,
} from "./useLeadsLite";
import { useProjectsStore } from "./useProjectsStore";
import { useRealtimeTable } from "./useRealtimeTable";
import { isLeadPaid } from "@/lib/leadStageFlags";

// "Закрытая" стадия — paid или rejected. Лиды в таких стадиях считаются обработанными:
// они не попадают в активные / SLA / распределение по стадиям.
function isClosedLead(l: LeadLite): boolean {
  if (isLeadPaid(l)) return true;
  const k = (l.stageKey ?? "").toLowerCase().trim();
  return k === "rejected" || k === "refused" || k === "lost" || k === "отказ" || k === "потерян";
}
function isRejectedLead(l: LeadLite): boolean {
  const k = (l.stageKey ?? "").toLowerCase().trim();
  return k === "rejected" || k === "refused" || k === "lost" || k === "отказ" || k === "потерян";
}

interface Range { from: Date; to: Date }

export interface SlaMetrics {
  /** Среднее время до первого касания (минут). */
  avgResponseMin: number;
  /** Медианное время до первого касания (минут). */
  medResponseMin: number;
  /** Процент лидов с откликом за ≤ 5 минут. */
  pctUnder5: number;
  /** Процент лидов с откликом за ≤ 15 минут. */
  pctUnder15: number;
  /** Сколько лидов ещё не получили ответ (не paid/rejected, без firstResponseAt). */
  awaitingFirstTouch: number;
  /** Из них — старше 15 минут. */
  awaitingOver15: number;
}

export interface StageBucket {
  stageId: string;
  stageKey: string;
  title: string;
  color: string;
  icon: string;
  count: number;
  /** Среднее время «висения» в текущем этапе (часы) — для активных лидов. */
  avgHoursStuck: number;
  /** Максимум среди активных — самый долго висящий лид (часы). */
  maxHoursStuck: number;
}

export interface RejectReasonRow {
  reason: string;
  label: string;
  count: number;
  share: number;
}

interface StageInfo {
  id: string;
  key: string;
  title: string;
  color: string;
  icon: string;
  isTerminal: boolean;
  orderIndex: number;
}

interface LossReasonInfo {
  key: string;
  label: string;
  emoji: string | null;
}

function minutesBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000);
}
function hoursBetween(a: string | Date, b: string | Date): number {
  const at = typeof a === "string" ? new Date(a).getTime() : a.getTime();
  const bt = typeof b === "string" ? new Date(b).getTime() : b.getTime();
  return Math.max(0, (bt - at) / 3_600_000);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useCrmFlow(range: Range, leadsOverride?: LeadLite[]) {
  const { activeId: projectId } = useProjectsStore();
  const hasOverride = leadsOverride !== undefined;
  const { data: fetchedLeads = [] } = useQuery({
    queryKey: [LEADS_LITE_QUERY_KEY, projectId],
    queryFn: hasOverride ? skipToken : () => fetchLeadsLite(projectId),
  });
  const liteLeads = leadsOverride ?? fetchedLeads;
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [reasons, setReasons] = useState<LossReasonInfo[]>([]);
  const [stageEnteredAt, setStageEnteredAt] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0);

  useRealtimeTable("lead_status_history", () => setTick((t) => t + 1), true, 1500);
  useRealtimeTable("pipeline_stages", () => setTick((t) => t + 1), true, 1500);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stagesRes, reasonsRes] = await Promise.all([
        supabase.from("pipeline_stages").select("id, key, title, color, icon, is_terminal, order_index"),
        supabase.from("loss_reasons").select("key, label, emoji"),
      ]);
      if (cancelled) return;
      setStages((stagesRes.data ?? []).map((s) => ({
        id: s.id as string,
        key: s.key as string,
        title: s.title as string,
        color: s.color as string,
        icon: s.icon as string,
        isTerminal: !!(s as { is_terminal?: boolean }).is_terminal,
        orderIndex: Number((s as { order_index?: number }).order_index ?? 0),
      })));
      setReasons((reasonsRes.data ?? []).map((r) => ({
        key: r.key as string,
        label: r.label as string,
        emoji: ((r as { emoji?: string | null }).emoji ?? null) as string | null,
      })));
    })();
    return () => { cancelled = true; };
  }, [tick]);

  // Для всех активных (не paid / не rejected) лидов в проекте подгружаем
  // последний переход в текущий stage — чтобы знать, сколько часов лид «висит».
  useEffect(() => {
    if (!projectId) {
      setStageEnteredAt(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const activeLeadIds = liteLeads
        .filter((l) => !isClosedLead(l))
        .map((l) => l.id);
      if (activeLeadIds.length === 0) {
        setStageEnteredAt(new Map());
        return;
      }
      // Подгрузим всю историю активных лидов; обычно история короткая.
      const { data } = await supabase
        .from("lead_status_history")
        .select("lead_id, to_stage_id, changed_at")
        .in("lead_id", activeLeadIds)
        .order("changed_at", { ascending: false })
        .limit(5000);
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ lead_id: string; to_stage_id: string; changed_at: string }>) {
        const lead = liteLeads.find((l) => l.id === row.lead_id);
        if (!lead) continue;
        // Берём последний переход именно В текущий stage этого лида.
        if (lead.stageId && row.to_stage_id === lead.stageId && !map.has(row.lead_id)) {
          map.set(row.lead_id, row.changed_at);
        }
      }
      setStageEnteredAt(map);
    })();
    return () => { cancelled = true; };
  }, [projectId, liteLeads, tick]);

  const sinceKey = useMemo(() => ymd(range.from), [range.from]);
  const untilKey = useMemo(() => ymd(range.to), [range.to]);

  const inRangeLeads = useMemo<LeadLite[]>(() => {
    const fromTs = range.from.getTime();
    const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
    return liteLeads.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= fromTs && t < toTs;
    });
  }, [liteLeads, range.from, range.to, sinceKey, untilKey]);

  // SLA — считаем по лидам периода, у которых есть firstResponseAt.
  const sla = useMemo<SlaMetrics>(() => {
    const responded = inRangeLeads.filter((l) => l.firstResponseAt);
    const respMinutes = responded.map((l) => minutesBetween(l.createdAt, l.firstResponseAt as string));
    const avg = respMinutes.length > 0 ? respMinutes.reduce((s, m) => s + m, 0) / respMinutes.length : 0;
    const med = median(respMinutes);
    const under5 = respMinutes.filter((m) => m <= 5).length;
    const under15 = respMinutes.filter((m) => m <= 15).length;
    const pctUnder5 = responded.length > 0 ? (under5 / responded.length) * 100 : 0;
    const pctUnder15 = responded.length > 0 ? (under15 / responded.length) * 100 : 0;

    const now = Date.now();
    const awaiting = inRangeLeads.filter((l) =>
      !l.firstResponseAt && !isClosedLead(l),
    );
    const awaitingOver15 = awaiting.filter(
      (l) => (now - new Date(l.createdAt).getTime()) / 60000 > 15,
    ).length;

    return {
      avgResponseMin: avg,
      medResponseMin: med,
      pctUnder5,
      pctUnder15,
      awaitingFirstTouch: awaiting.length,
      awaitingOver15,
    };
  }, [inRangeLeads]);

  // Распределение по этапам: учитываем ВСЕ активные лиды (не только из периода),
  // потому что «висит N часов» — это вопрос текущего состояния воронки,
  // а не лидов созданных в выбранном окне.
  const stageBuckets = useMemo<StageBucket[]>(() => {
    if (stages.length === 0) return [];
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const stageByKey = new Map(stages.map((s) => [s.key, s]));
    const groups = new Map<string, { stage: StageInfo; hours: number[] }>();
    const now = Date.now();
    for (const l of liteLeads) {
      // Терминальные стадии не показываем (paid, rejected) — для распределения.
      if (isClosedLead(l)) continue;
      let stage: StageInfo | undefined;
      if (l.stageId) stage = stageById.get(l.stageId);
      if (!stage) stage = stageByKey.get(l.stageKey);
      if (!stage) continue;
      const enteredAt = stageEnteredAt.get(l.id) ?? l.createdAt;
      const hours = Math.max(0, (now - new Date(enteredAt).getTime()) / 3_600_000);
      const cur = groups.get(stage.id) ?? { stage, hours: [] as number[] };
      cur.hours.push(hours);
      groups.set(stage.id, cur);
    }
    const list: StageBucket[] = [];
    for (const { stage, hours } of groups.values()) {
      const avg = hours.length > 0 ? hours.reduce((s, h) => s + h, 0) / hours.length : 0;
      const max = hours.length > 0 ? Math.max(...hours) : 0;
      list.push({
        stageId: stage.id,
        stageKey: stage.key,
        title: stage.title,
        color: stage.color,
        icon: stage.icon,
        count: hours.length,
        avgHoursStuck: avg,
        maxHoursStuck: max,
      });
    }
    list.sort((a, b) => {
      const sa = stages.find((s) => s.id === a.stageId)?.orderIndex ?? 0;
      const sb = stages.find((s) => s.id === b.stageId)?.orderIndex ?? 0;
      return sa - sb;
    });
    return list;
  }, [liteLeads, stages, stageEnteredAt]);

  // Топ-5 причин отказов — по лидам из периода, у которых stageKey='rejected'.
  const topRejectReasons = useMemo<RejectReasonRow[]>(() => {
    const fromTs = range.from.getTime();
    const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
    const rejected = liteLeads.filter((l) => {
      if (!isRejectedLead(l)) return false;
      // По дате отказа, если есть; иначе по созданию.
      const t = new Date(l.rejectedAt ?? l.createdAt).getTime();
      return t >= fromTs && t < toTs;
    });
    const counts = new Map<string, number>();
    for (const l of rejected) {
      const key = (l.rejectReason ?? "").trim().toLowerCase() || "unspecified";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const labelOf = (key: string) => {
      const r = reasons.find((x) => x.key === key);
      if (r) return r.emoji ? `${r.emoji} ${r.label}` : r.label;
      if (key === "unspecified") return "Без указания";
      return key;
    };
    const total = rejected.length;
    return Array.from(counts.entries())
      .map(([reason, count]) => ({
        reason,
        label: labelOf(reason),
        count,
        share: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [liteLeads, range.from, range.to, reasons]);

  const activeLeadsTotal = useMemo(
    () => liteLeads.filter((l) => !isClosedLead(l)).length,
    [liteLeads],
  );

  return { sla, stageBuckets, topRejectReasons, activeLeadsTotal, periodLeadsTotal: inRangeLeads.length };
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1 мин";
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const h = minutes / 60;
  if (h < 24) return `${h.toFixed(1)} ч`;
  return `${(h / 24).toFixed(1)} дн`;
}

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} мин`;
  if (hours < 24) return `${hours.toFixed(1)} ч`;
  return `${(hours / 24).toFixed(1)} дн`;
}
