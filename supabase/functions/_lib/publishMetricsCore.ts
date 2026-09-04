/**
 * Чистая часть сбора метрик публикаций (publish-metrics): нормализация ответов
 * площадок, проверка прав и порог «своего хита». Без Deno и Supabase —
 * покрывается vitest (src/test/publishMetrics.test.ts).
 */

/** Порог «своего хита» для отправки на разбор LLM. */
export const OWN_POST_REACH_SHARE = 0.05;
export const OWN_POST_MIN_VIEWS = 10_000;


export interface Metrics {
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  raw: unknown;
}

function pick(rows: { name?: string; values?: { value?: number }[]; total_value?: { value?: number } }[], name: string): number {
  const row = rows.find((r) => r.name === name);
  const v = row?.values?.[0]?.value ?? row?.total_value?.value ?? 0;
  return Number(v) || 0;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Нормализация ответа площадки в единый набор полей — чистая функция для тестов. */
export function normalizeInsights(platform: string, payload: unknown): Metrics {
  if (platform === "tiktok") {
    const v = (((payload as { data?: { videos?: Record<string, unknown>[] } } | null)?.data?.videos ?? [])[0] ?? {}) as Record<string, unknown>;
    const views = num(v.view_count);
    return { reach: views, views, likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count), saves: 0, raw: payload };
  }
  if (platform === "youtube") {
    const st = (((payload as { items?: { statistics?: Record<string, unknown> }[] } | null)?.items ?? [])[0]?.statistics ?? {}) as Record<string, unknown>;
    const views = num(st.viewCount);
    return { reach: views, views, likes: num(st.likeCount), comments: num(st.commentCount), shares: 0, saves: num(st.favoriteCount), raw: payload };
  }
  const rows = ((payload as { data?: unknown[] } | null)?.data ?? []) as { name?: string; values?: { value?: number }[]; total_value?: { value?: number } }[];
  if (platform === "threads") {
    return {
      reach: pick(rows, "views"),
      views: pick(rows, "views"),
      likes: pick(rows, "likes"),
      comments: pick(rows, "replies"),
      shares: pick(rows, "reposts") + pick(rows, "shares"),
      saves: 0,
      raw: payload,
    };
  }
  return {
    reach: pick(rows, "reach"),
    views: pick(rows, "views") || pick(rows, "plays") || pick(rows, "video_views"),
    likes: pick(rows, "likes"),
    comments: pick(rows, "comments"),
    shares: pick(rows, "shares"),
    saves: pick(rows, "saved"),
    raw: payload,
  };
}

/** Нужен ли аккаунту reconnect ради метрик: TikTok без video.list статистику не отдаёт. */
export function metricsScopeMissing(platform: string, scope: string | null | undefined): string | null {
  if (platform === "tiktok" && scope && !scope.split(/[,\s]+/).includes("video.list")) return "video.list";
  return null;
}

/** Считать ли собственный ролик хитом, достойным разбора LLM. */
export function ownPostIsHit(m: Pick<Metrics, "reach" | "views">, followers: number | null): boolean {
  if (m.views >= OWN_POST_MIN_VIEWS) return true;
  return Boolean(followers && followers > 0 && m.reach / followers >= OWN_POST_REACH_SHARE);
}

