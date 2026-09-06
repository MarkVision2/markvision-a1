/**
 * Решение «продлевать ли long-lived токен» — чистая часть режима `tokens`
 * publish-monitor (docs/PUBLISHING-SYSTEM.md, ТЗ docs/TZ-instagram-100-accounts.md, этап 4).
 *
 * Зачем отдельно: на сети из 100 Instagram-аккаунтов, подключённых через
 * Instagram Login, токен IGAA… живёт 60 дней. Если продление молчит или
 * ошибается, вся сеть встаёт разом через два месяца. Поэтому правило
 * должно быть проверяемым без сети и без базы — тесты `_tests/publishTokenRefresh_test.ts`.
 *
 * Правила Meta, которые здесь учтены:
 *   • page-токены Facebook (EAA…) не истекают — их не трогаем;
 *   • long-lived токен Instagram Login / Threads продлевается только если ему
 *     не меньше 24 часов (иначе площадка отвечает ошибкой) — свежеподключённый
 *     аккаунт пропускаем с понятной причиной, а не пишем ему ошибку;
 *   • продлеваем за REFRESH_BEFORE_DAYS до истечения; срок неизвестен (старые
 *     строки без token_expires_at) — продлеваем сейчас, чтобы узнать его.
 */

export type LongLivedKind = "instagram_login" | "threads" | "page" | "other";

/** За сколько дней до истечения обновляем long-lived токен. */
export const REFRESH_BEFORE_DAYS = 10;
/** Минимальный возраст токена для продления — требование площадки. */
export const MIN_TOKEN_AGE_HOURS = 24;

export interface RefreshInput {
  platform: string;
  /** Расшифрованный access-токен: вид продления зависит от префикса. */
  token: string;
  tokenExpiresAt: string | null | undefined;
  tokenRefreshedAt: string | null | undefined;
}

export interface RefreshPlan {
  kind: LongLivedKind;
  refresh: boolean;
  /** Человеческая причина решения — уходит в ответ функции и в отчёт скрипта. */
  reason: string;
}

export function longLivedKind(platform: string, token: string): LongLivedKind {
  if (platform === "threads") return "threads";
  if (platform === "instagram" && /^IG/i.test(token)) return "instagram_login";
  if (platform === "instagram" && /^EAA/i.test(token)) return "page";
  return "other";
}

function ms(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function refreshPlan(input: RefreshInput, now = Date.now()): RefreshPlan {
  const kind = longLivedKind(input.platform, input.token);
  if (kind === "page") return { kind, refresh: false, reason: "page-токен Facebook не истекает" };
  if (kind === "other") return { kind, refresh: false, reason: "у площадки свой механизм продления" };

  const refreshedAt = ms(input.tokenRefreshedAt);
  if (refreshedAt != null && now - refreshedAt < MIN_TOKEN_AGE_HOURS * 3_600_000) {
    return { kind, refresh: false, reason: `токену меньше ${MIN_TOKEN_AGE_HOURS} ч — площадка ещё не даст продлить` };
  }

  const expiresAt = ms(input.tokenExpiresAt);
  if (expiresAt == null) return { kind, refresh: true, reason: "срок токена неизвестен — продлеваем и запоминаем срок" };
  const daysLeft = (expiresAt - now) / 86_400_000;
  if (daysLeft < REFRESH_BEFORE_DAYS) {
    return { kind, refresh: true, reason: daysLeft <= 0 ? "срок токена вышел" : `до истечения ${daysLeft.toFixed(1)} дн.` };
  }
  return { kind, refresh: false, reason: `до истечения ${Math.floor(daysLeft)} дн. — рано` };
}

/** Срок из ответа refresh_access_token (expires_in в секундах) → ISO; без числа — 60 дней. */
export function expiresAtFromRefresh(expiresIn: unknown, now = Date.now()): string {
  const n = Number(expiresIn);
  const sec = Number.isFinite(n) && n > 0 ? n : 60 * 86_400;
  return new Date(now + sec * 1000).toISOString();
}
