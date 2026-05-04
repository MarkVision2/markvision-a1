import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export type FinancePlan = {
  spend: number;
  leads: number;
  cpl: number;
  visits: number;
  sales: number;
  revenue: number;
  avgCheck: number;
  crLeadVisit: number;
  crVisitSale: number;
  savedAt: string;
};

type Store = Record<string, FinancePlan>;

export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const toPlan = (r: any): FinancePlan => ({
  spend: Number(r.spend ?? 0),
  leads: Number(r.leads ?? 0),
  cpl: Number(r.cpl ?? 0),
  visits: Number(r.visits ?? 0),
  sales: Number(r.sales ?? 0),
  revenue: Number(r.revenue ?? 0),
  avgCheck: Number(r.avg_check ?? 0),
  crLeadVisit: Number(r.cr_lead_visit ?? 0),
  crVisitSale: Number(r.cr_visit_sale ?? 0),
  savedAt: r.saved_at,
});

export function useFinancePlans() {
  const { active } = useProjectsStore();
  const [store, setStore] = useState<Store>({});

  const refetch = useCallback(async () => {
    const q = supabase.from("finance_plans").select("*");
    const { data } = active?.id ? await q.eq("project_id", active.id) : await q;
    const next: Store = {};
    (data ?? []).forEach((r: any) => { next[r.month_key] = toPlan(r); });
    setStore(next);
  }, [active?.id]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("finance_plans", refetch);

  const savePlan = useCallback(async (key: string, plan: Omit<FinancePlan, "savedAt">) => {
    await supabase.from("finance_plans").upsert({
      project_id: active?.id ?? null,
      month_key: key,
      spend: plan.spend,
      leads: plan.leads,
      cpl: plan.cpl,
      visits: plan.visits,
      sales: plan.sales,
      revenue: plan.revenue,
      avg_check: plan.avgCheck,
      cr_lead_visit: plan.crLeadVisit,
      cr_visit_sale: plan.crVisitSale,
      saved_at: new Date().toISOString(),
    }, { onConflict: "project_id,month_key" });
    await refetch();
  }, [active?.id, refetch]);

  const getPlan = useCallback((key: string): FinancePlan | undefined => store[key], [store]);

  return { store, savePlan, getPlan };
}
