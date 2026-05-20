import { classifyGoal, type MetaCampaignRow } from "@/hooks/useMetaStructure";

export type DashboardChannelProvider =
  | "meta"
  | "google"
  | "instagram_organic"
  | "crm"
  | "site"
  | "whatsapp"
  | "lead_form"
  | "messages";

export interface DashboardChannel {
  key: string;
  name: string;
  provider: DashboardChannelProvider;
  spend: number;
  leads: number;
  sales: number;
  revenue: number;
}

type CampaignSourceKey = "site" | "whatsapp" | "lead_form" | "messages";

const CAMPAIGN_SOURCE_META: Record<CampaignSourceKey, {
  key: CampaignSourceKey;
  name: string;
  provider: DashboardChannelProvider;
}> = {
  site: { key: "site", name: "Сайт", provider: "site" },
  whatsapp: { key: "whatsapp", name: "WhatsApp", provider: "whatsapp" },
  lead_form: { key: "lead_form", name: "Лид-форма Meta", provider: "lead_form" },
  messages: { key: "messages", name: "Direct / Messenger", provider: "messages" },
};

function sourceKeyForCampaign(campaign: MetaCampaignRow): CampaignSourceKey | null {
  const goal = classifyGoal(campaign.objective, campaign.destinationType);
  if (goal.key === "leads_pixel" || goal.key === "leads") return "site";
  if (goal.key === "leads_form") return "lead_form";
  if (goal.key === "whatsapp") return "whatsapp";
  if (goal.key === "messages") return "messages";
  return null;
}

function successfulRequests(campaign: MetaCampaignRow) {
  const goal = classifyGoal(campaign.objective, campaign.destinationType);
  if (goal.successMetric === "messages") return campaign.messages;
  if (goal.successMetric === "purchases") return campaign.purchases;
  if (goal.successMetric === "leads") return campaign.leads;
  return 0;
}

function shouldReplaceGenericMeta(channels: DashboardChannel[], campaignSources: Map<CampaignSourceKey, DashboardChannel>) {
  if (campaignSources.size === 0) return false;
  const campaignSpend = Array.from(campaignSources.values()).reduce((sum, c) => sum + c.spend, 0);
  const campaignLeads = Array.from(campaignSources.values()).reduce((sum, c) => sum + c.leads, 0);
  return channels.some((c) => (c.key === "meta" || c.key === "facebook") && (campaignSpend > 0 || campaignLeads > 0));
}

export function mergeChannelsWithMetaCampaignGoals(
  channels: DashboardChannel[],
  campaigns: MetaCampaignRow[],
): DashboardChannel[] {
  const campaignSources = new Map<CampaignSourceKey, DashboardChannel>();

  for (const campaign of campaigns) {
    const sourceKey = sourceKeyForCampaign(campaign);
    if (!sourceKey) continue;

    const meta = CAMPAIGN_SOURCE_META[sourceKey];
    const current = campaignSources.get(sourceKey) ?? {
      key: meta.key,
      name: meta.name,
      provider: meta.provider,
      spend: 0,
      leads: 0,
      sales: 0,
      revenue: 0,
    };

    current.spend += campaign.spend;
    current.leads += successfulRequests(campaign);
    current.sales += campaign.purchases;
    current.revenue += campaign.revenue;
    campaignSources.set(sourceKey, current);
  }

  const replaceGenericMeta = shouldReplaceGenericMeta(channels, campaignSources);
  const byKey = new Map<string, DashboardChannel>();

  for (const channel of channels) {
    if (replaceGenericMeta && (channel.key === "meta" || channel.key === "facebook")) continue;
    byKey.set(channel.key, { ...channel });
  }

  for (const [key, source] of campaignSources) {
    if (source.leads <= 0 && source.spend <= 0) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...source });
      continue;
    }

    byKey.set(key, {
      ...current,
      name: source.name,
      provider: source.provider,
      spend: Math.max(current.spend, source.spend),
      leads: Math.max(current.leads, source.leads),
      sales: Math.max(current.sales, source.sales),
      revenue: Math.max(current.revenue, source.revenue),
    });
  }

  return Array.from(byKey.values())
    .filter((channel) => channel.leads > 0 || channel.spend > 0)
    .sort((a, b) => {
      if (b.leads !== a.leads) return b.leads - a.leads;
      return b.spend - a.spend;
    });
}
