import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { resolveCdiMetric } from "@/lib/cdiManualOverride";
import { addDaysYmd } from "@/lib/crmLeadDynamics";
import { ymdAlmaty } from "@/lib/metaSync";

export type SpendByDay = Map<string, number>;

/**
 * Расход рекламы по дням (Asia/Almaty date в CDI) для проекта.
 * Источник — cabinet_daily_insights (cron meta-daily-sync).
 * manual_spend перекрывает spend; USD → KZT по последнему fx_rates.
 */
export function useCrmAdSpend(projectId: string | null | undefined) {
  const [byDay, setByDay] = useState<SpendByDay>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [currency] = useState("KZT");

  const window = useMemo(() => {
    const today = ymdAlmaty();
    return { since: addDaysYmd(today, -45), until: today };
  }, []);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setByDay(new Map());
      return;
    }
    setLoading(true);
    try {
      const { data: fx } = await supabase
        .from("fx_rates")
        .select("usd_kzt")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const usdKzt = Number(fx?.usd_kzt ?? 470);

      let q = supabase
        .from("cabinet_daily_insights")
        .select("date, spend, manual_spend, currency, project_id")
        .gte("date", window.since)
        .lte("date", window.until)
        .eq("project_id", projectId);

      const { data, error } = await q;
      if (error) {
        // fallback без manual_spend, если колонки ещё нет
        if (/manual_spend/i.test(error.message)) {
          const legacy = await supabase
            .from("cabinet_daily_insights")
            .select("date, spend, currency, project_id")
            .gte("date", window.since)
            .lte("date", window.until)
            .eq("project_id", projectId);
          if (legacy.error) throw legacy.error;
          const m = new Map<string, number>();
          for (const row of legacy.data ?? []) {
            const raw = Number((row as { spend?: number }).spend ?? 0);
            const cur = String((row as { currency?: string }).currency ?? "KZT").toUpperCase();
            const kzt = cur === "USD" ? raw * usdKzt : raw;
            const day = String((row as { date: string }).date);
            m.set(day, (m.get(day) ?? 0) + kzt);
          }
          setByDay(m);
          return;
        }
        throw error;
      }

      const m = new Map<string, number>();
      for (const row of data ?? []) {
        const spend = resolveCdiMetric(
          (row as { manual_spend?: number | null }).manual_spend,
          Number((row as { spend?: number }).spend) || 0,
        );
        const cur = String((row as { currency?: string }).currency ?? "KZT").toUpperCase();
        const kzt = cur === "USD" ? spend * usdKzt : spend;
        const day = String((row as { date: string }).date);
        m.set(day, (m.get(day) ?? 0) + kzt);
      }
      setByDay(m);
    } catch {
      setByDay(new Map());
    } finally {
      setLoading(false);
    }
  }, [projectId, window.since, window.until]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRealtimeTable("cabinet_daily_insights", () => void refetch());

  return { byDay, loading, currency };
}

export function sumSpendInRange(
  byDay: SpendByDay,
  fromYmd: string,
  toYmd: string,
  focusYmd?: string | null,
): number {
  if (focusYmd) return byDay.get(focusYmd) ?? 0;
  let sum = 0;
  for (const [day, spend] of byDay) {
    if (day >= fromYmd && day <= toYmd) sum += spend;
  }
  return sum;
}

export function cplFromSpend(spend: number, leads: number): number {
  if (leads <= 0 || spend <= 0) return 0;
  return spend / leads;
}

export function fmtCrmTenge(n: number): string {
  if (!n || n <= 0) return "—";
  return `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;
}
