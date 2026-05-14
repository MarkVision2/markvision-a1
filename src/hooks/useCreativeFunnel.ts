import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FunnelStage {
  stage_id: string;
  key: string;
  title: string;
  order_index: number;
  is_terminal: boolean;
  is_diagnostic: boolean;
  count: number;
}

export interface FunnelLead {
  id: string;
  name: string;
  phone: string;
  created_at: string;
  stage_id: string;
  paid: boolean;
  amount: number;
}

export interface CreativeFunnel {
  ok: boolean;
  ad_id: string;
  pipeline_id: string | null;
  stages: FunnelStage[];
  recent_leads: FunnelLead[];
  total_leads: number;
  paid_count: number;
  revenue: number;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useCreativeFunnel(adId: string | null, range: { from: Date; to: Date }) {
  const [data, setData] = useState<CreativeFunnel | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!adId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data: res, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: CreativeFunnel | null; error: unknown }>;
      }).rpc("get_creative_funnel", {
        p_ad_id: adId,
        p_since: ymd(range.from),
        p_until: ymd(range.to),
      });
      if (cancelled) return;
      if (error) {
        console.error("get_creative_funnel error", error);
        setData(null);
      } else {
        setData(res);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [adId, range.from.getTime(), range.to.getTime()]);

  return { data, loading };
}
