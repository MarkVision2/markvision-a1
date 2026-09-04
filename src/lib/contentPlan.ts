import { Film, Images, Clock, type LucideIcon } from "lucide-react";
import { todayAlmatyYmd } from "@/lib/metricsPeriod";

/** Старт измерения контент-плана (Алматы): публикации раньше не показываем и не считаем. */
export const CONTENT_PLAN_STATS_START_YMD = "2026-07-20";

export function contentPlanStatsStartMs(): number {
  return new Date(`${CONTENT_PLAN_STATS_START_YMD}T00:00:00+05:00`).getTime();
}

/** Порог импорта/отображения: max(сегодня Алматы, фиксированный старт). */
export function contentPlanMeasureStartMs(now = new Date()): number {
  const todayMs = new Date(`${todayAlmatyYmd(now)}T00:00:00+05:00`).getTime();
  return Math.max(todayMs, contentPlanStatsStartMs());
}

export function isBeforeContentPlanStatsStart(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < contentPlanStatsStartMs();
}

export type ContentPlanType = "REELS" | "CAROUSEL" | "IMAGE" | "STORIES";

export type ContentPlanStatus =
  | "idea"
  | "in_progress"
  | "ready"
  | "scheduled"
  | "published"
  | "error"
  | "failed"
  | "cancelled";

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
  // Контент-конвейер (AI-видео): попытки исчерпаны / отменено пользователем.
  failed: { label: "Не удалось", cls: "bg-destructive/10 text-destructive" },
  cancelled: { label: "Отменено", cls: "bg-muted text-muted-foreground" },
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
  published: number;
  /** Суммарный охват опубликованных за период. */
  totalReach: number;
  /** Сумма срабатываний код-слова (комменты + DM). */
  codewordHits: number;
  /** Клики по ссылке из Direct. */
  linkClicks: number;
  /** Лиды / заявки. */
  registrations: number;
  webinarAttended: number;
  paid: number;
  revenue: number;
  /** Суммарный расход на рекламу по публикациям периода. */
  adSpend: number;
}

/** Дата, по которой публикация попадает в период. */
export function contentPlanItemAnchorAt(item: ContentPlanItem): string | null {
  // Запланированные — по дате плана, иначе «завтра» пропадает, если есть старый publishedAt.
  if (item.status === "scheduled" || item.status === "idea" || item.status === "in_progress" || item.status === "ready") {
    return item.scheduledAt ?? item.createdAt ?? item.publishedAt ?? null;
  }
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
  const floorTs = contentPlanStatsStartMs();

  return items.filter((item) => {
    const iso = contentPlanItemAnchorAt(item);
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    // Жёсткий пол: до 20.07.2026 не показываем и не считаем в KPI.
    if (t < floorTs) return false;
    return t >= fromTs && t < toTs;
  });
}

export function summarizeContentPlan(items: ContentPlanItem[]): ContentPlanSummary {
  const total = items.length;
  const scheduled = items.filter((i) => i.status === "scheduled").length;
  const published = items.filter((i) => i.status === "published").length;
  const pub = items.filter((i) => i.status === "published");
  // Воронка и расход — только по опубликованным (черновики/слоты без media не раздувают KPI).
  return {
    total,
    scheduled,
    published,
    totalReach: pub.reduce((s, i) => s + i.funnel.reach, 0),
    codewordHits: pub.reduce((s, i) => s + i.funnel.codewordHits, 0),
    linkClicks: pub.reduce((s, i) => s + i.funnel.linkClicks, 0),
    registrations: pub.reduce((s, i) => s + i.funnel.registrations, 0),
    webinarAttended: pub.reduce((s, i) => s + i.funnel.webinarAttended, 0),
    paid: pub.reduce((s, i) => s + i.funnel.paid, 0),
    revenue: pub.reduce((s, i) => s + i.funnel.revenue, 0),
    adSpend: pub.reduce((s, i) => s + (i.funnel.adSpend || i.adSpend || 0), 0),
  };
}

/** Ещё не вышло: план / черновики / ошибки очереди. */
export function isContentPlanUpcoming(item: ContentPlanItem): boolean {
  return item.status !== "published";
}

function anchorTs(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Ближайшие слоты первыми (по scheduledAt). */
export function sortContentPlanUpcoming(items: ContentPlanItem[]): ContentPlanItem[] {
  return [...items].sort((a, b) => {
    const ta = anchorTs(a.scheduledAt ?? a.createdAt);
    const tb = anchorTs(b.scheduledAt ?? b.createdAt);
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title, "ru");
  });
}

/** Свежие публикации первыми (по publishedAt). */
export function sortContentPlanPublished(items: ContentPlanItem[]): ContentPlanItem[] {
  return [...items].sort((a, b) => {
    const ta = anchorTs(a.publishedAt ?? a.scheduledAt ?? a.createdAt);
    const tb = anchorTs(b.publishedAt ?? b.scheduledAt ?? b.createdAt);
    // Infinity last; newer first → reverse numeric when finite
    if (ta === tb) return a.title.localeCompare(b.title, "ru");
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return tb - ta;
  });
}

export function partitionContentPlan(items: ContentPlanItem[]): {
  upcoming: ContentPlanItem[];
  published: ContentPlanItem[];
} {
  const upcoming: ContentPlanItem[] = [];
  const published: ContentPlanItem[] = [];
  for (const item of items) {
    if (isContentPlanUpcoming(item)) upcoming.push(item);
    else published.push(item);
  }
  return {
    upcoming: sortContentPlanUpcoming(upcoming),
    published: sortContentPlanPublished(published),
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
