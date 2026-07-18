import type {
  ReportCreative,
  ReportData,
  ReportTotals,
} from "@/hooks/useReportData";

export type ReportStatusKey = "growth" | "stable" | "attention" | "no_data";

export interface ReportStatus {
  key: ReportStatusKey;
  label: string;
  description: string;
  tone: "success" | "default" | "warning" | "muted";
}

export interface ReportAction {
  key:
    | "no_data"
    | "revenue_missing"
    | "negative_romi"
    | "bottleneck"
    | "attribution_low"
    | "channel_concentration"
    | "scale_creative";
  title: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "info";
}

export interface ReportBottleneck {
  key: "click_to_lead" | "lead_to_visit" | "visit_to_sale";
  label: string;
  from: number;
  to: number;
  conversion: number;
}

export interface ReportDataHealth {
  score: number;
  metaConnected: boolean;
  crmConnected: boolean;
  revenueConnected: boolean;
  creativeAttribution: number;
}

export interface ReportExecutiveInput {
  data: ReportData;
  comparing: boolean;
}

export interface ReportExecutive {
  status: ReportStatus;
  profit: number;
  deltas: {
    spend: number | null;
    leads: number | null;
    sales: number | null;
    revenue: number | null;
  };
  bottleneck: ReportBottleneck | null;
  dataHealth: ReportDataHealth;
  actions: ReportAction[];
  bestCreative: ReportCreative | null;
}

function pctDelta(current: number, previous: number | undefined): number | null {
  if (previous == null) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function reportStatus(totals: ReportTotals): ReportStatus {
  const hasData =
    totals.spend > 0
    || totals.impressions > 0
    || totals.totalLeads > 0
    || totals.sales > 0
    || totals.revenue > 0;
  if (!hasData) {
    return {
      key: "no_data",
      label: "Нет данных",
      description: "Синхронизируйте рекламу и CRM или измените период.",
      tone: "muted",
    };
  }
  if (totals.spend > 0 && totals.sales > 0 && totals.revenue > totals.spend) {
    return {
      key: "growth",
      label: "Реклама окупается",
      description: "Выручка CRM выше рекламного расхода; результат подтверждён оплатами.",
      tone: "success",
    };
  }
  if (totals.spend > 0 && (totals.revenue === 0 || totals.revenue <= totals.spend)) {
    return {
      key: "attention",
      label: "Требует внимания",
      description: totals.revenue === 0
        ? "Расход есть, но подтверждённой выручки CRM пока нет."
        : "Выручка CRM пока не покрывает рекламный расход.",
      tone: "warning",
    };
  }
  return {
    key: "stable",
    label: "Данные собраны",
    description: "Используйте рекомендации ниже для следующего решения.",
    tone: "default",
  };
}

function findBottleneck(totals: ReportTotals): ReportBottleneck | null {
  const advertisingLeads = totals.adsLeads > 0 ? totals.adsLeads : totals.totalLeads;
  const transitions: ReportBottleneck[] = [
    {
      key: "click_to_lead",
      label: "Клик → заявка",
      from: totals.clicks,
      to: advertisingLeads,
      conversion: totals.clicks > 0 ? Math.min(100, (advertisingLeads / totals.clicks) * 100) : 0,
    },
    {
      key: "lead_to_visit",
      label: "Заявка → диагностика",
      from: totals.totalLeads,
      to: totals.visits,
      conversion: totals.totalLeads > 0 ? Math.min(100, (totals.visits / totals.totalLeads) * 100) : 0,
    },
    {
      key: "visit_to_sale",
      label: "Диагностика → продажа",
      from: totals.visits,
      to: totals.sales,
      conversion: totals.visits > 0 ? Math.min(100, (totals.sales / totals.visits) * 100) : 0,
    },
  ];
  return transitions
    .filter((transition) => transition.from > 0)
    .sort((a, b) => a.conversion - b.conversion)[0] ?? null;
}

function bestCreative(creatives: ReportCreative[]): ReportCreative | null {
  return [...creatives]
    .filter((creative) => creative.spend > 0 || creative.crmRevenue > 0)
    .sort(
      (a, b) =>
        b.crmRevenue - a.crmRevenue
        || b.crmSales - a.crmSales
        || b.leads - a.leads
        || b.spend - a.spend,
    )[0] ?? null;
}

export function buildReportExecutive({
  data,
  comparing,
}: ReportExecutiveInput): ReportExecutive {
  const { totals, prev } = data;
  const bottleneck = findBottleneck(totals);
  const best = bestCreative(data.creatives);
  const attributedCreativeLeads = data.creatives.reduce(
    (sum, creative) => sum + creative.crmLeads,
    0,
  );
  const creativeAttribution = totals.crmLeads > 0
    ? Math.min(100, (attributedCreativeLeads / totals.crmLeads) * 100)
    : 0;
  const metaConnected = totals.spend > 0 || totals.impressions > 0 || totals.clicks > 0;
  const crmConnected = totals.totalLeads > 0 || totals.crmLeads > 0;
  const revenueConnected = totals.sales > 0 || totals.revenue > 0;
  const score = Math.round(
    (metaConnected ? 25 : 0)
    + (crmConnected ? 25 : 0)
    + (revenueConnected ? 25 : 0)
    + creativeAttribution * 0.25,
  );

  const actions: ReportAction[] = [];
  if (reportStatus(totals).key === "no_data") {
    actions.push({
      key: "no_data",
      title: "Подключите источник данных",
      detail: "За период нет рекламы, заявок и оплат. Проверьте кабинет, период и синхронизацию.",
      tone: "info",
    });
  } else {
    if (totals.spend > 0 && totals.revenue === 0) {
      actions.push({
        key: "revenue_missing",
        title: "Проверьте оплаты в CRM",
        detail: "Рекламный расход уже есть, но подтверждённая выручка не передана.",
        tone: "danger",
      });
    } else if (totals.spend > 0 && totals.revenue <= totals.spend) {
      actions.push({
        key: "negative_romi",
        title: "Снизьте стоимость привлечения",
        detail: `Выручка не покрывает расход; текущий ROMI ${Math.round(totals.romi)}%.`,
        tone: "warning",
      });
    }

    if (bottleneck) {
      actions.push({
        key: "bottleneck",
        title: `Узкое место: ${bottleneck.label}`,
        detail: `Конверсия ${bottleneck.conversion.toFixed(1)}% (${bottleneck.to} из ${bottleneck.from}).`,
        tone: bottleneck.conversion < 10 ? "warning" : "info",
      });
    }

    if (totals.crmLeads > 0 && creativeAttribution < 60) {
      actions.push({
        key: "attribution_low",
        title: "Усилите атрибуцию креативов",
        detail: `Только ${Math.round(creativeAttribution)}% CRM-лидов привязано к ad.id.`,
        tone: "warning",
      });
    }

    const topChannel = data.channels[0];
    if (topChannel && topChannel.leads > 0 && topChannel.share >= 70) {
      actions.push({
        key: "channel_concentration",
        title: `Зависимость от канала «${topChannel.name}»`,
        detail: `${topChannel.share.toFixed(0)}% заявок приходит из одного канала — протестируйте второй источник.`,
        tone: "info",
      });
    }

    if (best && best.spend > 0 && best.crmRevenue > best.spend && best.crmSales > 0) {
      actions.push({
        key: "scale_creative",
        title: `Проверьте масштабирование «${best.name}»`,
        detail: `${best.crmSales} продаж, выручка ${Math.round(best.crmRevenue).toLocaleString("ru-RU")} ₸.`,
        tone: "success",
      });
    }
  }

  return {
    status: reportStatus(totals),
    profit: totals.revenue - totals.spend,
    deltas: {
      spend: comparing ? pctDelta(totals.spend, prev?.spend) : null,
      leads: comparing ? pctDelta(totals.totalLeads, prev?.totalLeads) : null,
      sales: comparing ? pctDelta(totals.sales, prev?.sales) : null,
      revenue: comparing ? pctDelta(totals.revenue, prev?.revenue) : null,
    },
    bottleneck,
    dataHealth: {
      score,
      metaConnected,
      crmConnected,
      revenueConnected,
      creativeAttribution,
    },
    actions: actions.slice(0, 4),
    bestCreative: best,
  };
}
