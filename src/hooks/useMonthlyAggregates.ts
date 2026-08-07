import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export type MonthAgg = {
  /** Оплаты агентских клиентов MarkVision (pay_date). */
  agencyRevenue: number;
  /** Выручка клиники из CRM: сумма amount у оплаченных лидов (paid_at). */
  clinicRevenue: number;
  /** Рекламный расход по кабинетам проекта (KZT). */
  spend: number;
  /** @deprecated alias → agencyRevenue (совместимость). */
  revenue: number;
};

type Store = Record<number, MonthAgg>; // monthIdx 0..11

/**
 * Единая агрегация финансов за год:
 *  - agencyRevenue = paid агентские клиенты (pay_date).
 *  - clinicRevenue = CRM paid leads (paid_at + amount).
 *  - spend = cabinet_daily_insights (USD→KZT).
 */
export function useMonthlyAggregates(year: number) {
  const { active } = useProjectsStore();
  const [data, setData] = useState<Store>(() => emptyStore());

  const refetch = useCallback(async () => {
    const next = emptyStore();

    const { data: fx } = await supabase
      .from("fx_rates")
      .select("usd_kzt")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const usdKzt = Number(fx?.usd_kzt ?? 470);

    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;

    // 1) Рекламный расход
    let q = supabase
      .from("cabinet_daily_insights")
      .select("date, spend, currency, project_id")
      .gte("date", start)
      .lt("date", end);
    if (active?.id) q = q.eq("project_id", active.id);
    const { data: cdi } = await q;
    (cdi ?? []).forEach((r: { date: string; spend?: number | null; currency?: string | null }) => {
      const m = new Date(r.date).getMonth();
      const raw = Number(r.spend ?? 0);
      const kzt = (r.currency ?? "KZT") === "USD" ? raw * usdKzt : raw;
      next[m].spend += kzt;
    });

    // 2) Выручка агентства
    const { data: clients } = await supabase
      .from("agency_clients")
      .select("id, status, pay_date, agency_client_services(price)")
      .eq("status", "paid")
      .gte("pay_date", start)
      .lt("pay_date", end);
    (clients ?? []).forEach((c: {
      pay_date?: string | null;
      agency_client_services?: { price?: number | null }[] | null;
    }) => {
      if (!c.pay_date) return;
      const m = new Date(c.pay_date).getMonth();
      const sum = (c.agency_client_services ?? []).reduce(
        (s, sv) => s + Number(sv.price ?? 0),
        0,
      );
      next[m].agencyRevenue += sum;
      next[m].revenue += sum;
    });

    // 3) Выручка клиники (CRM продажи) — для план vs факт из «Декомпозиции»
    let leadsQ = supabase
      .from("leads")
      .select("amount, paid_at, paid, is_personal, project_id")
      .eq("paid", true)
      .eq("is_personal", false)
      .gte("paid_at", start)
      .lt("paid_at", end);
    if (active?.id) leadsQ = leadsQ.eq("project_id", active.id);
    const { data: paidLeads } = await leadsQ;
    (paidLeads ?? []).forEach((l: { paid_at?: string | null; amount?: number | null }) => {
      if (!l.paid_at) return;
      const m = new Date(l.paid_at).getMonth();
      next[m].clinicRevenue += Number(l.amount ?? 0);
    });

    setData(next);
  }, [active?.id, year]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("cabinet_daily_insights", refetch);
  useRealtimeTable("agency_clients", refetch);
  useRealtimeTable("agency_client_services", refetch);
  useRealtimeTable("leads", refetch);

  return { data, refetch };
}

function emptyStore(): Store {
  const s: Store = {} as Store;
  for (let i = 0; i < 12; i++) {
    s[i] = { agencyRevenue: 0, clinicRevenue: 0, spend: 0, revenue: 0 };
  }
  return s;
}
