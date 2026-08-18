import type { LeadLite } from "@/hooks/useLeadsLite";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";
import type { ChannelStat } from "@/components/analytics/ChannelCard";
import { pickCreativeTitle } from "@/lib/creativeDisplay";
import { isLeadPaid } from "@/lib/leadStageFlags";

/** Строка сводки «Источники лидов» — детальный срез по source/channel из CRM. */
export interface SourceBreakdownRow {
  key: string;
  label: string;
  leads: number;
  /** Доля от всех лидов периода, 0–100. */
  share: number;
  hot: number;
  sales: number;
  revenue: number;
  /** Конверсия лид → продажа, 0–100. */
  cr: number;
}

const SOURCE_LABELS: Array<{ rx: RegExp; label: string }> = [
  { rx: /^vit$|vitalya|виталя|vitaly/, label: "Виталя" },
  { rx: /^yuriy$/, label: "Yuriy" },
  { rx: /^dastan$/, label: "Дастан" },
  { rx: /^nadi$/, label: "Нади" },
  { rx: /^astana_hub$|^hub$/, label: "Astana Hub" },
  { rx: /whatsapp|^wa$|wa\.me/, label: "WhatsApp" },
  { rx: /instagram|^ig$|insta|инстаграм/, label: "Инстаграм" },
  { rx: /friends|friend|referral|знаком/, label: "Знакомые" },
  { rx: /^base$|database|база/, label: "База" },
  { rx: /2gis|2гис|gis/, label: "2ГИС" },
  { rx: /telegram|^tg$/, label: "Telegram" },
  { rx: /codeword|код.?слово/, label: "Код-слово Instagram" },
  { rx: /meta|facebook|^fb/, label: "Реклама Meta" },
  { rx: /google|gads/, label: "Google Ads" },
  { rx: /tiktok|^tt$/, label: "TikTok" },
  { rx: /site|web|landing|tilda|form/, label: "Сайт / форма" },
  { rx: /manual|вручную|ручн/, label: "Добавлен вручную" },
];

export function sourceLabel(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "Без источника";
  for (const { rx, label } of SOURCE_LABELS) {
    if (rx.test(v)) return label;
  }
  return raw!.trim();
}

interface PeriodOpts {
  from: number;
  to: number;
  cabinetId?: string;
}

function inPeriod(iso: string, opts: PeriodOpts): boolean {
  const t = new Date(iso).getTime();
  return t >= opts.from && t < opts.to;
}

function cabinetOk(lead: LeadLite, opts: PeriodOpts): boolean {
  return !opts.cabinetId || opts.cabinetId === "all" || lead.cabinetId === opts.cabinetId;
}

/**
 * Срез по источникам CRM. Единая семантика дат с остальной аналитикой:
 * лиды — по createdAt в периоде, продажи/выручка — по paid_at.
 */
export function buildSourceBreakdown(leads: LeadLite[], opts: PeriodOpts): SourceBreakdownRow[] {
  const map = new Map<string, SourceBreakdownRow>();
  const ensure = (raw: string | null | undefined) => {
    const label = sourceLabel(raw);
    const key = label.toLowerCase();
    let cur = map.get(key);
    if (!cur) {
      cur = { key, label, leads: 0, share: 0, hot: 0, sales: 0, revenue: 0, cr: 0 };
      map.set(key, cur);
    }
    return cur;
  };

  let totalLeads = 0;
  for (const lead of leads) {
    if (!cabinetOk(lead, opts)) continue;
    if (inPeriod(lead.createdAt, opts)) {
      const row = ensure(lead.source || lead.channel);
      row.leads += 1;
      totalLeads += 1;
      if (lead.aiScore >= 75 || lead.stageKey === "scheduled" || lead.stageKey === "diagnosed") {
        row.hot += 1;
      }
    }
    if (isLeadPaid(lead)) {
      const paidAt = lead.paidAt ?? lead.lastActivityAt ?? lead.createdAt;
      if (inPeriod(paidAt, opts)) {
        const row = ensure(lead.source || lead.channel);
        row.sales += 1;
        row.revenue += lead.amount || 0;
      }
    }
  }

  for (const row of map.values()) {
    row.share = totalLeads > 0 ? (row.leads / totalLeads) * 100 : 0;
    row.cr = row.leads > 0 ? (row.sales / row.leads) * 100 : 0;
  }

  return Array.from(map.values()).sort(
    (a, b) => b.revenue - a.revenue || b.leads - a.leads || b.sales - a.sales,
  );
}

/** Строка аналитики заявок по сайту, определённому из leads.landing_url. */
export interface SiteBreakdownRow {
  domain: string;
  leads: number;
  share: number;
  sales: number;
  revenue: number;
  cr: number;
}

export function siteDomain(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) return "Сайт не определён";
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || "Сайт не определён";
  } catch {
    return "Сайт не определён";
  }
}

/**
 * Срез по доменам сайтов. Лиды считаются по createdAt, продажи и выручка —
 * по paidAt, как в остальных блоках сквозной аналитики.
 */
export function buildSiteBreakdown(leads: LeadLite[], opts: PeriodOpts): SiteBreakdownRow[] {
  const map = new Map<string, SiteBreakdownRow>();
  const isSiteLead = (lead: LeadLite) =>
    Boolean(lead.landingUrl) || /site|web|landing|tilda|website|form/i.test(lead.source || "");
  const ensure = (landingUrl: string | null) => {
    const domain = siteDomain(landingUrl);
    let row = map.get(domain);
    if (!row) {
      row = { domain, leads: 0, share: 0, sales: 0, revenue: 0, cr: 0 };
      map.set(domain, row);
    }
    return row;
  };

  let totalLeads = 0;
  for (const lead of leads) {
    if (!cabinetOk(lead, opts) || !isSiteLead(lead)) continue;
    if (inPeriod(lead.createdAt, opts)) {
      ensure(lead.landingUrl).leads += 1;
      totalLeads += 1;
    }
    if (isLeadPaid(lead)) {
      const paidAt = lead.paidAt ?? lead.lastActivityAt ?? lead.createdAt;
      if (inPeriod(paidAt, opts)) {
        const row = ensure(lead.landingUrl);
        row.sales += 1;
        row.revenue += lead.amount || 0;
      }
    }
  }

  for (const row of map.values()) {
    row.share = totalLeads > 0 ? (row.leads / totalLeads) * 100 : 0;
    row.cr = row.leads > 0 ? (row.sales / row.leads) * 100 : 0;
  }

  return Array.from(map.values()).sort(
    (a, b) => b.revenue - a.revenue || b.leads - a.leads || b.sales - a.sales,
  );
}

// ---------------- Инсайты периода ----------------

export interface AnalyticsInsight {
  kind: "channel" | "source" | "creative" | "growth";
  title: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "default";
  /** Для креатива — adId, чтобы открыть карточку. */
  adId?: string;
}

const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

export function buildAnalyticsInsights(input: {
  channels: ChannelStat[];
  sources: SourceBreakdownRow[];
  creatives: MetaCreativeRow[];
}): AnalyticsInsight[] {
  const insights: AnalyticsInsight[] = [];

  const activeChannels = input.channels.filter((c) => c.leads > 0 || c.revenue > 0);
  const bestChannel = [...activeChannels].sort(
    (a, b) => b.revenue - a.revenue || b.sales - a.sales || b.leads - a.leads,
  )[0];
  if (bestChannel) {
    insights.push({
      kind: "channel",
      title: "Лучший канал",
      value: bestChannel.meta.label,
      detail: bestChannel.revenue > 0
        ? `${fmtTenge(bestChannel.revenue)} выручки · ${bestChannel.sales} продаж`
        : `${bestChannel.leads} лидов, продаж пока нет`,
      tone: bestChannel.revenue > 0 ? "success" : "default",
    });
  }

  const bestSource = input.sources.filter((s) => s.leads > 0)[0];
  if (bestSource) {
    insights.push({
      kind: "source",
      title: "Лучший источник",
      value: bestSource.label,
      detail: bestSource.revenue > 0
        ? `${fmtTenge(bestSource.revenue)} · конверсия ${bestSource.cr.toFixed(1)}%`
        : `${bestSource.leads} лидов (${Math.round(bestSource.share)}% всех)`,
      tone: bestSource.revenue > 0 ? "success" : "default",
    });
  }

  const activeCreatives = input.creatives.filter((c) => c.spend > 0 || c.crmRevenue > 0);
  const bestCreative = [...activeCreatives].sort(
    (a, b) =>
      (b.crmRevenue - a.crmRevenue)
      || (b.leads + b.messages) - (a.leads + a.messages)
      || b.spend - a.spend,
  )[0];
  if (bestCreative) {
    insights.push({
      kind: "creative",
      title: "Лучший креатив",
      value: pickCreativeTitle({ name: bestCreative.name, headline: bestCreative.headline }).title,
      detail: bestCreative.crmRevenue > 0
        ? `${fmtTenge(bestCreative.crmRevenue)} · ROMI ${bestCreative.crmRomi >= 0 ? "+" : ""}${Math.round(bestCreative.crmRomi)}%`
        : `${Math.max(bestCreative.leads, bestCreative.messages)} заявок · ${fmtTenge(bestCreative.spend)} расход`,
      tone: bestCreative.crmRevenue > 0 ? "success" : "default",
      adId: bestCreative.adId,
    });
  }

  // Точка роста: канал с заметной долей лидов, но без продаж.
  const growth = activeChannels
    .filter((c) => c.leads >= 3 && c.sales === 0)
    .sort((a, b) => b.leads - a.leads)[0];
  if (growth) {
    insights.push({
      kind: "growth",
      title: "Точка роста",
      value: growth.meta.label,
      detail: `${growth.leads} лидов без продаж — проверьте скорость ответа и обработку в CRM`,
      tone: "warning",
    });
  }

  return insights;
}
