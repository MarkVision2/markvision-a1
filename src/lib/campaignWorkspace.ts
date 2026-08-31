import { classifyGoal, type MetaCampaignRow } from "@/hooks/useMetaStructure";

export type CampaignStatusFilter = "all" | "active" | "paused";

export interface CampaignWorkspaceFilters {
  status: CampaignStatusFilter;
  query: string;
}

export interface CampaignWorkspaceSummary {
  totalCampaigns: number;
  activeCampaigns: number;
  spend: number;
  results: number;
  crmRevenue: number;
  crmProfit: number;
  crmSales: number;
  goalCount: number;
  hasCrm: boolean;
}

export interface CampaignLaunchRow {
  id: string;
  cabinetId: string | null;
  goal: string;
  budget: string | null;
  text: string | null;
  status: string | null;
  statusStep: string | null;
  statusMessage: string | null;
  lastError: string | null;
  metaCampaignId: string | null;
  createdAt: string;
}

export function buildCampaignWorkspaceSummary(rows: MetaCampaignRow[]): CampaignWorkspaceSummary {
  const goals = new Set(rows.map((row) => classifyGoal(row.objective, row.destinationType).key));
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const crmRevenue = rows.reduce((sum, row) => sum + row.crmRevenue, 0);
  const results = rows.reduce((sum, row) => {
    const goal = classifyGoal(row.objective, row.destinationType);
    if (goal.successMetric === "leads") return sum + row.leads;
    if (goal.successMetric === "messages") return sum + row.messages;
    if (goal.successMetric === "purchases") return sum + row.purchases;
    if (goal.successMetric === "clicks") return sum + row.clicks;
    return sum + row.impressions;
  }, 0);

  return {
    totalCampaigns: rows.length,
    activeCampaigns: rows.filter((row) => row.effectiveStatus === "ACTIVE").length,
    spend,
    results,
    crmRevenue,
    crmProfit: crmRevenue - spend,
    crmSales: rows.reduce((sum, row) => sum + row.crmSales, 0),
    goalCount: goals.size,
    hasCrm: crmRevenue > 0,
  };
}

export function filterCampaignRows(
  rows: MetaCampaignRow[],
  filters: CampaignWorkspaceFilters,
): MetaCampaignRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status === "active" && row.effectiveStatus !== "ACTIVE") return false;
    if (filters.status === "paused" && row.effectiveStatus === "ACTIVE") return false;
    if (!query) return true;
    const haystack = [
      row.name,
      row.campaignId,
      row.objective ?? "",
      row.destinationType ?? "",
      classifyGoal(row.objective, row.destinationType).label,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function launchStatusLabel(launch: CampaignLaunchRow): string {
  const status = (launch.status ?? "").toLowerCase();
  if (status === "queued") return "В очереди на запуск";
  if (status === "running" || status === "processing") {
    if (launch.statusStep) return `Запускается · ${humanizeStep(launch.statusStep)}`;
    return "Запускается в Meta";
  }
  if (status === "success" || status === "done" || status === "completed") {
    return launch.metaCampaignId ? "Запущена в Meta" : "Готово";
  }
  if (status === "error" || status === "failed") {
    return launch.lastError ? `Ошибка: ${launch.lastError}` : "Ошибка запуска";
  }
  return launch.statusMessage || launch.status || "Статус неизвестен";
}

function humanizeStep(step: string): string {
  const value = step.toLowerCase();
  if (value.includes("campaign")) return "создаётся кампания";
  if (value.includes("adset")) return "создаётся адсет";
  if (value.includes("creative") || value.includes("ad")) return "создаётся объявление";
  if (value.includes("upload")) return "загрузка креатива";
  return step.replace(/_/g, " ");
}

export function launchGoalLabel(goal: string): string {
  if (goal === "whatsapp") return "WhatsApp";
  if (goal === "site-leads") return "Лиды с сайта";
  if (goal === "meta-form") return "Форма Meta";
  return goal;
}
