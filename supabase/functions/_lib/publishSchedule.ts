/**
 * Чистая часть постановки заданий: проверка ссылки на видео, раскладка по
 * времени и выбор варианта подписи.
 *
 * Вынесено из publish-intake отдельным модулем ради unit-тестов: именно здесь
 * решается, во сколько уйдёт сотый аккаунт и не залипнут ли все публикации в
 * одну минуту.
 */
import type { Platform } from "./publishCore.ts";

/** Форматы, которые площадки принимают по ссылке. */
const VIDEO_EXT = /\.(mp4|mov|m4v)(\?|$)/i;
/** Instagram Reels: 3 c … 15 мин. Границы одинаковы у всех наших площадок. */
export const MIN_DURATION_SEC = 3;
export const MAX_DURATION_SEC = 15 * 60;
export const MAX_SIZE_BYTES = 1024 * 1024 * 1024;

export interface Target {
  group_id?: string;
  account_ids?: string[];
  platforms?: Platform[];
  mode?: "now" | "drip" | "daily";
  per_hour?: number;
  start_at?: string;
}

/** Проверка того, что можно проверить без сети. */
export function validateVideoRef(
  fileUrl: string,
  durationSec?: number | null,
): { ok: true } | { ok: false; error: string } {
  if (!/^https:\/\//i.test(fileUrl)) return { ok: false, error: "file_url должен быть https-ссылкой" };
  if (!VIDEO_EXT.test(fileUrl)) return { ok: false, error: "ожидается ссылка на .mp4/.mov/.m4v" };
  if (durationSec != null && Number.isFinite(durationSec)) {
    if (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) {
      return {
        ok: false,
        error: `длительность ${durationSec} c вне допустимых ${MIN_DURATION_SEC}–${MAX_DURATION_SEC} c`,
      };
    }
  }
  return { ok: true };
}

/**
 * Во сколько уходит i-й аккаунт.
 *   now   — все сразу (осознанный риск: годится для 2-3 аккаунтов);
 *   drip  — по per_hour публикаций в час, равными промежутками;
 *   daily — по одной в сутки, чтобы растянуть один ролик на неделю.
 */
export function scheduleFor(target: Target, index: number, now: Date = new Date()): string {
  const start = target.start_at ? new Date(target.start_at) : now;
  const mode = target.mode ?? "drip";
  if (mode === "now") return start.toISOString();
  if (mode === "daily") return new Date(start.getTime() + index * 86_400_000).toISOString();
  const perHour = Math.min(Math.max(target.per_hour ?? 10, 1), 120);
  const stepMs = Math.round(3_600_000 / perHour);
  return new Date(start.getTime() + index * stepMs).toISOString();
}

/** Вариант подписи для i-го аккаунта: варианты идут по кругу. */
export function pickCaption(
  variants: unknown,
  baseCaption: string | null,
  index: number,
): string | null {
  const list = Array.isArray(variants) ? variants.map(String).filter(Boolean) : [];
  if (!list.length) return baseCaption;
  return list[index % list.length];
}

/**
 * Чем ограничить выборку аккаунтов у цели.
 *
 * Возвращает null — «не ограничивать» (все активные аккаунты проекта) и
 * массив — «только эти», в том числе пустой: явно переданный `account_ids: []`
 * означает «ни одного», а не «все». Разница не косметическая: заявка с пустым
 * списком однажды создала живое задание на реальный аккаунт.
 */
export function resolveAccountFilter(
  target: Target,
  groupAccountIds: string[] | null,
): string[] | null {
  if (target.group_id) return groupAccountIds ?? [];
  if (Array.isArray(target.account_ids)) return target.account_ids.map(String);
  return null;
}
