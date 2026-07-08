import { useEffect, useMemo, useState } from "react";
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
  stage_title: string | null;
  stage_key: string | null;
  is_terminal: boolean | null;
  is_diagnostic: boolean | null;
  paid: boolean;
  paid_at: string | null;
  amount: number;
  diagnostic_amount: number | null;
  source: string | null;
  channel: string | null;
}

export interface CreativeFunnel {
  ok: boolean;
  ad_id: string;
  pipeline_id: string | null;
  campaign_name: string | null;
  destination_type: string | null;
  objective: string | null;
  stages: FunnelStage[];
  recent_leads: FunnelLead[];
  total_leads: number;
  diagnostics: number;
  diagnostic_revenue: number;
  paid_count: number;
  revenue: number;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeAdIds(adIds: string | string[] | null): string[] {
  if (!adIds) return [];
  const raw = Array.isArray(adIds) ? adIds : [adIds];
  return Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
}

function mergeCreativeFunnels(items: CreativeFunnel[]): CreativeFunnel | null {
  if (items.length === 0) return null;
  const base = items[0];
  if (items.length === 1) return base;

  const stagesMap = new Map<string, FunnelStage>();
  for (const item of items) {
    for (const stage of item.stages) {
      const cur = stagesMap.get(stage.stage_id);
      if (cur) cur.count += stage.count;
      else stagesMap.set(stage.stage_id, { ...stage });
    }
  }

  const leadsMap = new Map<string, FunnelLead>();
  for (const item of items) {
    for (const lead of item.recent_leads) leadsMap.set(lead.id, lead);
  }
  const recent_leads = Array.from(leadsMap.values()).sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || ""),
  );

  const campaignNames = Array.from(
    new Set(items.map((i) => i.campaign_name).filter((n): n is string => Boolean(n?.trim()))),
  );

  return {
    ok: true,
    ad_id: items.map((i) => i.ad_id).join(","),
    pipeline_id: base.pipeline_id,
    campaign_name: campaignNames.length === 1 ? campaignNames[0] : campaignNames.join(" · "),
    destination_type: base.destination_type,
    objective: base.objective,
    stages: Array.from(stagesMap.values()).sort((a, b) => a.order_index - b.order_index),
    recent_leads,
    total_leads: recent_leads.length,
    diagnostics: items.reduce((sum, i) => sum + (i.diagnostics ?? 0), 0),
    diagnostic_revenue: items.reduce((sum, i) => sum + (i.diagnostic_revenue ?? 0), 0),
    paid_count: items.reduce((sum, i) => sum + (i.paid_count ?? 0), 0),
    revenue: items.reduce((sum, i) => sum + (i.revenue ?? 0), 0),
  };
}

export function useCreativeFunnel(adIds: string | string[] | null, range: { from: Date; to: Date }) {
  const ids = useMemo(() => normalizeAdIds(adIds), [adIds]);
  const [data, setData] = useState<CreativeFunnel | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ids.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const since = ymd(range.from);
      const until = ymd(range.to);
      const results = await Promise.all(
        ids.map(async (adId) => {
          const { data: res, error } = await (supabase as unknown as {
            rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: CreativeFunnel | null; error: unknown }>;
          }).rpc("get_creative_funnel", {
            p_ad_id: adId,
            p_since: since,
            p_until: until,
          });
          if (error) {
            console.error("get_creative_funnel error", adId, error);
            return null;
          }
          return res;
        }),
      );
      if (cancelled) return;
      const ok = results.filter((r): r is CreativeFunnel => Boolean(r?.ok));
      setData(mergeCreativeFunnels(ok));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ids.join(","), range.from.getTime(), range.to.getTime()]);

  return { data, loading };
}
