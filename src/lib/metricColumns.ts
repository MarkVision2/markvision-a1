/**
 * Столбцы «Таблицы показателей» с их ключами и названиями по умолчанию.
 * Ключ стабилен, а видимое название можно переопределить под каждый проект
 * (project_metric_labels). Так мед-клиника назовёт столбец «Диагностика»,
 * а вебинарный проект — «Вступлений», не трогая логику расчёта.
 */

export type MetricColumnKey =
  | "spend"
  | "leads_meta"
  | "leads_crm"
  | "cpl_crm"
  | "joined"
  | "planned_visits"
  | "conducted_visits"
  | "prepaid_count"
  | "prepaid_sum"
  | "diagnostics_paid"
  | "diagnostic_revenue"
  | "sales"
  | "revenue"
  | "cash"
  | "total"
  | "sum_business";

export const METRIC_COLUMNS: { key: MetricColumnKey; label: string; group: string }[] = [
  { key: "spend", label: "Затраты", group: "Реклама" },
  { key: "leads_meta", label: "Лиды Meta", group: "Реклама" },
  { key: "leads_crm", label: "Лиды CRM", group: "CRM" },
  { key: "cpl_crm", label: "CPL CRM", group: "CRM" },
  { key: "joined", label: "Вступлений", group: "CRM" },
  { key: "planned_visits", label: "Записано", group: "CRM" },
  { key: "conducted_visits", label: "Диагностики", group: "CRM" },
  { key: "prepaid_count", label: "Предоплат", group: "Деньги" },
  { key: "prepaid_sum", label: "Сумма предопл.", group: "Деньги" },
  { key: "diagnostics_paid", label: "Оплачено диагностик", group: "Деньги" },
  { key: "diagnostic_revenue", label: "Сумма диагностик", group: "Деньги" },
  { key: "sales", label: "Продажи", group: "Деньги" },
  { key: "revenue", label: "Выручка", group: "Деньги" },
  { key: "cash", label: "Касса", group: "Деньги" },
  { key: "total", label: "Итого", group: "Деньги" },
  { key: "sum_business", label: "Сумма", group: "Деньги" },
];

export const DEFAULT_METRIC_LABEL: Record<MetricColumnKey, string> = METRIC_COLUMNS.reduce(
  (acc, c) => {
    acc[c.key] = c.label;
    return acc;
  },
  {} as Record<MetricColumnKey, string>,
);
