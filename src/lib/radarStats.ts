/**
 * Радар идей: чистые вычисления для витрины «как в viralex» — X-фактор поста
 * («обычно / сейчас / ×N»), норма просмотров по аудитории, рейтинг авторов
 * (вирусные посты, просмотры сверх нормы, сила автора, плотность хитов),
 * фильтры и сортировки ленты трендов. Без сети — покрыто src/test/radarStats.test.ts.
 */
import type { Idea, IdeaStatus, RadarMetrics, RadarPlatform, RadarPost, RadarSource } from "@/lib/radarClient";

/** Пост считаем «залетевшим», если он обошёл обычный результат автора минимум вдвое. */
export const VIRAL_X_FACTOR = 2;

export type TrendPeriod = "all" | "today" | "week" | "month";
export type TrendSort = "hot" | "x" | "views" | "recent" | "score";

export const TREND_PERIODS: { value: TrendPeriod; label: string }[] = [
  { value: "all", label: "За всё время" },
  { value: "today", label: "Сегодня" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
];

export const TREND_SORTS: { value: TrendSort; label: string; hint: string }[] = [
  { value: "hot", label: "Горячее", hint: "X-фактор с учётом свежести" },
  { value: "x", label: "X-фактор", hint: "Во сколько раз пост обошёл норму автора" },
  { value: "views", label: "Просмотры", hint: "Абсолютные просмотры" },
  { value: "recent", label: "Свежие", hint: "Сначала новые публикации" },
  { value: "score", label: "Оценка", hint: "Оценка потенциала для нас" },
];

/** Ожидаемые просмотры по числу подписчиков (та же кривая, что в SQL radar_norm_views). */
export function normViews(followers: number | null | undefined): number | null {
  const f = Number(followers);
  if (!Number.isFinite(f) || f <= 0) return null;
  return Math.round(3.75 * Math.pow(f, 0.68));
}

/** «×6811», «×2,6», «—». */
export function formatX(x: number | null | undefined): string {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 100) return `×${Math.round(n).toLocaleString("ru-RU")}`;
  if (n >= 10) return `×${Math.round(n)}`;
  return `×${n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

export type XTone = "viral" | "above" | "normal" | "none";

/** Тон X-фактора: ≥2 — залетел, >1,2 — выше нормы, иначе обычный. */
export function xTone(x: number | null | undefined): XTone {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return "none";
  if (n >= VIRAL_X_FACTOR) return "viral";
  if (n > 1.2) return "above";
  return "normal";
}

/**
 * Деньги радара: суммы бывают в центах и долях цента, поэтому «$0.00» врёт —
 * ниже цента показываем три знака, ровный ноль — как «$0».
 */
export function formatUsd(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "$0";
  if (v < 0.001) return "<$0.001";
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/** Компактное число: 16,1M · 809K · 1 200. */
export function formatCompact(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/** «5 дн назад», «3 ч назад», «только что». */
export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн назад`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} мес назад`;
  return `${Math.floor(mo / 12)} г назад`;
}

/** Тип медиа от сборщика (video / Sidecar / GraphImage / shorts / …) → слово для интерфейса. */
export function mediaTypeLabel(mediaType: string | null | undefined): string {
  const t = String(mediaType ?? "").trim().toLowerCase();
  if (!t) return "пост";
  if (/reel|clip/.test(t)) return "reels";
  if (/short/.test(t)) return "shorts";
  if (/video/.test(t)) return "видео";
  if (/sidecar|carousel|album/.test(t)) return "карусель";
  if (/image|photo|graphimage/.test(t)) return "фото";
  if (/story|stories/.test(t)) return "сторис";
  if (t === "ad") return "объявление";
  if (t === "text") return "текст";
  return t;
}

/** Главный показатель поста: просмотры, а если их нет (фото/карусель) — лайки. */
export function primaryMetric(post: RadarPost): { value: number; kind: "views" | "likes" } {
  const views = Number(post.metrics?.views ?? 0);
  if (views > 0) return { value: views, kind: "views" };
  return { value: Number(post.metrics?.likes ?? 0), kind: "likes" };
}

/** «Обычно» для поста: медиана автора по тому же показателю, иначе норма по аудитории. */
export function usualMetric(post: RadarPost): number | null {
  const { kind } = primaryMetric(post);
  const base = kind === "views" ? post.baseline_views : post.baseline_likes;
  if (base != null && Number(base) > 0) return Math.round(Number(base));
  if (kind === "views" && post.norm_views != null && Number(post.norm_views) > 0) return Math.round(Number(post.norm_views));
  return null;
}

const hoursSince = (iso: string | null | undefined, now: number): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? 24 * 30 : Math.max(1, (now - t) / 3_600_000);
};

/** «Горячее»: X-фактор, затухающий со временем (полураспад ≈ 3 дня), плюс оценка. */
export function hotScore(post: RadarPost, now: number = Date.now()): number {
  const x = Math.max(Number(post.x_factor) || 0, 0);
  const decay = Math.exp(-hoursSince(post.published_at, now) / 72);
  return x * (0.35 + 0.65 * decay) + (Number(post.score) || 0) / 100;
}

export interface TrendFilter {
  platform: RadarPlatform | "all";
  period: TrendPeriod;
  sort: TrendSort;
  niche: string | null;
  /** Только «залетевшие» (X-фактор ≥ 2). */
  viralOnly: boolean;
  query: string;
}

export const DEFAULT_TREND_FILTER: TrendFilter = { platform: "all", period: "all", sort: "hot", niche: null, viralOnly: false, query: "" };

const PERIOD_HOURS: Record<TrendPeriod, number | null> = { all: null, today: 24, week: 24 * 7, month: 24 * 30 };

export function nicheOf(post: RadarPost): string | null {
  const n = post.analysis?.niche?.trim();
  return n ? n : null;
}

/** Список ниш из разборов, по убыванию частоты. */
export function nicheOptions(posts: RadarPost[]): { niche: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const n = nicheOf(p);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].map(([niche, count]) => ({ niche, count })).sort((a, b) => b.count - a.count || a.niche.localeCompare(b.niche, "ru"));
}

export function filterTrends(posts: RadarPost[], f: TrendFilter, now: number = Date.now()): RadarPost[] {
  const maxHours = PERIOD_HOURS[f.period];
  const q = f.query.trim().toLowerCase();
  const list = posts.filter((p) => {
    if (f.platform !== "all" && p.platform !== f.platform) return false;
    if (maxHours != null && hoursSince(p.published_at ?? null, now) > maxHours) return false;
    if (f.niche && nicheOf(p) !== f.niche) return false;
    if (f.viralOnly && !(Number(p.x_factor) >= VIRAL_X_FACTOR)) return false;
    if (q) {
      const hay = `${p.author_handle ?? ""} ${p.caption ?? ""} ${p.analysis?.hook ?? ""} ${p.analysis?.idea_title ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by: Record<TrendSort, (a: RadarPost, b: RadarPost) => number> = {
    hot: (a, b) => hotScore(b, now) - hotScore(a, now),
    x: (a, b) => (Number(b.x_factor) || 0) - (Number(a.x_factor) || 0),
    views: (a, b) => primaryMetric(b).value - primaryMetric(a).value,
    recent: (a, b) => (Date.parse(b.published_at ?? "") || 0) - (Date.parse(a.published_at ?? "") || 0),
    score: (a, b) => (Number(b.score) || 0) - (Number(a.score) || 0),
  };
  return [...list].sort(by[f.sort]);
}

/* ───────────────────────────── идеи ───────────────────────────── */

export interface IdeaFilter {
  status: IdeaStatus | "all";
  niche: string | null;
  query: string;
}

export const DEFAULT_IDEA_FILTER: IdeaFilter = { status: "all", niche: null, query: "" };

/** Ниши банка идей по убыванию частоты. */
export function ideaNiches(ideas: Idea[]): { niche: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of ideas) {
    const n = i.niche?.trim();
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].map(([niche, count]) => ({ niche, count })).sort((a, b) => b.count - a.count || a.niche.localeCompare(b.niche, "ru"));
}

/** Идеи под фильтр (статус, ниша, поиск по названию / хуку / углу / нише), по убыванию оценки. */
export function filterIdeas(ideas: Idea[], f: IdeaFilter): Idea[] {
  const q = f.query.trim().toLowerCase();
  return ideas
    .filter((i) => {
      if (f.status !== "all" && i.status !== f.status) return false;
      if (f.niche && (i.niche?.trim() ?? "") !== f.niche) return false;
      if (q) {
        const hay = `${i.title} ${i.hook ?? ""} ${i.angle ?? ""} ${i.niche ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => Number(b.score) - Number(a.score));
}

/* ───────────────────────────── сводка ───────────────────────────── */

export type FunnelKey = "collected" | "analyzed" | "viral" | "ideas" | "approved" | "used";

export interface FunnelStep {
  key: FunnelKey;
  label: string;
  value: number;
  /** Доля от первого шага (0–1) — длина полоски. */
  share: number;
  /** Короткая расшифровка под числом. */
  sub: string;
  hint: string;
}

const n0 = (v: number | null | undefined) => Math.max(0, Number(v) || 0);

/**
 * Воронка радара из витрины: собрано → разобрано → залетевших → идей →
 * одобрено (включая уже ушедшие в план) → в плане. Полоска каждого шага —
 * доля от собранного, чтобы воронка читалась глазами, а не только цифрами.
 */
export function radarFunnel(m: RadarMetrics | null | undefined): FunnelStep[] {
  const collected = n0(m?.posts_total);
  const analyzed = n0(m?.posts_analyzed);
  const pending = n0(m?.posts_unanalyzed);
  const viral = n0(m?.posts_viral);
  const scored = n0(m?.posts_scored);
  const ideas = n0(m?.ideas_total);
  const ideasNew = n0(m?.ideas_new);
  const used = n0(m?.ideas_used);
  const approved = n0(m?.ideas_approved) + used;
  const today = n0(m?.posts_today);
  const week = n0(m?.posts_7d);
  const base = Math.max(collected, 1);
  const share = (v: number) => Math.min(1, v / base);
  return [
    {
      key: "collected", label: "Собрано", value: collected, share: share(collected),
      sub: collected ? `за 7 дней ${week}${today ? ` · сегодня +${today}` : ""}` : "постов пока нет",
      hint: "Все публикации в базе радара по этому проекту",
    },
    {
      key: "analyzed", label: "Разобрано", value: analyzed, share: share(analyzed),
      sub: pending ? `ждут разбора ${pending}` : collected ? "очередь пуста" : "—",
      hint: "Посты, по которым модель уже написала хук, структуру и сценарий",
    },
    {
      key: "viral", label: "Залетевших", value: viral, share: share(viral),
      sub: scored ? `из ${scored} с X-фактором` : "X-фактор не посчитан",
      hint: `X-фактор ≥ ${VIRAL_X_FACTOR}: пост обошёл обычный результат автора минимум вдвое`,
    },
    {
      key: "ideas", label: "Идей", value: ideas, share: share(ideas),
      sub: ideas ? `новых ${ideasNew}` : "оценка ≥ 55 → идея",
      hint: "Идеи в банке: разборы с оценкой от 55",
    },
    {
      key: "approved", label: "Одобрено", value: approved, share: share(approved),
      sub: approved ? `${approved - used} ждут плана` : "ещё ни одной",
      hint: "Идеи, которые вы одобрили (включая уже отправленные в план)",
    },
    {
      key: "used", label: "В плане", value: used, share: share(used),
      sub: used ? "тем в контент-плане" : "ещё ни одной",
      hint: "Идеи, ставшие темами контент-плана кнопкой «В контент-план»",
    },
  ];
}

/** Куда ведёт клик по элементу сводки. */
export type PulseTarget =
  | { tab: "trends"; filter?: Partial<TrendFilter> }
  | { tab: "ideas"; status?: IdeaStatus | "all" }
  | { tab: "sources" }
  | { tab: "runs" }
  | { tab: "add-source" };

export interface XBucket {
  key: "below" | "normal" | "viral" | "mega";
  label: string;
  count: number;
  /** Доля от постов с посчитанным X-фактором (0–1). */
  share: number;
  tone: XTone;
}

/** Распределение постов по X-фактору: ниже нормы · норма · залетели · сильно залетели. */
export function xFactorBuckets(posts: RadarPost[]): XBucket[] {
  const counts = { below: 0, normal: 0, viral: 0, mega: 0 };
  let total = 0;
  for (const p of posts) {
    const x = Number(p.x_factor);
    if (!Number.isFinite(x) || x <= 0) continue;
    total++;
    if (x < 1) counts.below++;
    else if (x < VIRAL_X_FACTOR) counts.normal++;
    else if (x < 5) counts.viral++;
    else counts.mega++;
  }
  const share = (n: number) => (total ? n / total : 0);
  return [
    { key: "below", label: "ниже нормы", count: counts.below, share: share(counts.below), tone: "normal" },
    { key: "normal", label: `×1–${VIRAL_X_FACTOR}`, count: counts.normal, share: share(counts.normal), tone: "above" },
    { key: "viral", label: `×${VIRAL_X_FACTOR}–5`, count: counts.viral, share: share(counts.viral), tone: "viral" },
    { key: "mega", label: "×5 и выше", count: counts.mega, share: share(counts.mega), tone: "viral" },
  ];
}

export interface NextStep {
  key: "sources" | "pending" | "ideas" | "approved" | "viral" | "done";
  text: string;
  action: string;
  target: PulseTarget;
  /** Требует внимания пользователя (а не просто ждёт крон). */
  urgent: boolean;
}

/**
 * «Что дальше»: до трёх подсказок по состоянию воронки — где застряло дело
 * и куда нажать. Порядок — от того, что ждёт человека, к тому, что идёт само.
 */
export function nextSteps(m: RadarMetrics | null | undefined, sourcesCount: number): NextStep[] {
  const out: NextStep[] = [];
  const sources = m ? n0(m.sources) : sourcesCount;
  const pending = n0(m?.posts_unanalyzed);
  const ideasNew = n0(m?.ideas_new);
  const approved = n0(m?.ideas_approved);
  const viral = n0(m?.posts_viral);
  const collected = n0(m?.posts_total);
  if (sources === 0) {
    out.push({ key: "sources", urgent: true, text: "Источников нет — радару нечего собирать", action: "Добавить источник", target: { tab: "add-source" } });
  }
  if (approved > 0) {
    out.push({
      key: "approved", urgent: true,
      text: `${approved} ${plural(approved, "одобренная идея ждёт", "одобренные идеи ждут", "одобренных идей ждут")} контент-плана`,
      action: "В контент-план", target: { tab: "ideas", status: "approved" },
    });
  }
  if (ideasNew > 0) {
    out.push({
      key: "ideas", urgent: true,
      text: `${ideasNew} ${plural(ideasNew, "новая идея ждёт", "новые идеи ждут", "новых идей ждут")} решения`,
      action: "Смотреть идеи", target: { tab: "ideas", status: "new" },
    });
  }
  if (pending > 0) {
    out.push({
      key: "pending", urgent: false,
      text: `${pending} ${plural(pending, "пост ждёт", "поста ждут", "постов ждут")} разбора — очередь идёт каждые 15 минут`,
      action: "Открыть ленту", target: { tab: "trends", filter: { sort: "recent" } },
    });
  }
  if (out.length < 3 && viral > 0) {
    out.push({
      key: "viral", urgent: false,
      text: `${viral} ${plural(viral, "залетевший пост", "залетевших поста", "залетевших постов")} — посмотрите, что сработало`,
      action: "Залетевшие", target: { tab: "trends", filter: { viralOnly: true, sort: "x" } },
    });
  }
  if (out.length === 0) {
    out.push({
      key: "done", urgent: false,
      text: collected ? "Всё разобрано, новых идей нет — ждём следующий сбор" : "Первый сбор ещё идёт — посты появятся через пару минут",
      action: "Сборы", target: { tab: "runs" },
    });
  }
  return out.slice(0, 3);
}

/** Склонение по числу: 1 пост, 2 поста, 5 постов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Пост-рекорд среди загруженных: максимальный X-фактор. */
export function bestPost(posts: RadarPost[]): RadarPost | null {
  let best: RadarPost | null = null;
  for (const p of posts) {
    const x = Number(p.x_factor) || 0;
    if (x > 0 && (!best || x > (Number(best.x_factor) || 0))) best = p;
  }
  return best;
}

/** Сколько собранных постов относятся к нише (по разбору). */
export function nicheCount(posts: RadarPost[], niche: string | null | undefined): number {
  if (!niche) return 0;
  return posts.filter((p) => nicheOf(p) === niche).length;
}

/* ───────────────────────────── авторы ───────────────────────────── */

export interface AuthorStats {
  key: string;
  platform: RadarPlatform;
  handle: string;
  source: RadarSource | null;
  followers: number | null;
  posts: number;
  /** Постов с X-фактором ≥ 2. */
  viral: number;
  /** Сумма (просмотры − обычно) по залетевшим постам. */
  aboveNorm: number;
  /** Сила автора — лучший X-фактор. */
  strength: number | null;
  /** Доля залетевших среди собранных. */
  hitRate: number;
  lastPublishedAt: string | null;
  topPost: RadarPost | null;
}

export type AuthorSort = "viral" | "strength";

export const FOLLOWER_BRACKETS: { value: string; label: string; min: number; max: number | null }[] = [
  { value: "all", label: "Все размеры", min: 0, max: null },
  { value: "s", label: "до 10 тыс.", min: 0, max: 10_000 },
  { value: "m", label: "10–100 тыс.", min: 10_000, max: 100_000 },
  { value: "l", label: "100 тыс. – 1 млн", min: 100_000, max: 1_000_000 },
  { value: "xl", label: "от 1 млн", min: 1_000_000, max: null },
];

export function followerBracket(followers: number | null | undefined): string {
  const f = Number(followers) || 0;
  if (f >= 1_000_000) return "xl";
  if (f >= 100_000) return "l";
  if (f >= 10_000) return "m";
  return "s";
}

/** Рейтинг авторов по собранным постам (как «Authors» в viralex). */
export function authorStats(posts: RadarPost[], sources: RadarSource[], sort: AuthorSort = "viral"): AuthorStats[] {
  const map = new Map<string, AuthorStats>();
  const sourceByKey = new Map<string, RadarSource>(sources.map((s) => [`${s.platform}:${s.handle.toLowerCase()}`, s]));
  for (const p of posts) {
    const handle = (p.author_handle ?? "").trim();
    if (!handle) continue;
    const key = `${p.platform}:${handle.toLowerCase()}`;
    const cur = map.get(key) ?? {
      key, platform: p.platform, handle, source: sourceByKey.get(key) ?? (p.source_id ? sources.find((s) => s.id === p.source_id) ?? null : null),
      followers: null, posts: 0, viral: 0, aboveNorm: 0, strength: null, hitRate: 0, lastPublishedAt: null, topPost: null,
    };
    const x = Number(p.x_factor) || 0;
    const usual = usualMetric(p);
    const { value } = primaryMetric(p);
    const next: AuthorStats = {
      ...cur,
      followers: cur.followers ?? (p.followers != null ? Number(p.followers) : null),
      posts: cur.posts + 1,
      viral: cur.viral + (x >= VIRAL_X_FACTOR ? 1 : 0),
      aboveNorm: cur.aboveNorm + (x >= VIRAL_X_FACTOR && usual != null ? Math.max(0, value - usual) : 0),
      strength: x > 0 ? Math.max(cur.strength ?? 0, x) : cur.strength,
      lastPublishedAt: !cur.lastPublishedAt || (p.published_at && p.published_at > cur.lastPublishedAt) ? p.published_at ?? cur.lastPublishedAt : cur.lastPublishedAt,
      topPost: !cur.topPost || x > (Number(cur.topPost.x_factor) || 0) ? p : cur.topPost,
    };
    map.set(key, { ...next, hitRate: next.posts ? next.viral / next.posts : 0 });
  }
  const list = [...map.values()];
  const cmp: Record<AuthorSort, (a: AuthorStats, b: AuthorStats) => number> = {
    viral: (a, b) => b.viral - a.viral || b.aboveNorm - a.aboveNorm || b.posts - a.posts,
    strength: (a, b) => (b.strength ?? 0) - (a.strength ?? 0) || b.hitRate - a.hitRate,
  };
  return list.sort(cmp[sort]);
}
