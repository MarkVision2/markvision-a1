import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export type MonthlyEntry = {
  revenue: number;
  spend: number;
};

type Store = Record<string, MonthlyEntry>;

export const monthlyKey = (year: number, monthIdx0: number) =>
  `${year}-${String(monthIdx0 + 1).padStart(2, "0")}`;

export function useMonthlyFinance() {
  const { active } = useProjectsStore();
  const [store, setStore] = useState<Store>({});

  const refetch = useCallback(async () => {
    const q = supabase.from("monthly_finance").select("*");
    const { data, error } = active?.id ? await q.eq("project_id", active.id) : await q;
    if (error) {
      console.warn("[useMonthlyFinance] select failed", error);
      return;
    }
    const next: Store = {};
    (data ?? []).forEach((r: any) => {
      next[r.month_key] = { revenue: Number(r.revenue ?? 0), spend: Number(r.spend ?? 0) };
    });
    setStore(next);
  }, [active?.id]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("monthly_finance", refetch);

  const setEntry = useCallback(async (key: string, entry: Partial<MonthlyEntry>) => {
    const prev = store[key] ?? { revenue: 0, spend: 0 };
    const merged = { ...prev, ...entry };
    const { error } = await supabase.from("monthly_finance").upsert({
      project_id: active?.id ?? null,
      month_key: key,
      revenue: merged.revenue,
      spend: merged.spend,
    }, { onConflict: "project_id,month_key" });
    if (error) {
      console.error("[useMonthlyFinance] upsert failed", error);
      throw error;
    }
    await refetch();
  }, [active?.id, store, refetch]);

  return { store, setEntry };
}
