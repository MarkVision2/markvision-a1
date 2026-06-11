// РНП (рука на пульсе) — дневные показатели для «Таблицы показателей».
// Два источника:
//  1. CRM (таблица leads): лидов получено, квал. лиды (скоринг Green API бота),
//     диагностик спланировано (next_visit_at), проведено (дошёл до visit/paid).
//  2. rnp_daily: ручные факты — сумма диагностик, предоплаты, касса
//     и ручные переопределения для «спланировано»/«проведено».
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

/** Лид считается квалифицированным, когда скоринг Green API бота >= порога (0-100). */
export const QUAL_SCORE_MIN = 50;

export interface RnpManualDay {
  id: string;
  diagRevenue: number;
  plannedDiagnostics: number;
  conductedDiagnostics: number;
  prepaymentsCount: number;
  prepaymentsSum: number;
  cashReceived: number;
}

export interface RnpCrmDay {
  /** Лидов реально упало в CRM за день */
  received: number;
  /** Из них квалифицированных (ai_score >= QUAL_SCORE_MIN) */
  qualified: number;
  /** Диагностик запланировано на этот день (next_visit_at) */
  plannedAuto: number;
  /** Из запланированных на день дошли до стадии visit/paid */
  conductedAuto: number;
}

export type RnpManualPatch = Partial<{
  diag_revenue: number;
  planned_diagnostics: number;
  conducted_diagnostics: number;
  prepayments_count: number;
  prepayments_sum: number;
  cash_received: number;
}>;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthBounds(month: string): { since: string; untilExcl: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const idx = Number(m[2]) - 1;
  return {
    since: ymd(new Date(year, idx, 1)),
    untilExcl: ymd(new Date(year, idx + 1, 1)),
  };
}

const toManual = (r: any): RnpManualDay => ({
  id: r.id as string,
  diagRevenue: Number(r.diag_revenue ?? 0),
  plannedDiagnostics: Number(r.planned_diagnostics ?? 0),
  conductedDiagnostics: Number(r.conducted_diagnostics ?? 0),
  prepaymentsCount: Number(r.prepayments_count ?? 0),
  prepaymentsSum: Number(r.prepayments_sum ?? 0),
  cashReceived: Number(r.cash_received ?? 0),
});

/**
 * @param month   "YYYY-MM"
 * @param cabinetDbId uuid кабинета (ad_cabinets.id) для фильтра CRM-лидов, null = все
 */
export function useRnpDaily(month: string, cabinetDbId: string | null) {
  const { activeId } = useProjectsStore();
  const [manualByDate, setManualByDate] = useState<Map<string, RnpManualDay>>(new Map());
  const [crmByDate, setCrmByDate] = useState<Map<string, RnpCrmDay>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);

  const bounds = useMemo(() => monthBounds(month), [month]);

  const refetchManual = useCallback(async () => {
    if (!bounds) return;
    let q = (supabase as any)
      .from("rnp_daily")
      .select("*")
      .gte("date", bounds.since)
      .lt("date", bounds.untilExcl);
    if (activeId) q = q.or(`project_id.eq.${activeId},project_id.is.null`);
    const { data, error } = await q;
    if (error) {
      // Таблица ещё не создана — миграция rnp_daily не применена
      if (/rnp_daily/.test(error.message)) setTableMissing(true);
      return;
    }
    setTableMissing(false);
    const map = new Map<string, RnpManualDay>();
    for (const r of data ?? []) map.set(String(r.date), toManual(r));
    setManualByDate(map);
  }, [bounds?.since, bounds?.untilExcl, activeId]);

  const refetchCrm = useCallback(async () => {
    if (!bounds) return;
    const [stagesRes, leadsRes] = await Promise.all([
      supabase.from("pipeline_stages").select("id,key"),
      (() => {
        let q = supabase
          .from("leads")
          .select("id,created_at,ai_score,stage_id,next_visit_at,cabinet_id,project_id")
          .eq("is_personal", false)
          .or(
            `and(created_at.gte.${bounds.since},created_at.lt.${bounds.untilExcl}),` +
            `and(next_visit_at.gte.${bounds.since},next_visit_at.lt.${bounds.untilExcl})`,
          )
          .limit(5000);
        if (activeId) q = q.or(`project_id.eq.${activeId},project_id.is.null`);
        if (cabinetDbId) q = q.eq("cabinet_id", cabinetDbId);
        return q;
      })(),
    ]);

    const keyById = new Map<string, string>();
    for (const s of stagesRes.data ?? []) keyById.set(s.id as string, s.key as string);

    const map = new Map<string, RnpCrmDay>();
    const day = (iso: string) => {
      const k = ymd(new Date(iso));
      let row = map.get(k);
      if (!row) {
        row = { received: 0, qualified: 0, plannedAuto: 0, conductedAuto: 0 };
        map.set(k, row);
      }
      return row;
    };

    for (const l of leadsRes.data ?? []) {
      const createdAt = l.created_at as string;
      const createdKey = ymd(new Date(createdAt));
      if (createdKey >= bounds.since && createdKey < bounds.untilExcl) {
        const row = day(createdAt);
        row.received += 1;
        if (Number(l.ai_score ?? 0) >= QUAL_SCORE_MIN) row.qualified += 1;
      }
      const visitAt = l.next_visit_at as string | null;
      if (visitAt) {
        const visitKey = ymd(new Date(visitAt));
        if (visitKey >= bounds.since && visitKey < bounds.untilExcl) {
          const row = day(visitAt);
          row.plannedAuto += 1;
          const stageKey = l.stage_id ? keyById.get(l.stage_id as string) : undefined;
          if (stageKey === "visit" || stageKey === "paid") row.conductedAuto += 1;
        }
      }
    }
    setCrmByDate(map);
  }, [bounds?.since, bounds?.untilExcl, activeId, cabinetDbId]);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([refetchManual(), refetchCrm()]);
    } finally {
      setLoading(false);
    }
  }, [refetchManual, refetchCrm]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("leads", refetchCrm, true, 800);

  /** Сохранить ручной факт за день (insert или update) */
  const upsertManual = useCallback(async (isoDate: string, patch: RnpManualPatch) => {
    const clean = Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]),
    );
    const existing = manualByDate.get(isoDate);
    if (existing) {
      const { error } = await (supabase as any)
        .from("rnp_daily")
        .update({ ...clean, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (supabase as any)
        .from("rnp_daily")
        .insert({ project_id: activeId || null, date: isoDate, ...clean });
      if (error) throw new Error(error.message);
    }
    await refetchManual();
  }, [manualByDate, activeId, refetchManual]);

  return { manualByDate, crmByDate, loading, tableMissing, upsertManual, refetch };
}
