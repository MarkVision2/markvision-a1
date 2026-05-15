import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export type MonthAgg = {
  revenue: number; // KZT, from paid agency clients (pay_date month)
  spend: number;   // KZT, total ad spend across cabinets (in KZT, USD converted)
};

type Store = Record<number, MonthAgg>; // monthIdx 0..11

/**
 * Единая агрегация финансов за год:
 *  - Выручка = paid агентские клиенты, у которых pay_date в этом месяце.
 *  - Расходы = сумма spend из cabinet_daily_insights за этот месяц
 *    (USD автоматически конвертируется в KZT по последнему курсу).
 */
export function useMonthlyAggregates(year: number) {
  const { active } = useProjectsStore();
  const [data, setData] = useState<Store>(() => emptyStore());

  const refetch = useCallback(async () => {
    const next = emptyStore();

    // 1) Курс USD→KZT
    const { data: fx } = await supabase
      .from("fx_rates")
      .select("usd_kzt")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const usdKzt = Number(fx?.usd_kzt ?? 470);

    // 2) Расходы из cabinet_daily_insights
    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;
    let q = supabase
      .from("cabinet_daily_insights")
      .select("date, spend, currency, project_id")
      .gte("date", start)
      .lt("date", end);
    if (active?.id) q = q.eq("project_id", active.id);
    const { data: cdi } = await q;
    (cdi ?? []).forEach((r: any) => {
      const m = new Date(r.date).getMonth();
      const raw = Number(r.spend ?? 0);
      const kzt = (r.currency ?? "KZT") === "USD" ? raw * usdKzt : raw;
      next[m].spend += kzt;
    });

    // 3) Выручка из агентских клиентов (paid, pay_date в этом году)
    const { data: clients } = await supabase
      .from("agency_clients")
      .select("id, status, pay_date, agency_client_services(price)")
      .eq("status", "paid")
      .gte("pay_date", start)
      .lt("pay_date", end);
    (clients ?? []).forEach((c: any) => {
      if (!c.pay_date) return;
      const m = new Date(c.pay_date).getMonth();
      const sum = (c.agency_client_services ?? []).reduce(
        (s: number, sv: any) => s + Number(sv.price ?? 0), 0,
      );
      next[m].revenue += sum;
    });

    setData(next);
  }, [active?.id, year]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("cabinet_daily_insights", refetch);
  useRealtimeTable("agency_clients", refetch);
  useRealtimeTable("agency_client_services", refetch);

  return { data, refetch };
}

function emptyStore(): Store {
  const s: Store = {} as Store;
  for (let i = 0; i < 12; i++) s[i] = { revenue: 0, spend: 0 };
  return s;
}
