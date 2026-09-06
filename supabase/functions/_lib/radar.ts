/**
 * Радар идей: чистая логика (нормализация собранных постов, промпт и разбор
 * ответа модели, превращение разбора в идею). Без сети и БД — покрыто
 * тестами src/test/radar.test.ts. Edge-функция radar использует это как
 * единственный источник правды по форматам.
 */

export const RADAR_PLATFORMS = ["instagram", "tiktok", "youtube", "threads", "facebook"] as const;
export type RadarPlatform = (typeof RADAR_PLATFORMS)[number];

export interface RadarIngestItem {
  platform: RadarPlatform;
  external_id: string;
  url: string | null;
  author_handle: string | null;
  published_at: string | null;
  media_type: string | null;
  caption: string | null;
  transcript: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  metrics: { likes: number; comments: number; shares: number; saves: number; views: number };
  followers: number | null;
  raw: unknown;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function isoDate(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Один элемент от любого провайдера (Apify instagram-scraper, ScrapeCreators,
 * tikwm, n8n-разбор по ссылке) → строка radar_posts. Неизвестные поля не
 * теряются: сырой объект уходит в raw. Возвращает null, если нет id/ссылки.
 */
export function normalizeIngestItem(platform: string, item: Record<string, unknown>): RadarIngestItem | null {
  if (!(RADAR_PLATFORMS as readonly string[]).includes(platform)) return null;
  const url = str(item.url ?? item.postUrl ?? item.shortCodeUrl ?? item.webVideoUrl ?? item.permalink ?? item.link);
  const externalId = str(item.external_id ?? item.id ?? item.shortCode ?? item.shortcode ?? item.videoId ?? item.aweme_id) ??
    (url ? url.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? null : null);
  if (!externalId) return null;
  const metricsSrc = (item.metrics && typeof item.metrics === "object" ? item.metrics : item) as Record<string, unknown>;
  const stats = (item.stats && typeof item.stats === "object" ? item.stats : {}) as Record<string, unknown>;
  const mediaType = str(item.media_type ?? item.type ?? item.typename ?? item.productType);
  return {
    platform: platform as RadarPlatform,
    external_id: externalId,
    url,
    author_handle: str(item.author_handle ?? item.ownerUsername ?? item.username ?? (item.author as Record<string, unknown> | undefined)?.uniqueId ?? (item.authorMeta as Record<string, unknown> | undefined)?.name),
    published_at: isoDate(item.published_at ?? item.timestamp ?? item.createTime ?? item.createTimeISO ?? item.taken_at),
    media_type: mediaType ? mediaType.toLowerCase() : null,
    caption: str(item.caption ?? item.text ?? item.desc ?? item.title),
    transcript: str(item.transcript),
    video_url: str(item.video_url ?? item.videoUrl ?? item.play ?? (item.videoMeta as Record<string, unknown> | undefined)?.downloadAddr),
    thumbnail_url: str(item.thumbnail_url ?? item.displayUrl ?? item.thumbnailUrl ?? item.cover ?? (item.videoMeta as Record<string, unknown> | undefined)?.coverUrl),
    metrics: {
      likes: num(metricsSrc.likes ?? metricsSrc.likesCount ?? metricsSrc.diggCount ?? stats.diggCount ?? metricsSrc.like_count),
      comments: num(metricsSrc.comments ?? metricsSrc.commentsCount ?? metricsSrc.commentCount ?? stats.commentCount ?? metricsSrc.comment_count),
      shares: num(metricsSrc.shares ?? metricsSrc.sharesCount ?? metricsSrc.shareCount ?? stats.shareCount ?? metricsSrc.reshare_count),
      saves: num(metricsSrc.saves ?? metricsSrc.savesCount ?? metricsSrc.collectCount ?? stats.collectCount ?? metricsSrc.saved),
      views: num(metricsSrc.views ?? metricsSrc.videoViewCount ?? metricsSrc.videoPlayCount ?? metricsSrc.playCount ?? stats.playCount ?? metricsSrc.view_count),
    },
    followers: (() => {
      const f = item.followers ?? item.followersCount ?? item.ownerFollowersCount ?? (item.authorMeta as Record<string, unknown> | undefined)?.fans;
      return f == null ? null : num(f);
    })(),
    raw: item,
  };
}

/* ───────────────────────────── превью ───────────────────────────── */

/** Bucket Supabase Storage с копиями превью постов (миграция 20260909100000_radar_thumbnails.sql). */
export const RADAR_THUMBS_BUCKET = "radar-thumbs";
/** Крупнее — не картинка-превью, а что-то не то; не тащим. */
export const THUMB_MAX_BYTES = 5 * 1024 * 1024;

const THUMB_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/pjpeg": "jpg",
  "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
};

/** Content-Type ответа CDN → { mime, ext } для загрузки в Storage; null — это не картинка. */
export function thumbnailMime(contentType: string | null | undefined): { mime: string; ext: string } | null {
  const mime = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = THUMB_EXT_BY_MIME[mime];
  if (!ext) return null;
  return { mime: mime === "image/jpg" || mime === "image/pjpeg" ? "image/jpeg" : mime, ext };
}

/** Путь объекта в bucket: `<project>/<post>.<ext>` — один пост, одно превью, перезапись при пересборе. */
export function thumbnailObjectPath(projectId: string, postId: string, ext: string): string {
  return `${projectId}/${postId}.${ext}`;
}

/**
 * Ссылка уже ведёт в наш Storage (кэш) — такую не перекачиваем и не
 * перетираем свежей ссылкой CDN при повторном сборе того же поста.
 */
export function isStoredThumbnail(url: string | null | undefined, supabaseUrl: string): boolean {
  if (!url || !supabaseUrl) return false;
  let host = "";
  try {
    host = new URL(supabaseUrl).host.toLowerCase();
  } catch {
    return false;
  }
  try {
    const u = new URL(url);
    return u.host.toLowerCase() === host && u.pathname.includes(`/storage/v1/object/public/${RADAR_THUMBS_BUCKET}/`);
  } catch {
    return false;
  }
}

/** Внешняя картинка, которую стоит скопировать: https и не наш Storage. */
export function needsThumbnailCache(url: string | null | undefined, supabaseUrl: string): boolean {
  if (!url || !/^https:\/\//i.test(url)) return false;
  return !isStoredThumbnail(url, supabaseUrl);
}

/* ───────────────────────────── разбор ───────────────────────────── */

export interface RadarAnalysis {
  hook: string;
  niche: string;
  structure: { problem: string; solution: string; cta: string };
  triggers: string[];
  why_it_works: string;
  score: number;
  idea_title: string;
  idea_angle: string;
  script_outline: string;
}

export const RADAR_ANALYSIS_SCHEMA = {
  name: "radar_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["hook", "niche", "structure", "triggers", "why_it_works", "score", "idea_title", "idea_angle", "script_outline"],
    properties: {
      hook: { type: "string" },
      niche: { type: "string" },
      structure: {
        type: "object",
        additionalProperties: false,
        required: ["problem", "solution", "cta"],
        properties: { problem: { type: "string" }, solution: { type: "string" }, cta: { type: "string" } },
      },
      triggers: { type: "array", items: { type: "string" }, maxItems: 6 },
      why_it_works: { type: "string" },
      score: { type: "integer", minimum: 0, maximum: 100 },
      idea_title: { type: "string" },
      idea_angle: { type: "string" },
      script_outline: { type: "string" },
    },
  },
} as const;

/** Поля ответа модели — единый текст для промпта (схема RADAR_ANALYSIS_SCHEMA словами). */
export const ANALYSIS_FIELDS_SPEC = [
  '{"hook": "первая фраза/крючок публикации своими словами, 1 предложение",',
  ' "niche": "ниша/тема публикации, 1–3 слова",',
  ' "structure": {"problem": "какую боль поднимает", "solution": "что предлагает", "cta": "к чему призывает"},',
  ' "triggers": ["до 6 психологических триггеров: страх, любопытство, выгода…"],',
  ' "why_it_works": "почему публикация сработала, 1–2 предложения",',
  ' "score": 0-100 (целое число),',
  ' "idea_title": "название НАШЕЙ идеи в той же нише, до 80 символов",',
  ' "idea_angle": "угол подачи нашей идеи, 1–2 предложения",',
  ' "script_outline": "план нашего ролика: хук → 2–3 блока → призыв, 3–6 строк"}',
].join("\n");

export function buildAnalysisPrompt(input: {
  platform: string;
  caption: string | null;
  transcript: string | null;
  metrics: { likes: number; comments: number; shares: number; saves: number; views: number };
  followers: number | null;
  businessContext?: string | null;
  ownNiche?: string | null;
}): { system: string; user: string } {
  const system = [
    "Ты аналитик короткого видеоконтента (Reels/Shorts/TikTok) и сценарист.",
    "Разбираешь чужую публикацию: что цепляет, как устроена, почему сработала — и предлагаешь СВОЮ идею в той же нише для нашего проекта.",
    "Не копируй текст оригинала, не упоминай чужие бренды и имена. Не выдумывай цифры и обещания.",
    "score — вероятность, что адаптация этой идеи зайдёт у нас (0–100), с учётом реакции аудитории оригинала.",
    "Отвечай строго одним JSON-объектом с полями (все обязательны, на русском):",
    ANALYSIS_FIELDS_SPEC,
  ].join("\n");
  const m = input.metrics;
  const user = [
    `Площадка: ${input.platform}`,
    input.ownNiche ? `Наша ниша: ${input.ownNiche}` : "",
    input.businessContext ? `Наш проект: ${input.businessContext}` : "",
    `Реакция: лайки ${m.likes}, комментарии ${m.comments}, репосты ${m.shares}, сохранения ${m.saves}, просмотры ${m.views}${input.followers ? `, подписчиков у автора ${input.followers}` : ""}`,
    input.caption ? `Подпись: """${input.caption.slice(0, 1500)}"""` : "",
    input.transcript ? `Что говорят в видео: """${input.transcript.slice(0, 4000)}"""` : "Транскрипта нет — разбирай по подписи и метрикам.",
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

/** Ответ модели → RadarAnalysis; null, если структура не сходится. */
export function parseAnalysis(raw: unknown): RadarAnalysis | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    let text = raw.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    if (fence) text = fence[1];
    try {
      obj = JSON.parse(text);
    } catch {
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      if (a < 0 || b <= a) return null;
      try { obj = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
    }
  }
  if (!obj || typeof obj !== "object") return null;
  let o = obj as Record<string, unknown>;
  // Модель иногда заворачивает ответ: {"analysis": {...}} или {"result": {...}} — берём вложенный объект с hook.
  if (typeof o.hook !== "string") {
    const nested = Object.values(o).find((v) => v && typeof v === "object" && !Array.isArray(v) && typeof (v as Record<string, unknown>).hook === "string");
    if (nested) o = nested as Record<string, unknown>;
  }
  const s = (o.structure ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const hook = text(o.hook);
  const ideaTitle = text(o.idea_title);
  if (!hook || !ideaTitle) return null;
  const score = Number(o.score);
  return {
    hook,
    niche: text(o.niche),
    structure: { problem: text(s.problem), solution: text(s.solution), cta: text(s.cta) },
    triggers: Array.isArray(o.triggers) ? o.triggers.map(text).filter(Boolean).slice(0, 6) : [],
    why_it_works: text(o.why_it_works),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50,
    idea_title: ideaTitle.slice(0, 200),
    idea_angle: text(o.idea_angle),
    script_outline: text(o.script_outline),
  };
}

/** Порог оценки поста, с которого разбор становится идеей в банке. */
export const IDEA_SCORE_THRESHOLD = 55;

export function ideaFromAnalysis(postId: string, a: RadarAnalysis, postScore: number | null) {
  return {
    title: a.idea_title,
    hook: a.hook,
    angle: a.idea_angle || null,
    niche: a.niche || null,
    script_draft: a.script_outline || null,
    structure: { ...a.structure, triggers: a.triggers, why_it_works: a.why_it_works },
    source_post_ids: [postId],
    score: Math.round(((postScore ?? a.score) + a.score) / 2),
    status: "new" as const,
  };
}

/** Видео для Whisper: только https, без приватных хостов, до 25 МБ (лимит Whisper). */
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export function transcribableVideoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(":") || h.endsWith(".local") || h.endsWith(".internal")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Оценка стоимости разбора: Whisper $0.006/мин, LLM по токенам (грубо). */
export function estimateAnalysisCostUsd(seconds: number | null, promptChars: number): number {
  const whisper = seconds ? (seconds / 60) * 0.006 : 0;
  const llm = (promptChars / 4 / 1_000_000) * 0.15 + (600 / 1_000_000) * 0.6; // gpt-4o-mini
  return Math.round((whisper + llm) * 10_000) / 10_000;
}
