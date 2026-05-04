import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ReportSchedule = "daily" | "weekdays" | "weekly_mon" | "monthly";
export type ReportPeriod = "yesterday" | "last_7d" | "last_30d";

export interface ReportSubscription {
  id: string;
  name: string;
  chat_id: string;
  schedule: ReportSchedule;
  send_hour: number;
  cabinet_ids: string[];
  period: ReportPeriod;
  enabled: boolean;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useReportSubscriptions() {
  const [items, setItems] = useState<ReportSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("report_subscriptions")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setItems(
        data.map((d) => ({
          ...d,
          cabinet_ids: Array.isArray(d.cabinet_ids)
            ? (d.cabinet_ids as string[])
            : [],
        })) as ReportSubscription[],
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: Omit<ReportSubscription, "id" | "created_at" | "updated_at" | "last_sent_at">) => {
      const { error } = await supabase.from("report_subscriptions").insert({
        name: input.name,
        chat_id: input.chat_id,
        schedule: input.schedule,
        send_hour: input.send_hour,
        cabinet_ids: input.cabinet_ids,
        period: input.period,
        enabled: input.enabled,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, patch: Partial<ReportSubscription>) => {
      const { error } = await supabase
        .from("report_subscriptions")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("report_subscriptions")
        .delete()
        .eq("id", id);
      if (error) throw error;
      await refresh();
    },
    [refresh],
  );

  return { items, loading, refresh, create, update, remove };
}