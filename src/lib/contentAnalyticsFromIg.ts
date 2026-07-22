import type { TrendPoint } from "@/pages/content-analytics/ContentPerformanceChart";
import type { IgDailyRow, IgMediaRow } from "@/hooks/useInstagramAnalytics";

export interface ContentAnalyticsKpis {
  posts: number;
  reach: number;
  views: number;
  engagement: number;
  saves: number;
  shares: number;
  er: number;
  reach_prev: number;
  engagement_prev: number;
  posts_prev: number;
  er_prev: number;
}

export interface ContentAnalyticsFormat {
  media_type: string;
  posts: number;
  avg_reach: number;
  avg_views: number;
  engagement: number;
  er: number;
}

export interface ContentAnalyticsPost {
  ig_media_id: string;
  caption: string;
  permalink: string | null;
  media_type: string;
  thumbnail_url: string | null;
  posted_at: string | null;
  reach: number;
  views: number;
  engagement: number;
  er: number;
}

export interface ContentAnalyticsFollowers {
  now: number | null;
  growth: number;
  series: { date: string; followers: number; net: number | null }[];
}

export interface ContentAnalyticsResp {
  from: string;
  to: string;
  kpis: ContentAnalyticsKpis;
  trend: TrendPoint[];
  by_format: ContentAnalyticsFormat[];
  top_posts: ContentAnalyticsPost[];
  bottom_posts: ContentAnalyticsPost[];
  /** All posts in the selected period, newest first. */
  all_posts: ContentAnalyticsPost[];
  followers: ContentAnalyticsFollowers;
  production: { generated: number; published: number; generated_all: number };
}

function viewsOf(m: IgMediaRow) {
  return m.plays > 0 ? m.plays : m.impressions;
}

function engagementOf(m: IgMediaRow) {
  if (m.totalInteractions > 0) return m.totalInteractions;
  return m.likeCount + m.commentsCount + m.sharesCount + m.savedCount;
}

function erOf(m: IgMediaRow) {
  const reach = m.reach || 0;
  if (reach <= 0) return 0;
  return Math.round((engagementOf(m) / reach) * 10000) / 100;
}

function mediaTypeOf(m: IgMediaRow) {
  if (m.mediaProductType === "REELS") return "VIDEO";
  if (m.mediaType === "CAROUSEL_ALBUM") return "CAROUSEL_ALBUM";
  if (m.mediaType === "VIDEO") return "VIDEO";
  return m.mediaType || "IMAGE";
}

function toPost(m: IgMediaRow): ContentAnalyticsPost {
  return {
    ig_media_id: m.mediaId,
    caption: m.caption ?? "",
    permalink: m.permalink,
    media_type: mediaTypeOf(m),
    thumbnail_url: m.thumbnailUrl,
    posted_at: m.timestamp,
    reach: m.reach,
    views: viewsOf(m),
    engagement: engagementOf(m),
    er: erOf(m),
  };
}

function weekStartYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function aggregateKpis(media: IgMediaRow[]): Omit<ContentAnalyticsKpis, "reach_prev" | "engagement_prev" | "posts_prev" | "er_prev"> {
  let reach = 0;
  let views = 0;
  let engagement = 0;
  let saves = 0;
  let shares = 0;
  for (const m of media) {
    reach += m.reach;
    views += viewsOf(m);
    engagement += engagementOf(m);
    saves += m.savedCount;
    shares += m.sharesCount;
  }
  const er = reach > 0 ? Math.round((engagement / reach) * 10000) / 100 : 0;
  return { posts: media.length, reach, views, engagement, saves, shares, er };
}

export function buildContentAnalyticsFromIg(params: {
  from: string;
  to: string;
  media: IgMediaRow[];
  daily: IgDailyRow[];
  followersNow?: number | null;
  productionGenerated?: number;
}): ContentAnalyticsResp {
  const { from, to, media, daily } = params;
  const fromTs = new Date(`${from}T00:00:00`).getTime();
  const toExclusive = new Date(`${to}T00:00:00`);
  toExclusive.setDate(toExclusive.getDate() + 1);
  const toTs = toExclusive.getTime();
  const periodMs = Math.max(1, toTs - fromTs);
  const prevFromTs = fromTs - periodMs;
  const prevToTs = fromTs;

  const inRange = media.filter((m) => {
    if (!m.timestamp) return false;
    const t = new Date(m.timestamp).getTime();
    return t >= fromTs && t < toTs;
  });
  const prevRange = media.filter((m) => {
    if (!m.timestamp) return false;
    const t = new Date(m.timestamp).getTime();
    return t >= prevFromTs && t < prevToTs;
  });

  const cur = aggregateKpis(inRange);
  const prev = aggregateKpis(prevRange);

  const byType = new Map<string, { posts: number; reach: number; views: number; engagement: number }>();
  for (const m of inRange) {
    const key = mediaTypeOf(m);
    const row = byType.get(key) ?? { posts: 0, reach: 0, views: 0, engagement: 0 };
    row.posts += 1;
    row.reach += m.reach;
    row.views += viewsOf(m);
    row.engagement += engagementOf(m);
    byType.set(key, row);
  }
  const by_format: ContentAnalyticsFormat[] = Array.from(byType.entries()).map(([media_type, v]) => ({
    media_type,
    posts: v.posts,
    avg_reach: v.posts ? Math.round(v.reach / v.posts) : 0,
    avg_views: v.posts ? Math.round(v.views / v.posts) : 0,
    engagement: v.engagement,
    er: v.reach > 0 ? Math.round((v.engagement / v.reach) * 10000) / 100 : 0,
  })).sort((a, b) => b.er - a.er);

  const ranked = [...inRange].map(toPost).sort((a, b) => b.er - a.er || b.reach - a.reach);
  const top_posts = ranked.slice(0, 5);
  const bottom_posts = [...ranked].reverse().slice(0, 5);
  const all_posts = [...inRange]
    .map(toPost)
    .sort((a, b) => String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? "")));

  const weekMap = new Map<string, TrendPoint>();
  for (const m of inRange) {
    const week = weekStartYmd(m.timestamp!);
    if (!week) continue;
    const row = weekMap.get(week) ?? { week, posts: 0, reach: 0, views: 0, engagement: 0, er: 0 };
    row.posts += 1;
    row.reach += m.reach;
    row.views += viewsOf(m);
    row.engagement += engagementOf(m);
    weekMap.set(week, row);
  }
  const trend = Array.from(weekMap.values())
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({
      ...w,
      er: w.reach > 0 ? Math.round((w.engagement / w.reach) * 10000) / 100 : 0,
    }));

  const series = daily.map((d, i) => ({
    date: d.date,
    followers: d.followers,
    net: i === 0 ? null : d.followers - daily[i - 1].followers,
  }));
  const growth = daily.length >= 2 ? daily[daily.length - 1].followers - daily[0].followers : 0;
  const now =
    params.followersNow
    ?? (daily.length ? daily[daily.length - 1].followers : null);

  return {
    from,
    to,
    kpis: {
      ...cur,
      reach_prev: prev.reach,
      engagement_prev: prev.engagement,
      posts_prev: prev.posts,
      er_prev: prev.er,
    },
    trend,
    by_format,
    top_posts,
    bottom_posts,
    all_posts,
    followers: { now, growth, series },
    production: {
      generated: params.productionGenerated ?? 0,
      published: cur.posts,
      generated_all: params.productionGenerated ?? 0,
    },
  };
}
