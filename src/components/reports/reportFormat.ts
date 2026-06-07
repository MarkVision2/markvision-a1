/** Форматирование сумм в отчётах — всегда тенге, как на Дашборде. */
export const fmtTenge = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;

export const fmtMetricTenge = (n: number, hasBase: boolean) =>
  (hasBase && n > 0 ? fmtTenge(n) : "—");

export const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

export const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export const reportFmt = { fmtTenge, fmtMetricTenge, fmtNum, fmtPct };
