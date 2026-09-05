/**
 * TikTok for Developers — чистая часть раздела «Подключение TikTok»
 * (docs/TIKTOK-DEVELOPER-APP.md): каталог прав (scopes) по продуктам,
 * сборка запросов Display API / Content Posting API, разбор ответов и
 * проверка формы публикации по UX-требованиям площадки. Без Supabase и без
 * секретов; сеть — в edge-функции tiktok-connect. Тесты — src/test/tiktokConnect.test.ts.
 *
 *   Login Kit            → user.info.basic (+ user.info.profile, user.info.stats)
 *   Display API          → /v2/user/info/, /v2/video/list/, /v2/video/query/
 *   Content Posting API  → creator_info/query → video/init (FILE_UPLOAD | PULL_FROM_URL)
 *                          → PUT чанков на upload_url → status/fetch;
 *                          inbox/video/init — черновик в «Входящие» TikTok (video.upload)
 */

export const TIKTOK_API = "https://open.tiktokapis.com/v2";

/* ───────────────────────────── права (scopes) ───────────────────────────── */

export type TikTokProduct = "login_kit" | "display_api" | "content_posting_api";

export interface TikTokScopeInfo {
  scope: string;
  product: TikTokProduct;
  /** Что даёт право — коротко, для карточки в интерфейсе (RU / EN). */
  title: { ru: string; en: string };
  /** Зачем оно MarkVision — формулировка для формы App review. */
  purpose: { ru: string; en: string };
}

/** Порядок — как показываем в интерфейсе и в форме заявки. */
export const TIKTOK_SCOPES: readonly TikTokScopeInfo[] = [
  {
    scope: "user.info.basic",
    product: "login_kit",
    title: { ru: "Вход через TikTok: имя и аватар", en: "Sign in with TikTok: name and avatar" },
    purpose: {
      ru: "Показать, какой аккаунт подключён к проекту: open_id, отображаемое имя, аватар.",
      en: "Identify the connected TikTok account inside the project: open_id, display name, avatar.",
    },
  },
  {
    scope: "user.info.profile",
    product: "display_api",
    title: { ru: "Профиль: @username, описание, ссылка", en: "Profile: @username, bio, profile link" },
    purpose: {
      ru: "Карточка аккаунта в разделе «Публикации» и ссылка на опубликованные ролики (@username/video/…).",
      en: "Account card in the Publishing section and links to published videos (@username/video/…).",
    },
  },
  {
    scope: "user.info.stats",
    product: "display_api",
    title: { ru: "Статистика: подписчики, лайки, видео", en: "Stats: followers, likes, video count" },
    purpose: {
      ru: "Рост аудитории в аналитике проекта и «здоровье» аккаунта в сети публикаций.",
      en: "Audience growth in project analytics and account health in the publishing network.",
    },
  },
  {
    scope: "video.list",
    product: "display_api",
    title: { ru: "Список видео с метриками", en: "List of the user's videos with metrics" },
    purpose: {
      ru: "Лента опубликованных роликов и сбор просмотров/лайков/комментариев по каждому (post_metrics).",
      en: "Feed of published videos and per-video views/likes/comments collection (post_metrics).",
    },
  },
  {
    scope: "video.upload",
    product: "content_posting_api",
    title: { ru: "Загрузка черновика в TikTok", en: "Upload a draft to the TikTok inbox" },
    purpose: {
      ru: "Отправить готовый ролик в «Входящие» TikTok — пользователь дооформит и опубликует в приложении.",
      en: "Send a finished video to the TikTok inbox — the user finishes and posts it in the TikTok app.",
    },
  },
  {
    scope: "video.publish",
    product: "content_posting_api",
    title: { ru: "Прямая публикация видео", en: "Direct post of a video" },
    purpose: {
      ru: "Опубликовать ролик из очереди MarkVision с заголовком, приватностью и настройками, выбранными пользователем.",
      en: "Publish a video from the MarkVision queue with the title, privacy level and settings chosen by the user.",
    },
  },
];

export const TIKTOK_PRODUCTS: Record<TikTokProduct, { ru: string; en: string }> = {
  login_kit: { ru: "Login Kit", en: "Login Kit" },
  display_api: { ru: "Display API", en: "Display API" },
  content_posting_api: { ru: "Content Posting API", en: "Content Posting API" },
};

/** Полный набор прав, который просим при подключении (порядок как в каталоге). */
export const DEFAULT_TIKTOK_SCOPE = TIKTOK_SCOPES.map((s) => s.scope).join(",");

/** «a,b c» → ["a","b","c"] — TikTok отдаёт scope через запятую, Google через пробел. */
export function splitScopes(scope: string | null | undefined): string[] {
  return (scope ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

export function hasScope(scope: string | null | undefined, name: string): boolean {
  return splitScopes(scope).includes(name);
}

/** Ключ песочницы начинается с sbaw, боевой — с aw. */
export function isSandboxClientKey(clientKey: string | null | undefined): boolean {
  return /^sbaw/i.test((clientKey ?? "").trim());
}

/* ───────────────────────────── Display API: user/info ───────────────────────────── */

const USER_FIELDS_BY_SCOPE: Record<string, string[]> = {
  "user.info.basic": ["open_id", "union_id", "avatar_url", "avatar_url_100", "avatar_large_url", "display_name"],
  "user.info.profile": ["bio_description", "profile_deep_link", "is_verified", "username"],
  "user.info.stats": ["follower_count", "following_count", "likes_count", "video_count"],
};

/**
 * Поля user/info, которые можно запросить с выданными правами. Поле из
 * невыданного scope площадка отвергает целиком (scope_not_authorized), поэтому
 * список строится строго по факту.
 */
export function userInfoFields(scope: string | null | undefined): string[] {
  const granted = splitScopes(scope);
  const fields: string[] = [];
  for (const [s, list] of Object.entries(USER_FIELDS_BY_SCOPE)) {
    if (granted.includes(s) || (s === "user.info.basic" && !granted.length)) fields.push(...list);
  }
  return fields.length ? fields : USER_FIELDS_BY_SCOPE["user.info.basic"];
}

export interface TikTokUser {
  open_id: string;
  union_id: string | null;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  bio_description: string | null;
  profile_deep_link: string | null;
  is_verified: boolean | null;
  follower_count: number | null;
  following_count: number | null;
  likes_count: number | null;
  video_count: number | null;
}

export function userInfoRequest(accessToken: string, scope: string | null | undefined): { url: string; init: RequestInit } {
  return {
    url: `${TIKTOK_API}/user/info/?fields=${userInfoFields(scope).join(",")}`,
    init: { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function parseUserInfo(body: unknown): TikTokUser | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const u = ((b.data as Record<string, unknown> | undefined)?.user ?? {}) as Record<string, unknown>;
  if (!u.open_id) return null;
  return {
    open_id: String(u.open_id),
    union_id: str(u.union_id),
    display_name: String(u.display_name ?? u.username ?? "TikTok"),
    username: str(u.username),
    avatar_url: str(u.avatar_large_url) ?? str(u.avatar_url_100) ?? str(u.avatar_url),
    bio_description: str(u.bio_description),
    profile_deep_link: str(u.profile_deep_link),
    is_verified: typeof u.is_verified === "boolean" ? u.is_verified : null,
    follower_count: num(u.follower_count),
    following_count: num(u.following_count),
    likes_count: num(u.likes_count),
    video_count: num(u.video_count),
  };
}

/* ───────────────────────────── Display API: video/list ───────────────────────────── */

export const VIDEO_FIELDS = [
  "id", "create_time", "cover_image_url", "share_url", "video_description", "duration",
  "height", "width", "title", "embed_link", "like_count", "comment_count", "share_count", "view_count",
];

export interface TikTokVideo {
  id: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  share_url: string | null;
  embed_link: string | null;
  create_time: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  like_count: number;
  comment_count: number;
  share_count: number;
  view_count: number;
}

export function videoListRequest(accessToken: string, p: { cursor?: number | null; maxCount?: number } = {}): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = { max_count: Math.min(Math.max(p.maxCount ?? 20, 1), 20) };
  if (p.cursor) body.cursor = p.cursor;
  return {
    url: `${TIKTOK_API}/video/list/?fields=${VIDEO_FIELDS.join(",")}`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
    },
  };
}

export function parseVideoList(body: unknown): { videos: TikTokVideo[]; cursor: number | null; hasMore: boolean } {
  const data = ((body ?? {}) as Record<string, unknown>).data as Record<string, unknown> | undefined;
  const raw = Array.isArray(data?.videos) ? (data!.videos as Record<string, unknown>[]) : [];
  const videos = raw.filter((v) => v && v.id != null).map((v) => ({
    id: String(v.id),
    title: String(v.title ?? ""),
    description: String(v.video_description ?? ""),
    cover_image_url: str(v.cover_image_url),
    share_url: str(v.share_url),
    embed_link: str(v.embed_link),
    create_time: num(v.create_time),
    duration: num(v.duration),
    width: num(v.width),
    height: num(v.height),
    like_count: num(v.like_count) ?? 0,
    comment_count: num(v.comment_count) ?? 0,
    share_count: num(v.share_count) ?? 0,
    view_count: num(v.view_count) ?? 0,
  }));
  return { videos, cursor: num(data?.cursor), hasMore: Boolean(data?.has_more) };
}

/* ───────────────────────────── Content Posting API ───────────────────────────── */

export const TITLE_LIMIT = 2200;

export type PrivacyLevel = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

export interface CreatorInfo {
  nickname: string;
  username: string | null;
  avatar_url: string | null;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number | null;
}

export function creatorInfoRequest(accessToken: string): { url: string; init: RequestInit } {
  return {
    url: `${TIKTOK_API}/post/publish/creator_info/query/`,
    init: { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" } },
  };
}

export function parseCreatorInfo(body: unknown): CreatorInfo | null {
  const data = ((body ?? {}) as Record<string, unknown>).data as Record<string, unknown> | undefined;
  if (!data || (!data.creator_nickname && !data.privacy_level_options)) return null;
  return {
    nickname: String(data.creator_nickname ?? data.creator_username ?? "TikTok"),
    username: str(data.creator_username),
    avatar_url: str(data.creator_avatar_url),
    privacy_level_options: Array.isArray(data.privacy_level_options) ? data.privacy_level_options.map(String) : [],
    comment_disabled: Boolean(data.comment_disabled),
    duet_disabled: Boolean(data.duet_disabled),
    stitch_disabled: Boolean(data.stitch_disabled),
    max_video_post_duration_sec: num(data.max_video_post_duration_sec),
  };
}

/** Форма публикации, как её заполнил пользователь. */
export interface PostForm {
  title: string;
  privacy_level: string | null;
  allow_comment: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  /** Переключатель «Раскрыть коммерческий контент». */
  commercial_content: boolean;
  /** «Ваш бренд» — реклама собственного продукта. */
  your_brand: boolean;
  /** «Брендированный контент» — платное партнёрство. */
  branded_content: boolean;
  /** Ролик создан ИИ (маркировка AIGC). */
  ai_generated: boolean;
  cover_timestamp_ms?: number | null;
}

export interface PostInfo {
  title: string;
  privacy_level: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  video_cover_timestamp_ms: number;
  brand_content_toggle: boolean;
  brand_organic_toggle: boolean;
  is_aigc: boolean;
}

/**
 * Проверка формы по UX-требованиям Content Posting API: приватность
 * выбирает пользователь (не по умолчанию), брендированный контент нельзя
 * публиковать «только себе», при раскрытии коммерческого контента нужен хотя
 * бы один вариант, выключенные у автора взаимодействия не включить.
 * Возвращает тело post_info или текст ошибки (RU / EN).
 */
export function buildPostInfo(form: PostForm, creator: CreatorInfo): { ok: true; postInfo: PostInfo } | { ok: false; error: { ru: string; en: string } } {
  const title = form.title.trim();
  if (title.length > TITLE_LIMIT) {
    return { ok: false, error: { ru: `Заголовок длиннее ${TITLE_LIMIT} символов`, en: `Title is longer than ${TITLE_LIMIT} characters` } };
  }
  if (!form.privacy_level) {
    return { ok: false, error: { ru: "Выберите, кто может смотреть видео", en: "Choose who can view this video" } };
  }
  if (creator.privacy_level_options.length && !creator.privacy_level_options.includes(form.privacy_level)) {
    return { ok: false, error: { ru: "Такой уровень приватности недоступен этому аккаунту", en: "This privacy level is not available for the account" } };
  }
  if (form.commercial_content && !form.your_brand && !form.branded_content) {
    return {
      ok: false,
      error: {
        ru: "Раскрытие коммерческого контента включено — отметьте «Ваш бренд» и/или «Брендированный контент»",
        en: "Commercial content disclosure is on — select “Your brand” and/or “Branded content”",
      },
    };
  }
  if (form.commercial_content && form.branded_content && form.privacy_level === "SELF_ONLY") {
    return {
      ok: false,
      error: {
        ru: "Брендированный контент нельзя публиковать с видимостью «Только я»",
        en: "Branded content cannot be posted with “Only me” visibility",
      },
    };
  }
  return {
    ok: true,
    postInfo: {
      title,
      privacy_level: form.privacy_level,
      disable_comment: creator.comment_disabled ? true : !form.allow_comment,
      disable_duet: creator.duet_disabled ? true : !form.allow_duet,
      disable_stitch: creator.stitch_disabled ? true : !form.allow_stitch,
      video_cover_timestamp_ms: Math.max(0, Math.round(form.cover_timestamp_ms ?? 1000)),
      brand_content_toggle: Boolean(form.commercial_content && form.branded_content),
      brand_organic_toggle: Boolean(form.commercial_content && form.your_brand),
      is_aigc: Boolean(form.ai_generated),
    },
  };
}

/**
 * Текст согласия под кнопкой «Опубликовать» — площадка требует показывать,
 * с чем соглашается пользователь, в зависимости от раскрытия контента.
 */
export function consentText(form: Pick<PostForm, "commercial_content" | "branded_content">, lang: "ru" | "en"): string {
  const branded = form.commercial_content && form.branded_content;
  if (lang === "en") {
    return branded
      ? "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation."
      : "By posting, you agree to TikTok's Music Usage Confirmation.";
  }
  return branded
    ? "Публикуя, вы соглашаетесь с политикой брендированного контента TikTok и подтверждением использования музыки."
    : "Публикуя, вы соглашаетесь с подтверждением использования музыки TikTok.";
}

/* ───────────────────────────── загрузка файла чанками ───────────────────────────── */

export const MIN_CHUNK = 5 * 1024 * 1024;
export const MAX_CHUNK = 64 * 1024 * 1024;
/** Размер чанка, когда файл больше одного чанка: кратно 5 МБ, в пределах площадки. */
export const DEFAULT_CHUNK = 20 * 1024 * 1024;

export interface UploadPlan {
  video_size: number;
  chunk_size: number;
  total_chunk_count: number;
  /** [start, end] включительно — как в Content-Range. */
  ranges: [number, number][];
}

/**
 * Правила TikTok: чанк 5–64 МБ, total_chunk_count = floor(size / chunk_size),
 * последний чанк вбирает остаток (может быть до 128 МБ); файл меньше 5 МБ
 * идёт одним чанком.
 */
export function uploadPlan(size: number, chunk = DEFAULT_CHUNK): UploadPlan {
  if (!Number.isFinite(size) || size <= 0) throw new Error("video size must be positive");
  if (size <= MAX_CHUNK) return { video_size: size, chunk_size: size, total_chunk_count: 1, ranges: [[0, size - 1]] };
  const chunkSize = Math.min(Math.max(chunk, MIN_CHUNK), MAX_CHUNK);
  const count = Math.max(1, Math.floor(size / chunkSize));
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
    ranges.push([start, end]);
  }
  return { video_size: size, chunk_size: chunkSize, total_chunk_count: count, ranges };
}

export function contentRange(range: [number, number], total: number): string {
  return `bytes ${range[0]}-${range[1]}/${total}`;
}

export type PostMode = "direct" | "inbox";
export type SourceKind = "file" | "url";

export function initRequest(
  accessToken: string,
  p: { mode: PostMode; postInfo?: PostInfo; source: { kind: "url"; videoUrl: string } | { kind: "file"; plan: UploadPlan } },
): { url: string; init: RequestInit } {
  const source_info = p.source.kind === "url"
    ? { source: "PULL_FROM_URL", video_url: p.source.videoUrl }
    : { source: "FILE_UPLOAD", video_size: p.source.plan.video_size, chunk_size: p.source.plan.chunk_size, total_chunk_count: p.source.plan.total_chunk_count };
  const body = p.mode === "direct" ? { post_info: p.postInfo, source_info } : { source_info };
  return {
    url: p.mode === "direct" ? `${TIKTOK_API}/post/publish/video/init/` : `${TIKTOK_API}/post/publish/inbox/video/init/`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
    },
  };
}

export function statusRequest(accessToken: string, publishId: string): { url: string; init: RequestInit } {
  return {
    url: `${TIKTOK_API}/post/publish/status/fetch/`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    },
  };
}

export type PublishStage = "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED" | "UNKNOWN";

export interface PublishStatus {
  status: PublishStage;
  fail_reason: string | null;
  post_ids: string[];
  uploaded_bytes: number | null;
}

export function parsePublishStatus(body: unknown): PublishStatus {
  const data = ((body ?? {}) as Record<string, unknown>).data as Record<string, unknown> | undefined;
  const s = String(data?.status ?? "UNKNOWN");
  const known: PublishStage[] = ["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD", "SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"];
  return {
    status: (known as string[]).includes(s) ? (s as PublishStage) : "UNKNOWN",
    fail_reason: str(data?.fail_reason),
    post_ids: Array.isArray(data?.publicaly_available_post_id) ? data!.publicaly_available_post_id.map(String) : [],
    uploaded_bytes: num(data?.uploaded_bytes),
  };
}

export function revokeRequest(p: { clientKey: string; clientSecret: string; accessToken: string }): { url: string; init: RequestInit } {
  return {
    url: `${TIKTOK_API}/oauth/revoke/`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: p.clientKey, client_secret: p.clientSecret, token: p.accessToken }).toString(),
    },
  };
}

/** Ошибка из тела ответа TikTok ({error:{code,message}}), null если code=ok. */
export function apiError(body: unknown): { code: string; message: string } | null {
  const e = ((body ?? {}) as Record<string, unknown>).error as Record<string, unknown> | undefined;
  if (!e || !e.code || e.code === "ok") return null;
  return { code: String(e.code), message: String(e.message ?? e.code) };
}

/** Человеческое объяснение частых кодов TikTok (RU / EN), иначе сам код. */
export function explainError(code: string, lang: "ru" | "en" = "ru"): string {
  const map: Record<string, { ru: string; en: string }> = {
    scope_not_authorized: { ru: "Право не выдано — переподключите аккаунт с нужными разрешениями", en: "Scope not granted — reconnect the account with the required permissions" },
    access_token_invalid: { ru: "Токен недействителен — переподключите аккаунт", en: "Access token is invalid — reconnect the account" },
    token_expired: { ru: "Срок токена истёк — переподключите аккаунт", en: "Token expired — reconnect the account" },
    url_ownership_unverified: { ru: "Домен видео не верифицирован в приложении TikTok — используйте загрузку файлом", en: "Video URL domain is not verified in the TikTok app — use file upload" },
    privacy_level_option_mismatch: { ru: "Такой уровень приватности недоступен аккаунту", en: "Privacy level not available for this account" },
    unaudited_client_can_only_post_to_private_accounts: { ru: "Приложение ещё не прошло аудит — публиковать можно только в приватный аккаунт", en: "App is not audited yet — posting is allowed only to private accounts" },
    spam_risk_too_many_posts: { ru: "Слишком много публикаций за сутки", en: "Too many posts today" },
    spam_risk_user_banned_from_posting: { ru: "Аккаунту запрещено публиковать", en: "The account is banned from posting" },
    reached_active_user_cap: { ru: "Исчерпан лимит активных пользователей приложения", en: "Active user cap of the app reached" },
    rate_limit_exceeded: { ru: "Лимит запросов — повторите позже", en: "Rate limit — try again later" },
    video_pull_failed: { ru: "TikTok не смог скачать видео по ссылке", en: "TikTok could not download the video" },
    picture_size_check_failed: { ru: "Не прошла проверка размера", en: "Size check failed" },
    frame_rate_check_failed: { ru: "Не прошла проверка частоты кадров", en: "Frame rate check failed" },
    duration_check_failed: { ru: "Длительность видео вне лимита аккаунта", en: "Video duration is outside the account limit" },
    file_format_check_failed: { ru: "Формат файла не поддерживается (нужен MP4/MOV/WebM)", en: "File format not supported (MP4/MOV/WebM expected)" },
  };
  return map[code]?.[lang] ?? code;
}
