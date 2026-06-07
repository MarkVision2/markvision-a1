import type { ReportCreative } from "@/hooks/useReportData";

const TAG_LABELS: Record<string, string> = {
  video: "Видео",
  image: "Фото",
  carousel: "Карусель",
  wa: "WhatsApp",
  site: "Сайт",
  ai: "AI",
};

export interface ParsedCreativeName {
  title: string;
  tags: string[];
  full: string;
}

/** Человекочитаемое имя из технической строки Meta (`hook | video | wa | …`). */
export function parseCreativeDisplayName(name: string): ParsedCreativeName {
  const full = name.trim();
  const parts = full.split("|").map((s) => s.trim()).filter(Boolean);
  const raw = parts[0] || full;
  const title = raw
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tags = parts.slice(1).map((t) => {
    const key = t.toLowerCase();
    return TAG_LABELS[key] ?? t;
  });

  return { title: title || "Без названия", tags, full };
}

export interface ReportCreativeSections {
  withRevenue: ReportCreative[];
  topActive: ReportCreative[];
  totalWithRevenue: number;
  totalActive: number;
}

/** Делит креативы на «приносят выручку» и «активные без выручки». */
export function buildReportCreativeSections(
  creatives: ReportCreative[],
  limit = 5,
): ReportCreativeSections {
  const withRevenue = creatives
    .filter((c) => c.crmRevenue > 0)
    .sort((a, b) => (b.crmRevenue - a.crmRevenue) || (b.crmSales - a.crmSales) || (b.spend - a.spend))
    .slice(0, limit);

  const shown = new Set(withRevenue.map((c) => c.adId));
  const topActive = creatives
    .filter((c) => !shown.has(c.adId) && (c.spend > 0 || c.leads > 0))
    .sort((a, b) => (b.spend - a.spend) || (b.leads - a.leads) || (b.ctr - a.ctr))
    .slice(0, limit);

  return {
    withRevenue,
    topActive,
    totalWithRevenue: creatives.filter((c) => c.crmRevenue > 0).length,
    totalActive: creatives.filter((c) => c.crmRevenue === 0 && (c.spend > 0 || c.leads > 0)).length,
  };
}

export function creativeCpl(c: ReportCreative): number | null {
  if (c.leads <= 0 || c.spend <= 0) return null;
  return c.spend / c.leads;
}

export function creativeRomi(c: ReportCreative): number | null {
  if (c.spend <= 0 || c.crmRevenue <= 0) return null;
  return ((c.crmRevenue - c.spend) / c.spend) * 100;
}
