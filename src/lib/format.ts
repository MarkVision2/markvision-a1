// Единый формат валюты — тенге.
export const fmtKzt = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU")} ₸`;

export const fmtNum = (n: number) =>
  Math.round(n).toLocaleString("ru-RU");
