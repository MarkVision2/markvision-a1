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
  publishedToday,
  type PublishAccount,
  type PublishGroup,
  type PublishMode,
  type PublishPlatform,
} from "@/lib/publishingClient";

/** Ниже этого здоровья планировщик аккаунт не берёт (health_score >= 20 в SQL). */
export const MIN_HEALTH_TO_PUBLISH = 20;

/** Темп по умолчанию, когда группа не выбрана: coalesce(g.per_hour, 10) в SQL. */
export const DEFAULT_PER_HOUR = 10;

export type IneligibleReason =
  | "disabled" | "not_active" | "low_health"
  | "not_in_group" | "platform_mismatch" | "group_paused" | "project_paused";

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
  not_in_group: "не входит в выбранную группу — планировщик пропустит",
  platform_mismatch: "площадка не совпадает с площадкой группы — планировщик пропустит",
  group_paused: "группа на паузе — задания не создаются",
  project_paused: "публикации проекта на паузе — задания не создаются",
};

/** Контекст планирования, который сервер учитывает помимо самого аккаунта. */
export interface PlanContext {
  /** Группа из композера: plan_publish_slots режет выборку по её составу и площадке. */
  group?: PublishGroup | null;
  /** publish_project_settings.paused — при паузе plan_publish_slots не создаёт ничего. */
  projectPaused?: boolean;
  /** Все группы проекта — чтобы увидеть паузу группы аккаунта даже без выбранной группы. */
  groups?: PublishGroup[];
}

/** Состав группы = publish_accounts.group_id ∪ group.account_ids (как в SQL). */
export function isGroupMember(a: PublishAccount, g: PublishGroup): boolean {
  return a.group_id === g.id || (g.account_ids ?? []).includes(a.id);
}

/**
 * Возьмёт ли планировщик этот аккаунт — зеркало фильтров plan_publish_slots.
 * Дневной лимит сюда не входит: при drip/daily переполненный день просто
 * переносится на следующий.
 */
export function accountEligibility(a: PublishAccount, ctx: PlanContext = {}): Eligibility {
  const ownGroup = ctx.groups?.find((g) => g.id === a.group_id) ?? null;
  // Статус проверяем раньше выключателя: монитор гасит аккаунт сразу обоими
  // (status=error + publish_enabled=false), и «публикация выключена» отправляла
  // оператора щёлкать тумблер — планировщик всё равно берёт строго
  // status='active'. Сам по себе снятый тумблер у живого аккаунта по-прежнему
  // называется «публикация выключена».
  const reason: IneligibleReason | null = ctx.projectPaused
    ? "project_paused"
    : ctx.group?.review_mode === "paused"
      ? "group_paused"
      : a.status !== "active"
        ? "not_active"
        : !a.publish_enabled
          ? "disabled"
          : Number(a.health_score ?? 0) < MIN_HEALTH_TO_PUBLISH
            ? "low_health"
            : ctx.group && !isGroupMember(a, ctx.group)
              ? "not_in_group"
              : ctx.group?.platform && a.platform !== ctx.group.platform
                ? "platform_mismatch"
                : ownGroup?.review_mode === "paused"
                  ? "group_paused"
                  : null;
  return { ok: reason == null, reason, hint: reason ? REASON_HINT[reason] : null };
}

/** Та же причина в две-три слова — под чипом статуса в таблице. */
export const REASON_SHORT: Record<IneligibleReason, string> = {
  disabled: "публикация выключена",
  not_active: "нужен reconnect",
  low_health: `здоровье ниже ${MIN_HEALTH_TO_PUBLISH}`,
  not_in_group: "не в выбранной группе",
  platform_mismatch: "другая площадка",
  group_paused: "группа на паузе",
  project_paused: "пауза проекта",
};

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
  ctx: Omit<PlanContext, "group"> = {},
): PlanPreview {
  const eligible: PublishAccount[] = [];
  const skipped: PlanPreview["skipped"] = [];
  for (const a of selected) {
    const e = accountEligibility(a, { ...ctx, group });
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

/* ───────────────────────────── время старта (Алматы) ───────────────────────────── */

/** Казахстан с 2024 года живёт в одном поясе без перевода часов. */
export const ALMATY_OFFSET = "+05:00";

/** «2026-09-10T14:30» из <input type=datetime-local> как время Алматы → ISO в UTC. */
export function almatyLocalToIso(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:00${ALMATY_OFFSET}`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Текущее время Алматы в формате datetime-local — для атрибута min и подсказок. */
export function almatyLocalNow(now: number = Date.now()): string {
  const shifted = new Date(now + 5 * 3_600_000);
  return shifted.toISOString().slice(0, 16);
}

/**
 * Сегодняшняя загрузка аккаунта с учётом разгона: «1 / 3».
 *
 * Счётчик в базе относится к дню published_day: если он вчерашний, сегодня
 * опубликовано ноль — ровно так же считает claim_publish_jobs.
 */
export function todayLoad(a: PublishAccount, now: Date | number = Date.now()): { used: number; limit: number; full: boolean } {
  const limit = effectiveDailyLimit(a, now);
  const used = publishedToday(a, now);
  return { used, limit, full: used >= limit };
}
