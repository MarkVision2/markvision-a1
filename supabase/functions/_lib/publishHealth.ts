/**
 * Здоровье аккаунта — детерминированная оценка 0..100 из проверяемых фактов,
 * а не счётчик «+1 за успех, −10 за отказ», который со временем показывает
 * что угодно, кроме состояния аккаунта.
 *
 * Считается заново при каждой проверке (publish-monitor mode=health и tokens)
 * и объясняет себя списком причин — они показываются в подсказке у числа.
 * Между проверками SQL-триггеры по-прежнему двигают счётчик за успех/отказ,
 * но следующая проверка перезаписывает его этой формулой.
 *
 * Ниже MIN_PUBLISHABLE планировщик аккаунт не берёт (health_score >= 20 в
 * plan_publish_slots) — поэтому «мёртвый токен» гарантированно даёт меньше.
 */

export const MIN_PUBLISHABLE = 20;

const DAY = 86_400_000;

/**
 * Площадки, у которых access-token по замыслу короткий (TikTok — 24 ч, YouTube —
 * 1 ч) и монитор продлевает его refresh-токеном сам. Штрафовать их за «истекает
 * через 24 ч» — значит держать здоровье на 65 вечно; настоящий сигнал у них —
 * провал обновления, а это уже status = token_expired.
 */
export const SHORT_LIVED_TOKEN_PLATFORMS: ReadonlySet<string> = new Set(["tiktok", "youtube"]);

export interface HealthInput {
  status: "active" | "token_expired" | "limited" | "error" | "disabled";
  /** Площадка аккаунта — нужна, чтобы не штрафовать короткие токены за срок. */
  platform?: string | null;
  /** Итог живой проверки токена у площадки; null — проверка не делалась. */
  tokenAlive: boolean | null;
  tokenExpiresAt: string | null;
  lastCheckedAt: string | null;
  consecutiveErrors: number;
  failed30d: number;
  published30d: number;
  now?: number;
}

export interface HealthResult {
  score: number;
  reasons: string[];
}

function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (t - now) / DAY;
}

export function computeHealth(i: HealthInput): HealthResult {
  const now = i.now ?? Date.now();
  const reasons: string[] = [];
  let score = 100;
  let cap = 100;

  /* ── жёсткие потолки: состояние, при котором публиковать нельзя ── */
  if (i.status === "disabled") {
    return { score: 0, reasons: ["аккаунт выключен вручную"] };
  }
  if (i.tokenAlive === false || i.status === "token_expired") {
    cap = Math.min(cap, MIN_PUBLISHABLE - 5);
    reasons.push("токен не проходит проверку у площадки — переподключите аккаунт");
  }
  if (i.status === "error") {
    cap = Math.min(cap, 35);
    reasons.push("погашен монитором после серии отказов");
  }
  if (i.status === "limited") {
    cap = Math.min(cap, 55);
    reasons.push("площадка ограничила публикации");
  }

  /* ── срок токена ── */
  const left = daysUntil(i.tokenExpiresAt, now);
  const shortLived = SHORT_LIVED_TOKEN_PLATFORMS.has(String(i.platform ?? ""));
  if (left != null && i.tokenAlive !== false && i.status !== "token_expired" && !shortLived) {
    if (left <= 0) {
      cap = Math.min(cap, MIN_PUBLISHABLE - 5);
      reasons.push("срок токена истёк — переподключите аккаунт");
    } else if (left < 2) {
      score -= 35;
      reasons.push(`токен истекает через ${Math.max(1, Math.ceil(left * 24))} ч`);
    } else if (left < 7) {
      score -= 15;
      reasons.push(`токен истекает через ${Math.ceil(left)} дн.`);
    }
  }

  /* ── отказы подряд ── */
  if (i.consecutiveErrors > 0) {
    const pen = Math.min(40, i.consecutiveErrors * 10);
    score -= pen;
    reasons.push(`${i.consecutiveErrors} ${plural(i.consecutiveErrors, "отказ", "отказа", "отказов")} подряд`);
  }

  /* ── доля ошибок за 30 дней (нужна выборка хотя бы из 3 исходов) ── */
  const outcomes = i.failed30d + i.published30d;
  if (outcomes >= 3) {
    const rate = i.failed30d / outcomes;
    if (rate > 0.5) {
      score -= 30;
      reasons.push(`больше половины публикаций за 30 дн. упало (${i.failed30d} из ${outcomes})`);
    } else if (rate > 0.2) {
      score -= 15;
      reasons.push(`каждая пятая публикация за 30 дн. падает (${i.failed30d} из ${outcomes})`);
    }
  }

  /* ── свежесть проверки ── */
  const checkedAgo = i.lastCheckedAt ? -(daysUntil(i.lastCheckedAt, now) ?? 0) : null;
  if (checkedAgo == null) {
    score -= 10;
    reasons.push("аккаунт ещё ни разу не проверялся у площадки");
  } else if (checkedAgo > 3) {
    score -= 10;
    reasons.push(`последняя проверка ${Math.floor(checkedAgo)} дн. назад`);
  }

  const final = Math.max(0, Math.min(cap, Math.round(score)));
  if (!reasons.length) reasons.push("токен живой, отказов нет, проверка свежая");
  return { score: final, reasons };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Тон подсказки — зеркало healthTone на фронте. */
export function healthTone(score: number): "good" | "warn" | "bad" {
  if (score >= 70) return "good";
  if (score >= 40) return "warn";
  return "bad";
}
