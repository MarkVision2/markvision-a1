export const MONTHS_GEN_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

export const WEEKDAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export const formatTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
export const formatNumber = (n: number) => Math.round(n).toLocaleString("ru-RU");
export const formatPercent = (n: number) => `${n.toFixed(0)}%`;

/** Склонение: pluralRu(5, "лид", "лида", "лидов") → "лидов" */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function countLabel(n: number, one: string, few: string, many: string): string {
  return `${formatNumber(n)} ${pluralRu(n, one, few, many)}`;
}
