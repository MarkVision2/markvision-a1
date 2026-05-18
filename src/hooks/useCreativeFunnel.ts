import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

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

interface LeadRow {
  id: string;
  name: string;
  phone: string;
  project_id: string | null;
  pipeline_id: string | null;
  stage_id: string;
  amount: number | string | null;
  created_at: string;
  updated_at: string;
  paid: boolean | null;
  paid_at: string | null;
  meta_ad_id: string | null;
  utm: { content?: string | null } | null;
}

interface StageRow {
  id: string;
  pipeline_id: string;
  key: string | null;
  title: string | null;
  order_index: number | null;
  is_terminal: boolean | null;
  is_diagnostic: boolean | null;
}

function cleanToken(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function numericMetaId(value: string) {
  return value.match(/\d{6,}/)?.[0] ?? null;
}

function isInRange(value: string | null | undefined, from: Date, to: Date) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= from.getTime() && time <= to.getTime();
}

function leadMatchesAd(lead: LeadRow, adId: string) {
  if (lead.meta_ad_id === adId) return true;
  const content = cleanToken(lead.utm?.content);
  return !!content && numericMetaId(content) === adId;
}

export function useCreativeFunnel(adId: string | null, range: { from: Date; to: Date }) {
  const { activeId: projectId } = useProjectsStore();
  const [data, setData] = useState<CreativeFunnel | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useRealtimeTable("leads", () => setTick((t) => t + 1), !!adId, 800);
  useRealtimeTable("deals", () => setTick((t) => t + 1), !!adId, 800);

  useEffect(() => {
    if (!adId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      let leadsQuery = supabase
        .from("leads")
        .select("id, name, phone, project_id, pipeline_id, stage_id, amount, created_at, updated_at, paid, paid_at, meta_ad_id, utm")
        .eq("is_personal", false)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (projectId) {
        leadsQuery = leadsQuery.or(`project_id.eq.${projectId},project_id.is.null`);
      }

      const [leadsRes, stagesRes] = await Promise.all([
        leadsQuery,
        supabase
          .from("pipeline_stages")
          .select("id, pipeline_id, key, title, order_index, is_terminal, is_diagnostic")
          .order("order_index", { ascending: true }),
      ]);
      if (cancelled) return;

      const matched = ((leadsRes.data ?? []) as LeadRow[]).filter((lead) => leadMatchesAd(lead, adId));
      const createdInRange = matched.filter((lead) => isInRange(lead.created_at, range.from, range.to));
      const paidInRange = matched.filter((lead) => !!lead.paid && isInRange(lead.paid_at ?? lead.updated_at, range.from, range.to));
      const visibleLeads = [...createdInRange, ...paidInRange.filter((lead) => !createdInRange.some((l) => l.id === lead.id))];

      const pipelineId =
        createdInRange[0]?.pipeline_id ??
        matched[0]?.pipeline_id ??
        null;
      const stages = ((stagesRes.data ?? []) as StageRow[])
        .filter((stage) => !pipelineId || stage.pipeline_id === pipelineId)
        .map((stage) => ({
          stage_id: stage.id,
          key: stage.key ?? "",
          title: stage.title ?? stage.key ?? "Этап",
          order_index: stage.order_index ?? 0,
          is_terminal: !!stage.is_terminal,
          is_diagnostic: !!stage.is_diagnostic,
          count: createdInRange.filter((lead) => lead.stage_id === stage.id).length,
        }));

      const recent = visibleLeads
        .slice()
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 10)
        .map((lead) => ({
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          created_at: lead.created_at,
          stage_id: lead.stage_id,
          paid: !!lead.paid,
          amount: Number(lead.amount) || 0,
        }));

      setData({
        ok: true,
        ad_id: adId,
        pipeline_id: pipelineId,
        stages,
        recent_leads: recent,
        total_leads: createdInRange.length,
        paid_count: paidInRange.length,
        revenue: paidInRange.reduce((sum, lead) => sum + (Number(lead.amount) || 0), 0),
      });
      setLoading(false);
    })().catch((error) => {
      console.error("useCreativeFunnel error", error);
      if (!cancelled) {
        setData(null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adId, projectId, range.from.getTime(), range.to.getTime(), tick]);

  return { data, loading };
}
