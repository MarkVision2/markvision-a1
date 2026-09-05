/**
 * Раскладка пачки роликов по сети аккаунтов: один ролик → один аккаунт.
 *
 * Это противоположность composer'у («одно видео во все аккаунты группы»): у
 * контент-завода каждый ролик уникален, и сеть нужна ради пропускной
 * способности, а не ради копий. Правила (ТЗ docs/TZ-content-factory-network.md, §4.6):
 *   - аккаунты берутся по кругу, сначала самые здоровые;
 *   - не больше per_day роликов на аккаунт в сутки (по умолчанию 3);
 *   - ролики с одним topic_key не попадают в один день и, пока есть выбор,
 *     в один аккаунт — похожие темы пачкой в один день выглядят как спам.
 *
 * Чистая функция без базы — покрыта deno-тестом `_tests/publishDistribute_test.ts`.
 * Точное время внутри дня дальше выбирает plan_publish_slots (окно, интервалы, разгон).
 */

export interface DistributeVideo {
  id: string;
  /** Ключ темы; null/пусто — тема уникальна. */
  topic_key?: string | null;
}

export interface DistributeAccount {
  id: string;
  health_score?: number | null;
}

export interface DistributeOptions {
  /** Начало раскладки (день 0). */
  start: Date;
  /** Роликов на аккаунт в сутки. */
  perDay?: number;
  /** Дальше этого горизонта не планируем — остаток уходит в unassigned. */
  maxDays?: number;
}

export interface Assignment {
  video_id: string;
  account_id: string;
  /** Смещение в днях от start. */
  day: number;
  start_at: string;
}

export interface DistributionPlan {
  assignments: Assignment[];
  unassigned: string[];
}

export const DEFAULT_PER_DAY = 3;
export const DEFAULT_MAX_DAYS = 30;
const DAY_MS = 86_400_000;

/** Здоровые аккаунты вперёд; при равенстве — по id, чтобы план был воспроизводим. */
export function orderAccounts<T extends DistributeAccount>(accounts: readonly T[]): T[] {
  return [...accounts].sort((a, b) => (b.health_score ?? 0) - (a.health_score ?? 0) || a.id.localeCompare(b.id));
}

export function planDistribution(
  videos: readonly DistributeVideo[],
  accounts: readonly DistributeAccount[],
  opts: DistributeOptions,
): DistributionPlan {
  const perDay = Math.max(1, Math.floor(opts.perDay ?? DEFAULT_PER_DAY));
  const maxDays = Math.max(1, Math.floor(opts.maxDays ?? DEFAULT_MAX_DAYS));
  const ordered = orderAccounts(accounts);
  if (!ordered.length) return { assignments: [], unassigned: videos.map((v) => v.id) };

  const load = new Map<string, number>(); // `${account}:${day}` → сколько уже стоит
  const topicDays = new Map<string, Set<number>>();
  const topicAccounts = new Map<string, Set<string>>();
  let pointer = 0; // круг по аккаунтам

  const assignments: Assignment[] = [];
  const unassigned: string[] = [];

  for (const video of videos) {
    const topic = video.topic_key?.trim() || null;
    const usedDays = topic ? (topicDays.get(topic) ?? new Set<number>()) : new Set<number>();
    const usedAccounts = topic ? (topicAccounts.get(topic) ?? new Set<string>()) : new Set<string>();

    let placed: Assignment | null = null;
    for (let day = 0; day < maxDays && !placed; day++) {
      if (usedDays.has(day)) continue;
      // Два круга: сначала аккаунты, где этой темы ещё не было, потом любые со свободным местом.
      for (const strict of [true, false]) {
        for (let step = 0; step < ordered.length; step++) {
          const acc = ordered[(pointer + step) % ordered.length];
          if (strict && usedAccounts.has(acc.id)) continue;
          const key = `${acc.id}:${day}`;
          if ((load.get(key) ?? 0) >= perDay) continue;
          load.set(key, (load.get(key) ?? 0) + 1);
          pointer = (pointer + step + 1) % ordered.length;
          placed = {
            video_id: video.id,
            account_id: acc.id,
            day,
            start_at: new Date(opts.start.getTime() + day * DAY_MS).toISOString(),
          };
          break;
        }
        if (placed) break;
      }
    }

    if (!placed) {
      unassigned.push(video.id);
      continue;
    }
    assignments.push(placed);
    if (topic) {
      topicDays.set(topic, new Set([...usedDays, placed.day]));
      topicAccounts.set(topic, new Set([...usedAccounts, placed.account_id]));
    }
  }

  return { assignments, unassigned };
}
