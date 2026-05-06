// Единый формат валюты — тенге.
export const fmtKzt = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;

export const fmtNum = (n: number) =>
  Math.round(n).toLocaleString("ru-RU");
