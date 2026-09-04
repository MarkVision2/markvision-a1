/**
 * Массовая заливка: отбор аккаунтов и предпросмотр раскладки.
 *
 * Здесь только чистые функции — зеркало серверной логики
 * `plan_publish_slots` / `publish_next_slot` (миграция 20260905110000).
 * Расхождение с SQL = оператор выбрал 40 аккаунтов, а заданий создалось 12
 * без объяснения причины, поэтому фильтры продублированы в UI.
 */
import {
  effectiveDailyLimit,
  type PublishAccount,
  type PublishGroup,
  type PublishMode,
  type PublishPlatform,
} from "@/lib/publishingClient";

/** Ниже этого здоровья планировщик аккаунт не берёт (health_score >= 20 в SQL). */
export const MIN_HEALTH_TO_PUBLISH = 20;

/** Темп по умолчанию, когда группа не выбрана: coalesce(g.per_hour, 10) в SQL. */
export const DEFAULT_PER_HOUR = 10;

export type IneligibleReason = "disabled" | "not_active" | "low_health";

export interface Eligibility {
  ok: boolean;
  reason: IneligibleReason | null;
  /** Готовая подсказка для строки аккаунта. */
  hint: string | null;
}

const REASON_HINT: Record<IneligibleReason, string> = {
  disabled: "публикация выключена — задание не создастся",
  not_active: "статус не «Активен» — задание не создастся",
  low_health: `здоровье ниже ${MIN_HEALTH_TO_PUBLISH} — планировщик пропустит`,
};

/**
 * Возьмёт ли планировщик этот аккаунт. Дневной лимит сюда не входит:
 * при drip/daily переполненный день просто переносится на следующий.
 */
export function accountEligibility(a: PublishAccount): Eligibility {
  const reason: IneligibleReason | null = !a.publish_enabled
    ? "disabled"
    : a.status !== "active"
      ? "not_active"
      : Number(a.health_score ?? 0) < MIN_HEALTH_TO_PUBLISH
        ? "low_health"
        : null;
  return { ok: reason == null, reason, hint: reason ? REASON_HINT[reason] : null };
}

export function isPublishable(a: PublishAccount): boolean {
  return accountEligibility(a).ok;
}

/* ───────────────────────────── фильтры списка ───────────────────────────── */

export const ANY = "__any"; // сентинел «любой» для Radix Select

export interface AccountFilters {
  search: string;
  platform: PublishPlatform | typeof ANY;
  groupId: string | typeof ANY | "__none";
  onlyPublishable: boolean;
}

export const EMPTY_FILTERS: AccountFilters = {
  search: "",
  platform: ANY,
  groupId: ANY,
  onlyPublishable: false,
};

/** Поиск по имени и хэндлу, фильтры по площадке, группе и годности к публикации. */
export function filterAccounts(accounts: PublishAccount[], f: AccountFilters): PublishAccount[] {
  const q = f.search.trim().toLowerCase().replace(/^@/, "");
  return accounts.filter((a) => {
    if (q && !`${a.account_name} ${a.handle ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.platform !== ANY && a.platform !== f.platform) return false;
    if (f.groupId === "__none" ? a.group_id != null : f.groupId !== ANY && a.group_id !== f.groupId) return false;
    if (f.onlyPublishable && !isPublishable(a)) return false;
    return true;
  });
}

/* ───────────────────────────── предпросмотр раскладки ───────────────────────────── */

export interface PlanPreview {
  /** Аккаунты, по которым реально создадутся задания. */
  eligible: PublishAccount[];
  /** Выбранные, но отсеянные планировщиком — с причиной. */
  skipped: { account: PublishAccount; hint: string }[];
  /** Шаг между аккаунтами в минутах (0 для режима «сейчас»). */
  stepMinutes: number;
  /** Ориентировочное время последнего слота, если считать от start. */
  lastSlotAt: Date | null;
  /** Разбивка по площадкам для строки «12 IG · 4 TikTok». */
  byPlatform: { platform: PublishPlatform; count: number }[];
}

/**
 * Что произойдёт после «Отправить»: сколько заданий, с каким шагом и когда
 * последнее. Времена ориентировочные — сервер ещё двигает слоты по окну
 * публикаций и дневным лимитам аккаунта.
 */
export function planPreview(
  selected: PublishAccount[],
  mode: PublishMode,
  group: PublishGroup | null,
  start: Date = new Date(),
): PlanPreview {
  const eligible: PublishAccount[] = [];
  const skipped: PlanPreview["skipped"] = [];
  for (const a of selected) {
    const e = accountEligibility(a);
    if (e.ok) eligible.push(a);
    else skipped.push({ account: a, hint: e.hint ?? "пропущен" });
  }

  const stepMinutes =
    mode === "now" ? 0 : mode === "daily" ? 24 * 60 : 60 / Math.max(group?.per_hour ?? DEFAULT_PER_HOUR, 1);

  const lastSlotAt = eligible.length
    ? new Date(start.getTime() + stepMinutes * Math.max(eligible.length - 1, 0) * 60_000)
    : null;

  const counts = new Map<PublishPlatform, number>();
  for (const a of eligible) counts.set(a.platform, (counts.get(a.platform) ?? 0) + 1);

  return {
    eligible,
    skipped,
    stepMinutes,
    lastSlotAt,
    byPlatform: [...counts.entries()].map(([platform, count]) => ({ platform, count })),
  };
}

/** «6 мин» / «1 ч 30 мин» / «1 день» — шаг раскладки человеческим языком. */
export function formatStep(minutes: number): string {
  if (minutes <= 0) return "одновременно";
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} дн.`;
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  return `${Math.max(1, Math.round(minutes))} мин`;
}

/** Сегодняшняя загрузка аккаунта с учётом разгона: «1 / 3». */
export function todayLoad(a: PublishAccount): { used: number; limit: number; full: boolean } {
  const limit = effectiveDailyLimit(a);
  return { used: a.published_today, limit, full: a.published_today >= limit };
}
