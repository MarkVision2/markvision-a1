/**
 * Возможности аккаунта площадки — что этим токеном можно сделать.
 *
 * Не предполагаем, что любой аккаунт умеет всё: TikTok без scope video.list не
 * отдаёт статистику и не даёт прочитать пост обратно, Instagram-Login токен
 * не публикует в Threads и т.д. Резолвер детерминированный, без сети —
 * по площадке, форме токена и выданным scope; результат кладётся в
 * publish_accounts.capabilities при подключении/проверке здоровья, а раннер
 * проверяет нужную возможность перед действием.
 *
 * Чистый модуль, покрыт vitest (src/test/publishCapabilities.test.ts).
 */
import type { Platform } from "./publishCore.ts";

export type Capability =
  | "publish_video"
  | "publish_image"
  | "publish_carousel"
  | "publish_story"
  | "get_publication"
  | "delete_publication"
  | "get_insights"
  | "get_account_metrics"
  | "get_comments"
  | "reply_comments"
  | "refresh_token";

export type Capabilities = Record<Capability, boolean>;

export const CAPABILITY_LIST: Capability[] = [
  "publish_video", "publish_image", "publish_carousel", "publish_story",
  "get_publication", "delete_publication", "get_insights", "get_account_metrics",
  "get_comments", "reply_comments", "refresh_token",
];

function none(): Capabilities {
  return Object.fromEntries(CAPABILITY_LIST.map((c) => [c, false])) as Capabilities;
}

function scopes(scope: string | null | undefined): Set<string> {
  return new Set(String(scope ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
}

export interface CapabilityInput {
  platform: Platform | string;
  /** Форма токена: Instagram Login (IGAA/IGQV…) отличается от Facebook Page token (EAA…). */
  tokenKind?: "ig_login" | "fb_page" | "oauth" | "unknown";
  oauthScope?: string | null;
  /** Есть ли refresh_token (TikTok / YouTube). */
  hasRefreshToken?: boolean;
}

/** Форма токена по его первым символам — без расшифровки всего значения наружу. */
export function tokenKindOf(token: string | null | undefined): CapabilityInput["tokenKind"] {
  if (!token) return "unknown";
  if (/^IG/i.test(token)) return "ig_login";
  if (/^EAA/.test(token)) return "fb_page";
  return "oauth";
}

/**
 * Что умеет аккаунт. Публикация видео (Reels/Shorts) — базовая возможность всех
 * четырёх площадок в этом контуре; остальное зависит от площадки и scope.
 */
export function resolveCapabilities(input: CapabilityInput): Capabilities {
  const caps = none();
  const sc = scopes(input.oauthScope);
  switch (input.platform) {
    case "instagram": {
      caps.publish_video = true;
      // Фото и карусели через Content Publishing API площадка даёт, но очередь
      // пока принимает только видео (validateVideoRef) — возможность есть у
      // аккаунта, не у воркера; отмечаем честно: false до поддержки в коде.
      caps.publish_image = false;
      caps.publish_carousel = false;
      caps.publish_story = false;
      caps.get_publication = true;
      caps.delete_publication = false; // Graph не удаляет медиа IG через API
      caps.get_insights = true;
      caps.get_account_metrics = true;
      caps.get_comments = true;
      caps.reply_comments = input.tokenKind !== "ig_login" || sc.size === 0 || sc.has("instagram_business_manage_comments") || sc.has("instagram_manage_comments");
      caps.refresh_token = input.tokenKind === "ig_login"; // page-токены не истекают
      break;
    }
    case "threads": {
      caps.publish_video = true;
      caps.publish_image = false;
      caps.get_publication = true;
      caps.delete_publication = sc.size === 0 || sc.has("threads_delete");
      caps.get_insights = sc.size === 0 || sc.has("threads_manage_insights");
      caps.get_account_metrics = caps.get_insights;
      caps.get_comments = sc.size === 0 || sc.has("threads_manage_replies") || sc.has("threads_read_replies");
      caps.reply_comments = sc.size === 0 || sc.has("threads_manage_replies");
      caps.refresh_token = true;
      break;
    }
    case "tiktok": {
      const canList = sc.size === 0 || sc.has("video.list");
      caps.publish_video = sc.size === 0 || sc.has("video.publish") || sc.has("video.upload");
      caps.get_publication = canList;
      caps.get_insights = canList;
      caps.get_account_metrics = sc.size === 0 || sc.has("user.info.stats") || sc.has("user.info.basic");
      caps.refresh_token = input.hasRefreshToken !== false;
      break;
    }
    case "youtube": {
      caps.publish_video = sc.size === 0 || sc.has("https://www.googleapis.com/auth/youtube.upload") || sc.has("https://www.googleapis.com/auth/youtube");
      caps.get_publication = true;
      caps.delete_publication = sc.size === 0 || sc.has("https://www.googleapis.com/auth/youtube") || sc.has("https://www.googleapis.com/auth/youtube.force-ssl");
      caps.get_insights = true; // videos.list part=statistics — читается тем же токеном
      caps.get_account_metrics = true;
      caps.get_comments = sc.size === 0 || sc.has("https://www.googleapis.com/auth/youtube.force-ssl");
      caps.reply_comments = caps.get_comments;
      caps.refresh_token = input.hasRefreshToken !== false;
      break;
    }
    default:
      // Неизвестная площадка — ничего не умеет: раннер отправит на ручной разбор.
      break;
  }
  return caps;
}

/** Сохранённые возможности (jsonb) → проверка одной; пустой объект = ещё не резолвили → считаем true (обратная совместимость). */
export function hasCapability(stored: Partial<Record<string, unknown>> | null | undefined, cap: Capability): boolean {
  if (!stored || typeof stored !== "object" || !Object.keys(stored).length) return true;
  return stored[cap] === true;
}
