// Split meta_campaign_daily by destination (site / whatsapp) for the Analytics funnel.
// - Site campaigns are grouped by ad_cabinets.website_url so different landing pages
//   show their own click→lead conversion separately.
// - WhatsApp/messenger campaigns are aggregated, using the `messages` metric instead
//   of `leads` (Meta inflates `leads` with messages for messaging campaigns).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export interface SiteSplitRow {
  url: string;
  label: string;
  spend: number;
  clicks: number;
  leads: number;
  cr: number; // %, leads / clicks
}

export interface WhatsappSplit {
  spend: number;
  clicks: number;
  messages: number;
  cr: number; // %, messages / clicks
}

export interface DestinationSplit {
  sites: SiteSplitRow[];
  siteTotals: { spend: number; clicks: number; leads: number; cr: number };
  whatsapp: WhatsappSplit;
}

const EMPTY: DestinationSplit = {
  sites: [],
  siteTotals: { spend: 0, clicks: 0, leads: 0, cr: 0 },
  whatsapp: { spend: 0, clicks: 0, messages: 0, cr: 0 },
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function monthRange(month: string): { since: string; until: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const idx = Number(m[2]) - 1;
  const first = new Date(Date.UTC(year, idx, 1));
  const last = new Date(Date.UTC(year, idx + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(first), until: fmt(last) };
}

const isWhatsappDest = (d: string | null | undefined) => {
  if (!d) return false;
  const u = d.toUpperCase();
  return u.includes("WHATSAPP") || u.includes("MESSENG");
};
const isWebsiteDest = (d: string | null | undefined) => {
  if (!d) return false;
  const u = d.toUpperCase();
  return u === "WEBSITE" || u === "ON_AD" || u === "WEBSITE_OR_AD";
};

export function useDestinationSplit(
  cabinetIds: string[] | null, // null = all cabinets in project
  month: string,
  enabled = true,
) {
  const { activeId: projectId } = useProjectsStore();
  const [data, setData] = useState<DestinationSplit>(EMPTY);
  const [loading, setLoading] = useState(false);
  const key = (cabinetIds ?? []).join(",");

  useEffect(() => {
    if (!enabled) {
      setData(EMPTY);
      return;
    }
    const range = monthRange(month);
    if (!range) {
      setData(EMPTY);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // 1) cabinets in scope, with website_url
      let cabQ = supabase
        .from("ad_cabinets_safe" as any)
        .select("id, name, website_url")
        .eq("provider", "meta");
      if (projectId) cabQ = cabQ.eq("project_id", projectId);
      if (cabinetIds && cabinetIds.length > 0) cabQ = cabQ.in("id", cabinetIds);
      const { data: cabsRaw } = await cabQ;
      const cabs = ((cabsRaw ?? []) as unknown) as Array<{ id: string; name: string | null; website_url: string | null }>;
      const cabMeta = new Map<string, { url: string; name: string }>();
      for (const c of cabs) {
        cabMeta.set(c.id, {
          url: c.website_url ?? "",
          name: c.name ?? "",
        });
      }
      if (cabMeta.size === 0) {
        if (!cancelled) { setData(EMPTY); setLoading(false); }
        return;
      }

      // 2) campaign daily metrics + destination type
      let mcdQ = supabase
        .from("meta_campaign_daily")
        .select("campaign_id, cabinet_id, spend, clicks, leads, messages")
        .gte("date", range.since)
        .lte("date", range.until)
        .in("cabinet_id", Array.from(cabMeta.keys()));
      if (projectId) mcdQ = mcdQ.eq("project_id", projectId);
      const { data: mcd } = await mcdQ;

      // 3) destination_type lookup
      const campaignIds = Array.from(new Set((mcd ?? []).map((r) => r.campaign_id as string)));
      const destMap = new Map<string, string | null>();
      if (campaignIds.length > 0) {
        const { data: camps } = await supabase
          .from("meta_campaigns")
          .select("campaign_id, destination_type")
          .in("campaign_id", campaignIds);
        for (const c of camps ?? []) {
          destMap.set(c.campaign_id as string, (c as { destination_type?: string | null }).destination_type ?? null);
        }
      }

      const sites = new Map<string, SiteSplitRow>();
      const wa: WhatsappSplit = { spend: 0, clicks: 0, messages: 0, cr: 0 };
      const siteTotals = { spend: 0, clicks: 0, leads: 0, cr: 0 };

      for (const row of mcd ?? []) {
        const dest = destMap.get(row.campaign_id as string);
        const spend = Number(row.spend ?? 0);
        const clicks = Number(row.clicks ?? 0);
        const leads = Number(row.leads ?? 0);
        const messages = Number(row.messages ?? 0);

        if (isWhatsappDest(dest)) {
          wa.spend += spend;
          wa.clicks += clicks;
          // For WA/messenger campaigns, prefer messages; fall back to leads if 0.
          wa.messages += messages > 0 ? messages : leads;
        } else if (isWebsiteDest(dest) || dest === null) {
          // Treat unknown destination as website by default.
          const cab = cabMeta.get(row.cabinet_id as string);
          const url = cab?.url || cab?.name || "Без сайта";
          const key = url;
          const cur = sites.get(key) ?? {
            url,
            label: hostLabel(url),
            spend: 0, clicks: 0, leads: 0, cr: 0,
          };
          // For site campaigns subtract messages from leads (sync sums them together).
          const pureLeads = Math.max(leads - messages, 0);
          cur.spend += spend;
          cur.clicks += clicks;
          cur.leads += pureLeads;
          sites.set(key, cur);
          siteTotals.spend += spend;
          siteTotals.clicks += clicks;
          siteTotals.leads += pureLeads;
        }
      }
      wa.cr = wa.clicks > 0 ? (wa.messages / wa.clicks) * 100 : 0;
      siteTotals.cr = siteTotals.clicks > 0 ? (siteTotals.leads / siteTotals.clicks) * 100 : 0;
      const siteRows = Array.from(sites.values())
        .map((r) => ({ ...r, cr: r.clicks > 0 ? (r.leads / r.clicks) * 100 : 0 }))
        .sort((a, b) => b.spend - a.spend);

      if (!cancelled) {
        setData({ sites: siteRows, siteTotals, whatsapp: wa });
        setLoading(false);
      }
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key, month, enabled, projectId]);

  return { data, loading };
}
