/**
 * Клиент раздела «Подключение TikTok» (страница /marketing/tiktok).
 * Контракт — supabase/functions/tiktok-connect/index.ts; каталог прав и
 * чистые проверки формы — supabase/functions/_lib/tiktokApi.ts (переиспользуем
 * прямо оттуда, чтобы интерфейс и бэкенд не разъезжались).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  buildPostInfo,
  consentText,
  type CreatorInfo,
  type PostForm,
  type PostMode,
  type PublishStage,
  splitScopes,
  TIKTOK_PRODUCTS,
  TIKTOK_SCOPES,
  type TikTokProduct,
  type TikTokScopeInfo,
  type TikTokUser,
  type TikTokVideo,
  TITLE_LIMIT,
} from "../../supabase/functions/_lib/tiktokApi";

export { buildPostInfo, consentText, splitScopes, TIKTOK_PRODUCTS, TIKTOK_SCOPES, TITLE_LIMIT };
export type { CreatorInfo, PostForm, PostMode, PublishStage, TikTokProduct, TikTokScopeInfo, TikTokUser, TikTokVideo };

export type Lang = "ru" | "en";

/* ───────────────────────────── типы ответов ───────────────────────────── */

export interface TikTokAppStatus {
  configured: boolean;
  sandbox: boolean;
  client_key_prefix: string | null;
  token_key_configured: boolean;
  redirect_uri: string;
  requested_scopes: string[];
  catalog: TikTokScopeInfo[];
}

export interface TikTokAccount {
  id: string;
  account_name: string;
  handle: string | null;
  external_account_id: string;
  status: "active" | "token_expired" | "limited" | "error" | "disabled";
  oauth_scope: string | null;
  token_expires_at: string | null;
  token_refreshed_at: string | null;
  connected_by: string | null;
  publish_enabled: boolean;
  last_error: string | null;
  last_post_at: string | null;
  followers: number | null;
  granted_scopes: string[];
  missing_scopes: string[];
}

export interface TikTokStatusResponse {
  app: TikTokAppStatus;
  accounts: TikTokAccount[];
}

export interface PublishStartResponse {
  publish_id: string;
  mode: PostMode;
  source: "file" | "url";
  uploaded_bytes: number | null;
  chunks: number | null;
  creator_nickname: string | null;
  message: string;
}

export interface PublishStatusResponse {
  status: PublishStage;
  fail_reason: string | null;
  fail_explained: { ru: string; en: string } | null;
  uploaded_bytes: number | null;
  post_id: string | null;
  post_url: string | null;
}

/* ───────────────────────────── вызов ───────────────────────────── */

export class TikTokApiError extends Error {
  code: string | null;
  messageEn: string | null;
  constructor(message: string, code: string | null = null, messageEn: string | null = null) {
    super(message);
    this.code = code;
    this.messageEn = messageEn;
  }
}

async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("tiktok-connect", { body: { action, ...body } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = error.message || "Ошибка запроса";
    let code: string | null = null;
    let en: string | null = null;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string; error_en?: string; code?: string };
        if (j?.error) message = j.error;
        code = j?.code ?? null;
        en = j?.error_en ?? null;
      } catch { /* не JSON */ }
    }
    throw new TikTokApiError(message, code, en);
  }
  const payload = data as (T & { error?: string; error_en?: string; code?: string }) | null;
  if (!payload) throw new TikTokApiError("Пустой ответ");
  if (payload.error) throw new TikTokApiError(payload.error, payload.code ?? null, payload.error_en ?? null);
  return payload;
}

export const tiktokApi = {
  status: (project_id: string) => call<TikTokStatusResponse>("status", { project_id }),
  profile: (project_id: string, account_id: string) => call<{ user: TikTokUser; fields: string }>("profile", { project_id, account_id }),
  videos: (project_id: string, account_id: string, cursor?: number | null) =>
    call<{ videos: TikTokVideo[]; cursor: number | null; has_more: boolean }>("videos", { project_id, account_id, cursor: cursor ?? null }),
  creatorInfo: (project_id: string, account_id: string) => call<{ creator: CreatorInfo }>("creator_info", { project_id, account_id }),
  publish: (project_id: string, input: { account_id: string; mode: PostMode; source: "file" | "url"; video_url: string; form: PostForm; lang: Lang }) =>
    call<PublishStartResponse>("publish", { project_id, ...input }),
  publishStatus: (project_id: string, account_id: string, publish_id: string) =>
    call<PublishStatusResponse>("publish_status", { project_id, account_id, publish_id }),
  disconnect: (project_id: string, account_id: string) => call<{ ok: true; revoked: boolean }>("disconnect", { project_id, account_id }),
};

/* ───────────────────────────── чистые помощники интерфейса ───────────────────────────── */

export const PRIVACY_LABELS: Record<string, { ru: string; en: string; hint: { ru: string; en: string } }> = {
  PUBLIC_TO_EVERYONE: { ru: "Все", en: "Everyone", hint: { ru: "Видео увидят все пользователи TikTok", en: "Anyone on TikTok can watch" } },
  MUTUAL_FOLLOW_FRIENDS: { ru: "Друзья", en: "Friends", hint: { ru: "Только взаимные подписчики", en: "Followers you follow back" } },
  FOLLOWER_OF_CREATOR: { ru: "Подписчики", en: "Followers", hint: { ru: "Только подписчики аккаунта", en: "Only your followers" } },
  SELF_ONLY: { ru: "Только я", en: "Only me", hint: { ru: "Видео будет приватным", en: "The video stays private" } },
};

export function privacyLabel(level: string, lang: Lang): string {
  return PRIVACY_LABELS[level]?.[lang] ?? level;
}

export const STAGE_LABELS: Record<PublishStage, { ru: string; en: string }> = {
  PROCESSING_UPLOAD: { ru: "TikTok принимает файл", en: "TikTok is receiving the file" },
  PROCESSING_DOWNLOAD: { ru: "TikTok скачивает видео по ссылке", en: "TikTok is downloading the video" },
  SEND_TO_USER_INBOX: { ru: "Черновик отправлен во «Входящие» TikTok", en: "Draft sent to the TikTok inbox" },
  PUBLISH_COMPLETE: { ru: "Опубликовано", en: "Published" },
  FAILED: { ru: "Ошибка публикации", en: "Publishing failed" },
  UNKNOWN: { ru: "Статус неизвестен", en: "Unknown status" },
};

/** Прогресс в процентах по стадии — для полоски под статусом. */
export function stageProgress(stage: PublishStage): number {
  switch (stage) {
    case "PROCESSING_UPLOAD": return 45;
    case "PROCESSING_DOWNLOAD": return 45;
    case "SEND_TO_USER_INBOX": return 100;
    case "PUBLISH_COMPLETE": return 100;
    case "FAILED": return 100;
    default: return 10;
  }
}

export function isFinalStage(stage: PublishStage): boolean {
  return stage === "PUBLISH_COMPLETE" || stage === "FAILED" || stage === "SEND_TO_USER_INBOX";
}

/** Права по продуктам — для карточек «Login Kit / Display API / Content Posting API». */
export function scopesByProduct(catalog: readonly TikTokScopeInfo[] = TIKTOK_SCOPES): { product: TikTokProduct; scopes: TikTokScopeInfo[] }[] {
  const order: TikTokProduct[] = ["login_kit", "display_api", "content_posting_api"];
  return order.map((product) => ({ product, scopes: catalog.filter((s) => s.product === product) })).filter((g) => g.scopes.length);
}

/** Выдано ли право аккаунту: аккаунт без сохранённого scope считаем полным (проверит первый вызов). */
export function scopeGranted(account: Pick<TikTokAccount, "granted_scopes"> | null, scope: string): boolean {
  if (!account) return false;
  if (!account.granted_scopes.length) return true;
  return account.granted_scopes.includes(scope);
}

export function formatCount(n: number | null | undefined, lang: Lang): string {
  if (n == null) return "—";
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Пустая форма публикации: приватность не выбрана — так требует UX-гайд площадки. */
export function emptyPostForm(): PostForm {
  return {
    title: "",
    privacy_level: null,
    allow_comment: true,
    allow_duet: true,
    allow_stitch: true,
    commercial_content: false,
    your_brand: false,
    branded_content: false,
    ai_generated: false,
    cover_timestamp_ms: 1000,
  };
}

/* ───────────────────────────── словарь интерфейса ───────────────────────────── */

const DICT = {
  pageTitle: { ru: "Подключение TikTok", en: "TikTok connection" },
  pageDesc: {
    ru: "Вход через TikTok, профиль и видео аккаунта, публикация роликов из MarkVision — через официальные TikTok for Developers API.",
    en: "Sign in with TikTok, account profile and videos, posting from MarkVision — via the official TikTok for Developers APIs.",
  },
  langToggle: { ru: "EN", en: "RU" },
  refresh: { ru: "Обновить", en: "Refresh" },
  noProject: { ru: "Выберите проект, чтобы подключить TikTok.", en: "Select a project to connect TikTok." },
  appNotConfigured: {
    ru: "Ключи приложения TikTok не заданы (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET в секретах Supabase). Подключение недоступно.",
    en: "TikTok app keys are not configured (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET in Supabase secrets). Connection is unavailable.",
  },
  sandbox: { ru: "Песочница", en: "Sandbox" },
  sandboxHint: {
    ru: "Приложение работает в тестовой среде TikTok: авторизоваться могут только target users песочницы, прямая публикация — только в приватный аккаунт.",
    en: "The app runs in the TikTok sandbox: only sandbox target users can sign in, direct post works only for private accounts.",
  },
  production: { ru: "Боевое приложение", en: "Production app" },
  connected: { ru: "Подключено", en: "Connected" },
  notConnected: { ru: "Аккаунт не подключён", en: "No account connected" },
  loginTitle: { ru: "Login Kit — вход через TikTok", en: "Login Kit — Sign in with TikTok" },
  loginDesc: {
    ru: "Нажмите кнопку, подтвердите права на странице TikTok — и аккаунт появится в проекте. Мы получаем только то, что вы разрешите.",
    en: "Click the button and approve the permissions on the TikTok page — the account appears in the project. We receive only what you allow.",
  },
  continueWithTikTok: { ru: "Продолжить с TikTok", en: "Continue with TikTok" },
  connectAnother: { ru: "Подключить ещё аккаунт", en: "Connect another account" },
  reconnect: { ru: "Переподключить", en: "Reconnect" },
  disconnect: { ru: "Отключить", en: "Disconnect" },
  disconnectConfirm: {
    ru: "Отключить аккаунт? Токен будет отозван у TikTok, а данные аккаунта удалены из проекта.",
    en: "Disconnect this account? The token will be revoked at TikTok and the account data removed from the project.",
  },
  disconnected: { ru: "Аккаунт отключён, токен отозван", en: "Account disconnected, token revoked" },
  disconnectedNoRevoke: { ru: "Аккаунт удалён из проекта (TikTok не подтвердил отзыв токена)", en: "Account removed from the project (TikTok did not confirm the revoke)" },
  connectedToast: { ru: "TikTok подключён", en: "TikTok connected" },
  connectFailed: { ru: "Подключение не удалось", en: "Connection failed" },
  accounts: { ru: "Аккаунты проекта", en: "Project accounts" },
  activeAccount: { ru: "Выбран", en: "Selected" },
  tokenUntil: { ru: "Токен до", en: "Token until" },
  missingScopes: { ru: "Не выдано", en: "Not granted" },
  scopesTitle: { ru: "Права и продукты", en: "Permissions & products" },
  scopesDesc: {
    ru: "Что именно просит MarkVision и зачем. Каждое право показано в деле в блоках ниже.",
    en: "Exactly what MarkVision requests and why. Each permission is demonstrated in the blocks below.",
  },
  granted: { ru: "Выдано", en: "Granted" },
  notGranted: { ru: "Не выдано", en: "Not granted" },
  requested: { ru: "Запрашивается при входе", en: "Requested at sign-in" },
  profileTitle: { ru: "Display API — профиль", en: "Display API — profile" },
  profileDesc: { ru: "Данные аккаунта по правам user.info.basic / profile / stats — запрос /v2/user/info/.", en: "Account data under user.info.basic / profile / stats — /v2/user/info/ request." },
  loadProfile: { ru: "Загрузить профиль", en: "Load profile" },
  followers: { ru: "Подписчики", en: "Followers" },
  following: { ru: "Подписки", en: "Following" },
  likes: { ru: "Лайки", en: "Likes" },
  videosCount: { ru: "Видео", en: "Videos" },
  verified: { ru: "Верифицирован", en: "Verified" },
  openProfile: { ru: "Открыть в TikTok", en: "Open in TikTok" },
  fieldsRequested: { ru: "Запрошены поля", en: "Requested fields" },
  videosTitle: { ru: "Display API — видео аккаунта", en: "Display API — account videos" },
  videosDesc: { ru: "Опубликованные ролики с просмотрами, лайками и комментариями — запрос /v2/video/list/ (право video.list).", en: "Published videos with views, likes and comments — /v2/video/list/ request (video.list scope)." },
  loadVideos: { ru: "Загрузить видео", en: "Load videos" },
  loadMore: { ru: "Ещё", en: "Load more" },
  noVideos: { ru: "У аккаунта пока нет опубликованных видео.", en: "The account has no published videos yet." },
  views: { ru: "просмотров", en: "views" },
  postTitle: { ru: "Content Posting API — публикация", en: "Content Posting API — post a video" },
  postDesc: {
    ru: "Готовый ролик из MarkVision уходит в TikTok: прямая публикация (video.publish) или черновик во «Входящие» (video.upload).",
    en: "A finished MarkVision video goes to TikTok: direct post (video.publish) or a draft to the inbox (video.upload).",
  },
  modeDirect: { ru: "Опубликовать сразу", en: "Direct post" },
  modeDirectHint: { ru: "Видео появится в профиле с выбранными настройками", en: "The video appears in the profile with the chosen settings" },
  modeInbox: { ru: "Черновик в TikTok", en: "Draft to inbox" },
  modeInboxHint: { ru: "Дооформите и опубликуете в приложении TikTok", en: "Finish and post it in the TikTok app" },
  videoSource: { ru: "Видео", en: "Video" },
  chooseFile: { ru: "Выбрать файл", en: "Choose file" },
  orPasteUrl: { ru: "или вставьте https-ссылку на видео", en: "or paste an https link to a video" },
  urlSourceHint: {
    ru: "Ссылка на файл в нашем хранилище: MarkVision сам передаёт файл в TikTok (FILE_UPLOAD). Режим PULL_FROM_URL требует верифицированный домен.",
    en: "Link to a file in our storage: MarkVision transfers the file to TikTok itself (FILE_UPLOAD). PULL_FROM_URL requires a verified domain.",
  },
  pullFromUrl: { ru: "TikTok скачает по ссылке (PULL_FROM_URL)", en: "Let TikTok pull from the URL (PULL_FROM_URL)" },
  uploading: { ru: "Загрузка в хранилище", en: "Uploading to storage" },
  uploaded: { ru: "Файл готов", en: "File ready" },
  postingAs: { ru: "Публикуется от имени", en: "Posting as" },
  loadCreator: { ru: "Проверить настройки аккаунта", en: "Check account settings" },
  titleLabel: { ru: "Заголовок и хэштеги", en: "Title and hashtags" },
  titlePlaceholder: { ru: "О чём видео? #хэштеги @упоминания", en: "What is the video about? #hashtags @mentions" },
  privacyLabel: { ru: "Кто может смотреть", en: "Who can view this video" },
  privacyPlaceholder: { ru: "Выберите…", en: "Select…" },
  interactions: { ru: "Разрешить", en: "Allow users to" },
  allowComment: { ru: "Комментарии", en: "Comment" },
  allowDuet: { ru: "Дуэты", en: "Duet" },
  allowStitch: { ru: "Стич", en: "Stitch" },
  disabledByCreator: { ru: "выключено в настройках аккаунта", en: "disabled in the account settings" },
  commercial: { ru: "Раскрыть коммерческий контент", en: "Disclose commercial content" },
  commercialHint: {
    ru: "Включите, если видео продвигает товар или услугу — ваш бренд или партнёра.",
    en: "Turn on if the video promotes a product or service — your own brand or a partner.",
  },
  yourBrand: { ru: "Ваш бренд", en: "Your brand" },
  yourBrandHint: { ru: "Реклама собственного бизнеса — видео получит метку «Рекламный контент»", en: "Promoting your own business — the video gets a “Promotional content” label" },
  brandedContent: { ru: "Брендированный контент", en: "Branded content" },
  brandedContentHint: { ru: "Платное партнёрство — видео получит метку «Платное партнёрство»", en: "Paid partnership — the video gets a “Paid partnership” label" },
  aigc: { ru: "Видео создано с помощью ИИ", en: "AI-generated content" },
  aigcHint: { ru: "Аватары HeyGen и faceless-ролики MarkVision помечаются как AIGC", en: "HeyGen avatars and MarkVision faceless videos are labeled as AIGC" },
  publish: { ru: "Опубликовать в TikTok", en: "Post to TikTok" },
  sendDraft: { ru: "Отправить черновик в TikTok", en: "Send draft to TikTok" },
  processingNote: { ru: "Обработка в TikTok может занять несколько минут.", en: "TikTok may take a few minutes to process the video." },
  statusTitle: { ru: "Статус публикации", en: "Post status" },
  publishId: { ru: "publish_id", en: "publish_id" },
  openPost: { ru: "Открыть видео", en: "Open the video" },
  inboxDone: {
    ru: "Откройте приложение TikTok — черновик ждёт во «Входящих», там можно добавить описание и опубликовать.",
    en: "Open the TikTok app — the draft is waiting in your inbox, add a caption there and post it.",
  },
  newPost: { ru: "Новая публикация", en: "New post" },
  needVideo: { ru: "Сначала выберите видео", en: "Choose a video first" },
  needAccount: { ru: "Сначала подключите аккаунт TikTok", en: "Connect a TikTok account first" },
  howItWorks: { ru: "Как это устроено", en: "How it works" },
  step1: { ru: "Вход через TikTok (Login Kit) — OAuth 2.0, токены шифруются на сервере", en: "Sign in with TikTok (Login Kit) — OAuth 2.0, tokens are encrypted on the server" },
  step2: { ru: "Display API — профиль и лента видео аккаунта для карточки в сети публикаций и аналитики", en: "Display API — profile and video feed for the publishing network card and analytics" },
  step3: { ru: "Content Posting API — ролик из очереди MarkVision уходит в TikTok с настройками, которые выбрал пользователь", en: "Content Posting API — a video from the MarkVision queue goes to TikTok with user-chosen settings" },
  step4: { ru: "Отключение — токен отзывается у TikTok, данные удаляются из проекта", en: "Disconnect — the token is revoked at TikTok, data is removed from the project" },
  legal: { ru: "Условия использования и Политика конфиденциальности", en: "Terms of Service and Privacy Policy" },
  terms: { ru: "Условия использования", en: "Terms of Service" },
  privacy: { ru: "Политика конфиденциальности", en: "Privacy Policy" },
  redirectUri: { ru: "Redirect URI приложения", en: "App redirect URI" },
  selectAccount: { ru: "Аккаунт", en: "Account" },
  by: { ru: "от", en: "by" },
} as const;

export type DictKey = keyof typeof DICT;

export function t(key: DictKey, lang: Lang): string {
  return DICT[key][lang];
}

/** Ошибка API → текст на языке интерфейса. */
export function errorText(e: unknown, lang: Lang): string {
  if (e instanceof TikTokApiError) return (lang === "en" && e.messageEn) ? e.messageEn : e.message;
  return e instanceof Error ? e.message : String(e);
}
