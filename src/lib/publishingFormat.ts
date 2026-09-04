/**
 * Единый формат времени и чисел в разделе «Публикации».
 *
 * Полная дата `01.09.2026, 22:27:09` в каждой строке ничего не сообщает —
 * оператору важно «вчера» или «через 12 мин», а точное время он смотрит
 * в подсказке. Часовой пояс проекта — Алматы.
 */

const TZ = "Asia/Almaty";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Точное время для тултипа: «04.09.2026, 22:27». */
export function fmtExact(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Относительное время в обе стороны: «через 12 мин», «вчера», «3 дн. назад».
 * Дальше месяца — обычная дата, «412 дн. назад» уже ни о чём не говорит.
 */
export function fmtRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = t - now;
  const ahead = diff > 0;
  const abs = Math.abs(diff);

  if (abs < MIN) return ahead ? "вот-вот" : "только что";
  // Границы считаем по округлённому значению: 59,6 мин — это «1 час», а не «60 мин».
  const minutes = Math.round(abs / MIN);
  if (minutes < 60) return ahead ? `через ${minutes} мин` : `${minutes} мин назад`;
  const hours = Math.round(abs / HOUR);
  if (hours < 24) {
    const h = hours;
    return ahead ? `через ${h} ${plural(h, "час", "часа", "часов")}` : `${h} ${plural(h, "час", "часа", "часов")} назад`;
  }
  const d = Math.round(abs / DAY);
  if (d === 1) return ahead ? "завтра" : "вчера";
  if (d < 30) return ahead ? `через ${d} дн.` : `${d} дн. назад`;
  return new Date(t).toLocaleDateString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Крупные числа компактно: 312000 → «312 000». */
export function fmtNum(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("ru-RU");
}
