export const MONTHS_GEN_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

export const WEEKDAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export const formatTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
export const formatNumber = (n: number) => Math.round(n).toLocaleString("ru-RU");
export const formatPercent = (n: number) => `${n.toFixed(0)}%`;
