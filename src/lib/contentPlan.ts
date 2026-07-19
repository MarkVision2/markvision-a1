import { Film, Images, Clock, type LucideIcon } from "lucide-react";

export type ContentPlanType = "REELS" | "CAROUSEL" | "IMAGE" | "STORIES";

export type ContentPlanStatus =
  | "idea"
  | "in_progress"
  | "ready"
  | "scheduled"
  | "published"
  | "error";

export type ContentPlanCategory =
  | "content"
  | "sales"
  | "case"
  | "ai"
  | "personal"
  | "reviews"
  | "errors"
  | "news";

export const CONTENT_PLAN_TYPE_META: Record<
  ContentPlanType,
  { label: string; emoji: string; icon: LucideIcon }
> = {
  REELS: { label: "Reels", emoji: "🎬", icon: Film },
  CAROUSEL: { label: "Карусель", emoji: "🖼", icon: Images },
  IMAGE: { label: "Пост", emoji: "📷", icon: Images },
  STORIES: { label: "Stories", emoji: "📖", icon: Clock },
};

export const CONTENT_PLAN_STATUS_META: Record<
  ContentPlanStatus,
  { label: string; cls: string }
> = {
  idea: { label: "Идея", cls: "bg-muted text-muted-foreground" },
  in_progress: { label: "В работе", cls: "bg-amber-500/10 text-amber-700" },
  ready: { label: "Готов", cls: "bg-sky-500/10 text-sky-700" },
  scheduled: { label: "Запланирован", cls: "bg-violet-500/10 text-violet-700" },
  published: { label: "Опубликован", cls: "bg-emerald-500/10 text-emerald-700" },
  error: { label: "Ошибка", cls: "bg-destructive/10 text-destructive" },
};

export const CONTENT_PLAN_CATEGORY_META: Record<ContentPlanCategory, { label: string }> = {
  content: { label: "Контент" },
  sales: { label: "Продажи" },
  case: { label: "Кейс" },
  ai: { label: "AI" },
  personal: { label: "Личный бренд" },
  reviews: { label: "Отзывы" },
  errors: { label: "Ошибки" },
  news: { label: "Новости" },
};

export interface ContentPlanPlatforms {
  instagram: boolean;
  facebook: boolean;
  threads: boolean;
  telegram: boolean;
  linkedin: boolean;
}

export interface ContentPlanFunnel {
  reach: number;
  views: number;
  likes: number;
  saves: number;
  shares: number;
  /** Только пользовательские комментарии (из IG insights / media). */
  comments: number;
  codewordHits: number;
  messagesSent: number;
  messagesOpened: number;
  linkClicks: number;
  registrations: number;
  whatsappJoined: number;
  webinarAttended: number;
  deposits: number;
  paid: number;
  revenue: number;
  adSpend: number;
}

export interface ContentPlanItem {
  id: string;
  projectId: string;
  title: string;
  category: ContentPlanCategory;
  contentType: ContentPlanType;
  status: ContentPlanStatus;
  description: string | null;
  hashtags: string | null;
  prompts: string | null;
  commentsNotes: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  childUrls: string[];
  scheduledAt: string | null;
  publishedAt: string | null;
  platforms: ContentPlanPlatforms;
  autopostId: string | null;
  igMediaId: string | null;
  codewordId: string | null;
  codeword: string | null;
  utmContent: string | null;
  adSpend: number;
  aiAnalysis: string | null;
  createdAt: string;
  updatedAt: string;
  /** Live metrics merged from IG + organic + CRM. */
  funnel: ContentPlanFunnel;
  /** Synthetic row from autopost/codeword without content_plan_items row. */
  synthetic?: boolean;
  source?: "plan" | "autopost" | "codeword" | "ig_media";
}

export interface ContentPlanSummary {
  total: number;
  scheduled: number;
  awaitingCreation: number;
  published: number;
  avgReach: number;
  avgCodewordComments: number;
  leads: number;
  registrations: number;
  webinarAttended: number;
  paid: number;
  revenue: number;
}

/** Дата, по которой публикация попадает в период: выход → план → создание. */
export function contentPlanItemAnchorAt(item: ContentPlanItem): string | null {
  return item.publishedAt ?? item.scheduledAt ?? item.createdAt ?? null;
}

export function filterContentPlanByPeriod(
  items: ContentPlanItem[],
  range: { from: Date; to: Date },
): ContentPlanItem[] {
  const fromTs = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()).getTime();
  const toExclusive = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
  toExclusive.setDate(toExclusive.getDate() + 1);
  const toTs = toExclusive.getTime();

  return items.filter((item) => {
    const iso = contentPlanItemAnchorAt(item);
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    return t >= fromTs && t < toTs;
  });
}

export function summarizeContentPlan(items: ContentPlanItem[]): ContentPlanSummary {
  const total = items.length;
  const scheduled = items.filter((i) => i.status === "scheduled").length;
  const awaitingCreation = items.filter((i) =>
    ["idea", "in_progress", "ready"].includes(i.status),
  ).length;
  const published = items.filter((i) => i.status === "published").length;
  const pub = items.filter((i) => i.status === "published");
  const avgReach =
    pub.length > 0 ? Math.round(pub.reduce((s, i) => s + i.funnel.reach, 0) / pub.length) : 0;
  const avgCodewordComments =
    pub.length > 0
      ? Math.round(pub.reduce((s, i) => s + i.funnel.codewordHits, 0) / pub.length)
      : 0;
  return {
    total,
    scheduled,
    awaitingCreation,
    published,
    avgReach,
    avgCodewordComments,
    leads: items.reduce((s, i) => s + i.funnel.linkClicks, 0),
    registrations: items.reduce((s, i) => s + i.funnel.registrations, 0),
    webinarAttended: items.reduce((s, i) => s + i.funnel.webinarAttended, 0),
    paid: items.reduce((s, i) => s + i.funnel.paid, 0),
    revenue: items.reduce((s, i) => s + i.funnel.revenue, 0),
  };
}

export function emptyFunnel(adSpend = 0): ContentPlanFunnel {
  return {
    reach: 0,
    views: 0,
    likes: 0,
    saves: 0,
    shares: 0,
    comments: 0,
    codewordHits: 0,
    messagesSent: 0,
    messagesOpened: 0,
    linkClicks: 0,
    registrations: numberOr0(0),
    whatsappJoined: 0,
    webinarAttended: 0,
    deposits: 0,
    paid: 0,
    revenue: 0,
    adSpend,
  };
}

function numberOr0(n: number) {
  return n;
}

export function funnelRoi(f: ContentPlanFunnel): number | null {
  if (f.adSpend <= 0) return null;
  return Math.round(((f.revenue - f.adSpend) / f.adSpend) * 1000) / 10;
}

export function funnelStepRate(from: number, to: number): number | null {
  if (from <= 0) return null;
  return Math.round((to / from) * 1000) / 10;
}
