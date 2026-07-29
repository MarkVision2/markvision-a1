// Единый расчёт дневного «безопасного» потолка WhatsApp-рассылки.
//
// ВАЖНО: этим модулем пользуются И воркер (реальная отправка), И health
// (что показываем в панели). Раньше формула была продублирована в трёх местах
// и расходилась — панель показывала не то число, что реально шлёт воркер.
// Теперь источник истины один.
//
// Логика «максимально осторожно»:
//   - прогрев нового номера: день 1 = 20, дальше +30%/день, но не выше жёсткого
//     потолка (WARMUP_CEILING) — даже у прогретого номера не разгоняемся резко;
//   - итог = min(лимит кампании, прогревочный потолок);
//   - если прогрев выключен — берём ровно лимит кампании (осознанный выбор).

export const WARMUP_DAY1 = 20;
export const WARMUP_GROWTH = 1.3;
/** Жёсткий безопасный потолок в день, выше которого прогрев не поднимает. */
export const WARMUP_CEILING = 120;

/** Сколько полных суток прошло с даты старта прогрева (0 — сегодня/нет даты). */
export function warmupDays(startedOn: string | null): number {
  if (!startedOn) return 0;
  const t = new Date(startedOn + "T00:00:00Z").getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/** Прогревочный потолок на день N (без учёта лимита кампании). */
export function warmupRamp(startedOn: string | null): number {
  const days = warmupDays(startedOn);
  return Math.min(
    WARMUP_CEILING,
    Math.max(WARMUP_DAY1, Math.round(WARMUP_DAY1 * Math.pow(WARMUP_GROWTH, days))),
  );
}

export type CapInput = {
  dailyLimit: number;
  warmupEnabled: boolean;
  warmupStartedOn: string | null;
};

/** Эффективный дневной потолок номера — ЕДИНЫЙ для воркера и health. */
export function effectiveDailyCap(input: CapInput): { cap: number; warmupDay: number } {
  const warmupDay = warmupDays(input.warmupStartedOn) + 1;
  const limit = Math.max(0, Math.floor(input.dailyLimit || 0));
  if (!input.warmupEnabled) return { cap: limit, warmupDay };
  return { cap: Math.min(limit, warmupRamp(input.warmupStartedOn)), warmupDay };
}
