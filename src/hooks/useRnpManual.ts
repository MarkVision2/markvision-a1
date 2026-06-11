// Ручные РНП-факты по дням из таблицы rnp_daily (project + date):
// предоплаты (шт и сумма). Таблица создаётся миграцией
// supabase/migrations/20260611090000_rnp_daily.sql.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export interface RnpManualDay {
  id: string;
  prepayCount: number;
  prepaySum: number;
}

export type RnpManualPatch = Partial<{
  prepayments_count: number;
  prepayments_sum: number;
}>;

function monthBounds(month: string): { since: string; untilExcl: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const idx = Number(m[2]) - 1;
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { since: ymd(new Date(year, idx, 1)), untilExcl: ymd(new Date(year, idx + 1, 1)) };
}

/** @param month "YYYY-MM" */
export function useRnpManual(month: string) {
  const { activeId } = useProjectsStore();
  const [byDate, setByDate] = useState<Map<string, RnpManualDay>>(new Map());
  const [tableMissing, setTableMissing] = useState(false);

  const bounds = useMemo(() => monthBounds(month), [month]);

  const refetch = useCallback(async () => {
    if (!bounds) return;
    let q = (supabase as any)
      .from("rnp_daily")
      .select("id,date,prepayments_count,prepayments_sum")
      .gte("date", bounds.since)
      .lt("date", bounds.untilExcl);
    if (activeId) q = q.or(`project_id.eq.${activeId},project_id.is.null`);
    const { data, error } = await q;
    if (error) {
      // Таблица не создана — миграция rnp_daily ещё не применена к базе.
      if (/rnp_daily/i.test(error.message)) setTableMissing(true);
      return;
    }
    setTableMissing(false);
    const map = new Map<string, RnpManualDay>();
    for (const r of data ?? []) {
      map.set(String(r.date), {
        id: r.id as string,
        prepayCount: Number(r.prepayments_count ?? 0),
        prepaySum: Number(r.prepayments_sum ?? 0),
      });
    }
    setByDate(map);
  }, [bounds?.since, bounds?.untilExcl, activeId]);

  useEffect(() => { void refetch(); }, [refetch]);

  /** Сохранить ручной факт за день (insert или update). null = сбросить в 0. */
  const upsert = useCallback(async (isoDate: string, patch: RnpManualPatch) => {
    const clean = Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]),
    );
    const existing = byDate.get(isoDate);
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
    await refetch();
  }, [byDate, activeId, refetch]);

  return { byDate, tableMissing, upsert, refetch };
}
