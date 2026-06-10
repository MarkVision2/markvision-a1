import type { ReportTotals } from "@/hooks/useReportData";
import type { LeadLite } from "@/hooks/useLeadsLite";
import { classifyGoal } from "@/hooks/useMetaStructure";
import { resolveLeadSource, type SourceKey } from "@/lib/leadSource";
import { isLeadPaid } from "@/lib/leadStageFlags";

export type DashboardChannelKey = "whatsapp" | "site" | "instagram" | "google" | "tiktok";

export interface DashboardChannelRow {
  key: string;
  name: string;
  provider: DashboardChannelKey;
  spend: number;
  leads: number;
  sales: number;
  revenue: number;
}

export interface MetaCampaignLeadSlice {
  objective: string | null;
  destinationType: string | null;
  leads: number;
  messages: number;
  spend?: number;
}

const BUCKET_LABELS: Record<DashboardChannelKey, string> = {
  whatsapp: "WhatsApp",
  site: "Сайт",
  instagram: "Instagram",
  google: "Google Ads",
  tiktok: "TikTok Ads",
};

/** Канал дашборда из нормализованного source key. */
export function sourceKeyToDashboardChannel(key: SourceKey): DashboardChannelKey {
  if (key === "whatsapp" || key === "telegram") return "whatsapp";
  if (key === "instagram" || key === "instagram_organic") return "instagram";
  if (key === "google") return "google";
  if (key === "tiktok") return "tiktok";
  return "site";
}

/** Meta Ads: заявки/сообщения по типу кампании (WhatsApp vs сайт/форма). */
export function computeMetaLeadsSplit(campaigns: MetaCampaignLeadSlice[]): { whatsapp: number; site: number } {
  let whatsapp = 0;
  let site = 0;
  for (const c of campaigns) {
    const goal = classifyGoal(c.objective, c.destinationType);
    const isMessaging =
      goal.key === "whatsapp"
      || goal.key === "messages"
      || goal.successMetric === "messages";
    if (isMessaging) {
      whatsapp += c.messages > 0 ? c.messages : c.leads;
    } else {
      site += c.leads;
    }
  }
  return { whatsapp, site };
}

interface ProviderAgg {
  provider: string;
  spend: number;
  leads: number;
}

interface BuildChannelsInput {
  leads: LeadLite[];
  totals: ReportTotals | undefined;
  providerAgg: ProviderAgg[];
  fromTs: number;
  toTs: number;
  igOrganicLeads?: number;
  igOrganicSales?: number;
  igOrganicRevenue?: number;
  metaCampaigns?: MetaCampaignLeadSlice[];
}

/**
 * Источники заявок: CRM-лиды + Meta Ads (WhatsApp / сайт) по типу кампании,
 * чтобы сумма каналов ≈ totals.totalLeads в воронке.
 */
export function buildDashboardChannels(input: BuildChannelsInput): DashboardChannelRow[] {
  const { leads, totals, providerAgg, fromTs, toTs } = input;
  const buckets = new Map<DashboardChannelKey, DashboardChannelRow>();
  const ensure = (k: DashboardChannelKey) => {
    let cur = buckets.get(k);
    if (!cur) {
      cur = { key: k, name: BUCKET_LABELS[k], provider: k, spend: 0, leads: 0, sales: 0, revenue: 0 };
      buckets.set(k, cur);
    }
    return cur;
  };

  const inRange = leads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= fromTs && t < toTs;
  });

  const paidInRange = leads.filter((l) => {
    if (!isLeadPaid(l)) return false;
    const paidAt = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
    const t = new Date(paidAt).getTime();
    return t >= fromTs && t < toTs;
  });

  for (const l of inRange) {
    const src = resolveLeadSource(l);
    ensure(sourceKeyToDashboardChannel(src.key)).leads += 1;
  }

  for (const l of paidInRange) {
    const b = ensure(sourceKeyToDashboardChannel(resolveLeadSource(l).key));
    b.sales += 1;
    b.revenue += l.amount || 0;
  }

  // Instagram organic (код-слова)
  if ((input.igOrganicLeads ?? 0) > 0 || (input.igOrganicSales ?? 0) > 0) {
    const ig = ensure("instagram");
    ig.leads += input.igOrganicLeads ?? 0;
    ig.sales += input.igOrganicSales ?? 0;
    ig.revenue += input.igOrganicRevenue ?? 0;
  }

  const metaSplit = computeMetaLeadsSplit(input.metaCampaigns ?? []);
  const adsLeads = totals?.adsLeads ?? 0;
  const crmLeadCount = inRange.length + (input.igOrganicLeads ?? 0);
  const wa = ensure("whatsapp");
  const site = ensure("site");

  // Meta-лиды без CRM: распределяем по WhatsApp / Сайт из структуры кампаний
  const metaSplitTotal = metaSplit.whatsapp + metaSplit.site;
  if (adsLeads > 0 && metaSplitTotal > 0) {
    const targetWa = Math.round(adsLeads * (metaSplit.whatsapp / metaSplitTotal));
    const targetSite = adsLeads - targetWa;
    wa.leads = Math.max(wa.leads, targetWa);
    site.leads = Math.max(site.leads, targetSite);
  } else {
    const metaGap = Math.max(0, adsLeads - crmLeadCount);
    if (metaGap > 0) {
      site.leads += metaGap;
    }
  }

  // Расход по провайдерам CDI
  const metaSpend = providerAgg
    .filter((a) => a.provider !== "google" && a.provider !== "instagram_organic")
    .reduce((s, a) => s + a.spend, 0);
  const googleSpend = providerAgg
    .filter((a) => a.provider === "google")
    .reduce((s, a) => s + a.spend, 0);

  const metaLeadTotal = wa.leads + site.leads;
  if (metaSpend > 0 && metaLeadTotal > 0) {
    const waShare = metaSplitTotal > 0 ? metaSplit.whatsapp / metaSplitTotal : wa.leads / metaLeadTotal;
    wa.spend += metaSpend * waShare;
    site.spend += metaSpend * (1 - waShare);
  } else if (metaSpend > 0) {
    site.spend += metaSpend;
  }

  if (googleSpend > 0) {
    ensure("google").spend += googleSpend;
  }

  // Диагностическая выручка без продаж — в канал «Сайт» (Meta лид-формы)
  const diagOnlyRevenue = Math.max(
    0,
    (totals?.revenue ?? 0) - buckets.values().reduce((s, b) => s + b.revenue, 0),
  );
  if (diagOnlyRevenue > 0) {
    site.revenue += diagOnlyRevenue;
  }

  // Показываем WhatsApp + Сайт, если Meta-кампании есть (даже при 0 заявок в одном канале)
  if (metaSplitTotal > 0) {
    ensure("whatsapp");
    ensure("site");
  }

  return ["whatsapp", "site", "instagram", "google", "tiktok"]
    .map((k) => buckets.get(k as DashboardChannelKey))
    .filter((b): b is DashboardChannelRow => !!b && (b.leads > 0 || b.spend > 0 || b.sales > 0 || b.revenue > 0));
}
