/**
 * Подтверждение запуска рекламной кампании.
 *
 * Раньше фронт считал собственный таймаут за «принято»: пользователь видел
 * «Кампания отправлена», даже когда запрос не дошёл. Теперь строку запуска
 * в `ad_campaigns` создаёт edge-функция сервисным ключом ДО тяжёлых шагов,
 * поэтому наличие строки с нашим launchId — честный признак того, что
 * запуск принят. Если ответ не пришёл — просто проверяем строку.
 */
import { supabase } from "@/integrations/supabase/client";

/** Проверка «строка запуска уже есть» — вынесена, чтобы ожидание тестировалось без сети. */
export type LaunchRowProbe = (launchId: string) => Promise<boolean>;

export interface WaitForLaunchRowOptions {
  /** Сколько раз спросить БД (первая попытка выполняется сразу). */
  attempts?: number;
  /** Пауза между попытками, мс. */
  delayMs?: number;
  /** Подменяется в тестах, чтобы не ждать реального времени. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ждёт появления строки запуска. Возвращает true, как только строка найдена,
 * и false, если за отведённые попытки она так и не появилась.
 */
export async function waitForLaunchRow(
  launchId: string,
  probe: LaunchRowProbe,
  options: WaitForLaunchRowOptions = {},
): Promise<boolean> {
  const attempts = Math.max(1, options.attempts ?? 5);
  const delayMs = Math.max(0, options.delayMs ?? 1500);
  const sleep = options.sleep ?? defaultSleep;

  if (!launchId) return false;

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs);
    try {
      if (await probe(launchId)) return true;
    } catch {
      // Сеть моргнула — пробуем ещё раз, пока есть попытки.
    }
  }
  return false;
}

/** Боевая проверка: ищем строку запуска в ad_campaigns по launch_id. */
export const probeLaunchRow: LaunchRowProbe = async (launchId) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("ad_campaigns")
    .select("id")
    .eq("launch_id", launchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
};
