/**
 * Ссылки-приглашения на подключение аккаунта (docs/PUBLISHING-SYSTEM.md).
 *
 * Чистая часть: генерация токена, состояние ссылки и разрешённые площадки.
 * Без Supabase и без секретов — тесты src/test/publishConnectLinks.test.ts.
 *
 * Смысл: менеджер выдаёт клиенту ссылку вида /connect/<token>. Клиент
 * открывает её в своём браузере, входит на площадке — аккаунт появляется в
 * сетке проекта. Ссылка живёт до срока, до лимита подключений или до отзыва;
 * всё это считается здесь одинаково и на сервере, и в интерфейсе.
 */

export type ConnectLinkPlatform = "instagram" | "tiktok" | "youtube" | "threads";

export const CONNECT_LINK_PLATFORMS: readonly ConnectLinkPlatform[] = ["instagram", "tiktok", "youtube", "threads"];

export function isConnectLinkPlatform(v: unknown): v is ConnectLinkPlatform {
  return typeof v === "string" && (CONNECT_LINK_PLATFORMS as readonly string[]).includes(v);
}

export interface ConnectLinkRow {
  platforms: string[] | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
}

export type ConnectLinkState = "active" | "revoked" | "expired" | "exhausted";

/**
 * Состояние ссылки. Порядок проверок — от необратимого к обратимому:
 * отозванную не оживит ни срок, ни лимит, поэтому она первая.
 */
export function connectLinkState(link: ConnectLinkRow, now = Date.now()): ConnectLinkState {
  if (link.revoked_at) return "revoked";
  if (link.expires_at && Date.parse(link.expires_at) <= now) return "expired";
  if (link.max_uses != null && link.used_count >= link.max_uses) return "exhausted";
  return "active";
}

export function connectLinkUsable(link: ConnectLinkRow, now = Date.now()): boolean {
  return connectLinkState(link, now) === "active";
}

/** Человеческая причина отказа — её же видит клиент на странице. */
export const CONNECT_LINK_STATE_TEXT: Record<ConnectLinkState, string> = {
  active: "Ссылка активна",
  revoked: "Ссылка отозвана — попросите новую у менеджера.",
  expired: "Срок действия ссылки истёк — попросите новую у менеджера.",
  exhausted: "По ссылке уже подключено максимальное число аккаунтов.",
};

/** Пустой список площадок в ссылке значит «все» — разворачиваем один раз здесь. */
export function allowedPlatforms(link: Pick<ConnectLinkRow, "platforms">): ConnectLinkPlatform[] {
  const raw = (link.platforms ?? []).filter(isConnectLinkPlatform);
  return raw.length ? raw : [...CONNECT_LINK_PLATFORMS];
}

/** Ввод из интерфейса → чистый список площадок ссылки (мусор молча отбрасываем). */
export function sanitizePlatforms(input: unknown): ConnectLinkPlatform[] {
  if (!Array.isArray(input)) return [];
  const uniq = new Set<ConnectLinkPlatform>();
  for (const v of input) if (isConnectLinkPlatform(v)) uniq.add(v);
  // Все площадки — то же самое, что «пусто»: не засоряем строку.
  return uniq.size === CONNECT_LINK_PLATFORMS.length ? [] : [...uniq];
}

/**
 * Токен ссылки: 32 случайных байта в base64url. Живёт в адресной строке
 * клиента, поэтому без «+/=» — иначе мессенджеры ломают ссылку при переносе.
 */
export function generateConnectToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Публичный адрес страницы подключения. base — корень приложения (https://markvision.kz). */
export function connectLinkUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/connect/${token}`;
}
