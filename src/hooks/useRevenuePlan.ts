import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export function monthKey(d: Date = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Store = Record<string, number>;

export function useRevenuePlan() {
  const { active } = useProjectsStore();
  const [store, setStore] = useState<Store>({});

  const refetch = useCallback(async () => {
    const q = supabase.from("revenue_plan").select("*");
    const { data } = active?.id ? await q.eq("project_id", active.id) : await q;
    const next: Store = {};
    (data ?? []).forEach((r: any) => { next[r.month_key] = Number(r.value ?? 0); });
    setStore(next);
  }, [active?.id]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("revenue_plan", refetch);

  const setForMonth = useCallback(async (key: string, value: number) => {
    setStore((p) => ({ ...p, [key]: value })); // optimistic
    await supabase.from("revenue_plan").upsert({
      project_id: active?.id ?? null,
      month_key: key,
      value,
    }, { onConflict: "project_id,month_key" });
  }, [active?.id]);

  return { store, setForMonth };
}
